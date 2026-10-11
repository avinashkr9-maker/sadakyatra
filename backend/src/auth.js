import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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

// "9304057169:482913,9000000001:111111" -> fixed codes for testing before an SMS provider is set up.
function testCodes() {
  const codes = new Map();
  for (const entry of String(process.env.OTP_TEST_NUMBERS || '').split(',')) {
    const [phone, code] = entry.split(':').map((part) => part?.trim());
    if (isValidIndianPhone(phone || '') && /^\d{6}$/.test(code || '')) codes.set(phone, code);
  }
  return codes;
}

export class OtpUnavailableError extends Error {}

// No SMS provider yet: only numbers listed in OTP_TEST_NUMBERS can log in.
async function deliverOtp(phone) {
  const fixed = testCodes().get(phone);
  if (fixed) return fixed;
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
export async function loginWithPhone(phone) {
  return transaction(async (client) => {
    const user = await findOrCreateUser(phone, null, client);
    await query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'customer') ON CONFLICT DO NOTHING", [user.id], client);
    if (normalizePhone(process.env.OWNER_PHONE) === phone) {
      await query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'owner') ON CONFLICT DO NOTHING", [user.id], client);
    }
    return user;
  });
}

export async function loadAccount(userId) {
  const user = await one('SELECT id, full_name, phone, email FROM users WHERE id = $1', [userId]);
  if (!user) return null;
  const roleRows = await query('SELECT role, permissions FROM user_roles WHERE user_id = $1', [userId]);
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

// Attaches req.account when a valid session token is sent; never rejects on its own.
export async function authenticate(req, _res, next) {
  try {
    const token = bearer(req);
    if (token) {
      const session = await one('SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)]);
      if (session) req.account = await loadAccount(session.user_id);
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
