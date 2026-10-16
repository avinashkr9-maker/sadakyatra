import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { one, query, transaction } from './db.js';

const OTP_TTL_SECONDS = 5 * 60;
const OTP_RESEND_SECONDS = 30;
const OTP_MAX_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_DAYS = 180;
const STAFF_PERMISSIONS = ['bookings', 'partners', 'pricing'];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export function isValidIndianPhone(phone) {
  return /^[6-9]\d{9}$/.test(phone);
}

export const maskPhone = (phone) => `${String(phone).slice(0, 2)}xxxxx${String(phone).slice(-3)}`;

// "9304057169:482913, +91 90000 00001:111111" -> fixed codes for testing before an SMS provider is set up.
// Entries may be separated by commas, semicolons or new lines; the number may carry +91 or spaces.
function parseTestNumbers() {
  const codes = new Map();
  const problems = [];
  String(process.env.OTP_TEST_NUMBERS || '').split(/[,;\n]+/).map((entry) => entry.trim()).filter(Boolean).forEach((entry, index) => {
    const [rawPhone, rawCode] = entry.split(':');
    const phone = normalizePhone(rawPhone);
    const code = String(rawCode || '').replace(/\s/g, '');
    if (!isValidIndianPhone(phone)) problems.push(`entry ${index + 1}: "${rawPhone?.trim()}" is not a 10-digit mobile number`);
    else if (!/^\d{6}$/.test(code)) problems.push(`entry ${index + 1} (${maskPhone(phone)}): code must be exactly 6 digits`);
    else codes.set(phone, code);
  });
  return { codes, problems };
}
const testCodes = () => parseTestNumbers().codes;

// Printed at startup so a mistyped OTP_TEST_NUMBERS shows up in the server logs.
export function describeTestNumbers() {
  const { codes, problems } = parseTestNumbers();
  return [
    `OTP test numbers accepted (${codes.size}): ${[...codes.keys()].map(maskPhone).join(', ') || 'none'}`,
    ...problems.map((problem) => `OTP_TEST_NUMBERS ignored ${problem}`)
  ];
}

export class OtpUnavailableError extends Error {}

// No SMS provider yet: only numbers listed in OTP_TEST_NUMBERS can log in.
async function deliverOtp(phone) {
  const fixed = testCodes().get(phone);
  if (fixed) return fixed;
  console.warn(`OTP refused for ${maskPhone(phone)}: not in OTP_TEST_NUMBERS and no SMS provider is set up`);
  throw new OtpUnavailableError('SMS login is not switched on yet');
}

export async function requestOtp(phone) {
  const existing = await one('SELECT * FROM otp_codes WHERE phone = $1', [phone]);
  const now = Date.now();
  let sentInWindow = 1;
  let windowStart = new Date(now);
  if (existing) {
    const sinceLast = (now - new Date(existing.last_sent_at).getTime()) / 1000;
    if (sinceLast < OTP_RESEND_SECONDS) return { retryAfter: Math.ceil(OTP_RESEND_SECONDS - sinceLast) };
    const windowAge = now - new Date(existing.window_started_at).getTime();
    if (windowAge < 3600_000) {
      if (existing.sent_in_window >= OTP_MAX_PER_HOUR) return { retryAfter: Math.ceil((3600_000 - windowAge) / 1000) };
      sentInWindow = existing.sent_in_window + 1;
      windowStart = new Date(existing.window_started_at);
    }
  }
  const code = await deliverOtp(phone);
  await query(`
    INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, sent_in_window, window_started_at, last_sent_at)
    VALUES ($1, $2, now() + make_interval(secs => $3), 0, $4, $5, now())
    ON CONFLICT (phone) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
      attempts = 0, sent_in_window = EXCLUDED.sent_in_window, window_started_at = EXCLUDED.window_started_at,
      last_sent_at = now()
  `, [phone, sha256(`${phone}:${code}`), OTP_TTL_SECONDS, sentInWindow, windowStart]);
  return { sent: true };
}

// Returns true when the code matches; each code is single-use and allows a few attempts.
export async function checkOtp(phone, code) {
  const row = await one('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1 RETURNING *', [phone]);
  if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts > OTP_MAX_ATTEMPTS) return false;
  const supplied = Buffer.from(sha256(`${phone}:${code}`));
  if (!timingSafeEqual(supplied, Buffer.from(row.code_hash))) return false;
  await query('DELETE FROM otp_codes WHERE phone = $1', [phone]);
  return true;
}

// ---- Passwords (scrypt, from Node's crypto; no extra dependency) ---------
const scryptAsync = (password, salt) => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)));
});

export const PASSWORD_MIN = 6;

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (password.length > 100) return 'Password is too long';
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${(await scryptAsync(password, salt)).toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash || typeof password !== 'string') return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, salt);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function setPassword(userId, password, client) {
  await query('UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2', [await hashPassword(password), userId], client);
}

export const isOwnerPhone = (phone) => Boolean(process.env.OWNER_PHONE) && normalizePhone(process.env.OWNER_PHONE) === phone;

// Sessions on other phones end when the password changes.
export function endOtherSessions(userId, keepToken) {
  return query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, sha256(keepToken || '')]);
}

export async function findOrCreateUser(phone, fullName = null, client) {
  return one(`
    INSERT INTO users (role, full_name, phone) VALUES ('CUSTOMER', $1, $2)
    ON CONFLICT (phone) DO UPDATE SET full_name = COALESCE(users.full_name, EXCLUDED.full_name)
    RETURNING *
  `, [fullName, phone], client);
}

export function grantRole(userId, role, permissions = [], client) {
  return query(`
    INSERT INTO user_roles (user_id, role, permissions) VALUES ($1, $2, $3)
    ON CONFLICT (user_id, role) DO UPDATE SET permissions = EXCLUDED.permissions
  `, [userId, role, permissions], client);
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  await query(`
    INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))
  `, [userId, sha256(token), SESSION_DAYS]);
  return token;
}

export function endSession(token) {
  return query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

// Everyone who logs in is a customer; OWNER_PHONE becomes owner automatically.
// Drivers approved before OTP login existed are linked to the account with their number.
export async function loginWithPhone(phone) {
  return transaction(async (client) => {
    const user = await findOrCreateUser(phone, null, client);
    await query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'customer') ON CONFLICT DO NOTHING", [user.id], client);
    const legacyDriver = await one(`
      UPDATE drivers SET user_id = $1
      WHERE phone = $2 AND user_id IS NULL AND NOT EXISTS (SELECT 1 FROM drivers WHERE user_id = $1)
      RETURNING partner_id
    `, [user.id, phone], client);
    if (legacyDriver) {
      await query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'driver') ON CONFLICT DO NOTHING", [user.id], client);
      await query('UPDATE partners SET user_id = $1 WHERE id = $2 AND user_id IS NULL', [user.id, legacyDriver.partner_id], client);
    }
    if (normalizePhone(process.env.OWNER_PHONE) === phone) {
      await query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'owner') ON CONFLICT DO NOTHING", [user.id], client);
    }
    return user;
  });
}

// One round trip: the user plus their roles.
const ACCOUNT_SQL = `
  SELECT u.id, u.full_name, u.phone, u.email,
    COALESCE(json_agg(json_build_object('role', r.role, 'permissions', r.permissions)) FILTER (WHERE r.role IS NOT NULL), '[]') AS role_rows
  FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
`;

export async function loadAccount(userId) {
  const row = await one(`${ACCOUNT_SQL} WHERE u.id = $1 GROUP BY u.id`, [userId]);
  return row ? buildAccount(row) : null;
}

function buildAccount(user) {
  const roleRows = user.role_rows;
  const roles = roleRows.map((row) => row.role);
  const isOwner = roles.includes('owner');
  const permissions = isOwner
    ? [...STAFF_PERMISSIONS, 'admins']
    : roleRows.find((row) => row.role === 'admin')?.permissions || [];
  return {
    id: user.id,
    fullName: user.full_name,
    phone: user.phone,
    email: user.email,
    roles,
    permissions,
    profileComplete: Boolean(user.full_name)
  };
}

const bearer = (req) => req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';

// Logged-in accounts are remembered briefly so most taps skip the database.
// Anything that changes sessions or roles clears it (clearAccountCache).
const ACCOUNT_CACHE_MS = 30_000;
const accountCache = new Map();

export function clearAccountCache() {
  accountCache.clear();
}

// Attaches req.account when a valid session token is sent; never rejects on its own.
export async function authenticate(req, _res, next) {
  try {
    const token = bearer(req);
    if (token) {
      const tokenHash = sha256(token);
      const cached = accountCache.get(tokenHash);
      if (cached && Date.now() - cached.at < ACCOUNT_CACHE_MS) {
        req.account = cached.account;
      } else {
        const row = await one(`
          ${ACCOUNT_SQL}
          JOIN sessions s ON s.user_id = u.id AND s.token_hash = $1 AND s.expires_at > now()
          GROUP BY u.id
        `, [tokenHash]);
        req.account = row ? buildAccount(row) : undefined;
        if (row) {
          if (accountCache.size > 5000) accountCache.clear();
          accountCache.set(tokenHash, { account: req.account, at: Date.now() });
        } else {
          accountCache.delete(tokenHash);
        }
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireLogin(req, res, next) {
  if (!req.account) return res.status(401).json({ error: 'Please log in again.' });
  next();
}

// Owner passes every check; admins need the named permission. ADMIN_API_KEY acts as owner for server scripts.
export function requireStaff(permission) {
  const adminApiKey = process.env.ADMIN_API_KEY || '';
  return (req, res, next) => {
    const suppliedKey = req.get('x-admin-api-key');
    if (adminApiKey && suppliedKey) {
      const supplied = Buffer.from(suppliedKey);
      const expected = Buffer.from(adminApiKey);
      if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) {
        req.staff = { owner: true, permissions: [...STAFF_PERMISSIONS, 'admins'] };
        return next();
      }
    }
    if (!req.account) return res.status(401).json({ error: 'Please log in again.' });
    const owner = req.account.roles.includes('owner');
    if (!owner && !(req.account.roles.includes('admin') && req.account.permissions.includes(permission))) {
      return res.status(403).json({ error: 'You do not have access to this section.' });
    }
    req.staff = { owner, permissions: req.account.permissions };
    next();
  };
}

export { STAFF_PERMISSIONS };
