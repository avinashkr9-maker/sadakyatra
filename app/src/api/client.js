import Constants from 'expo-constants';

// ─────────────────────────────────────────────────────────────
//  PRODUCTION BACKEND URL
//  Jab backend Railway (ya kahin bhi) pe deploy ho jaaye, uska
//  https URL yahan daal do. Yahi URL customers ke phone use karenge.
//  Example: 'https://sadakyatra-backend.up.railway.app'
//  Khaali rahega to app WhatsApp-only mode me chalega (login/booking
//  in-app off, par call & WhatsApp booking chalta rahega).
// ─────────────────────────────────────────────────────────────
const PROD_URL = 'https://sadakyatra.onrender.com';

const expoHost = Constants?.expoConfig?.hostUri?.split(':')?.[0] || null;

// Manual override (app ke andar "API settings" se set hota hai)
let manualBase = null;
// Resolved working base (ek baar mil gaya to cache)
let resolvedBase = null;
let authToken = null;

export function getBaseUrl() {
  return manualBase || resolvedBase || PROD_URL || '';
}

export function setBaseUrl(url) {
  manualBase = url ? url.trim().replace(/\/+$/, '') : null;
  resolvedBase = null; // force re-resolve with new manual base first
}

export function setAuthToken(token) {
  authToken = token;
}

// Called when the server says the saved login is no longer valid.
let onSessionExpired = null;
export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

function candidateBases() {
  return [
    manualBase,
    PROD_URL,
    expoHost ? `http://${expoHost}:4000` : null,
    'http://10.0.2.2:4000',    // Android emulator -> host machine
    'http://127.0.0.1:4000',
    'http://localhost:4000'
  ].filter(Boolean);
}

// Ek base ko /health pe test karo, chhote timeout ke saath.
// Render free instance so jaata hai aur jagne me ~50s lagta hai,
// isliye PROD_URL ko lamba timeout dete hain taaki galti se
// "offline" na samjhein.
async function ping(base, ms) {
  const timeoutMs = ms || (base === PROD_URL ? 55000 : 2500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok ? base : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// Saare candidates ko EK SAATH (parallel) test karo, jo pehle
// respond kare wahi jeeta. Isse login/booking turant lagta hai.
async function resolveBase() {
  if (resolvedBase) return resolvedBase;
  const bases = candidateBases();
  if (!bases.length) return null;

  resolvedBase = await new Promise((resolve) => {
    let pending = bases.length;
    let settled = false;
    bases.forEach(async (base) => {
      const ok = await ping(base);
      if (settled) return;
      if (ok) {
        settled = true;
        resolve(ok);
      } else if (--pending === 0) {
        resolve(null);
      }
    });
  });
  return resolvedBase;
}

// Warm-up: app khulte hi background me base dhoond lo, taaki
// pehle login/booking pe wait na kare.
export function warmUp() {
  resolveBase().catch(() => {});
}

// Backend reachable hai ya nahi (UI isse WhatsApp-mode dikha sakta hai)
export async function isBackendOnline() {
  const base = await resolveBase();
  return Boolean(base);
}

async function request(path, options = {}, timeoutMs = 8000) {
  const base = await resolveBase();
  if (!base) {
    const err = new Error('OFFLINE');
    err.offline = true;
    throw err;
  }

  const { headers: extraHeaders, skipAuth, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    'Content-Type': 'application/json',
    ...(extraHeaders || {})
  };
  if (authToken && !skipAuth && !headers.Authorization) headers.Authorization = `Bearer ${authToken}`;

  try {
    // fetchOptions is spread first so it can never replace the merged headers
    // (that dropped Content-Type and broke every driver/admin JSON body).
    const res = await fetch(`${base}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const httpError = new Error(data.error || `Request failed (${res.status})`);
      httpError.status = res.status;
      if (res.status === 401 && headers.Authorization && onSessionExpired) onSessionExpired();
      throw httpError;
    }
    return data;
  } catch (err) {
    clearTimeout(timer);
    // Sirf network fail par base bhoolo; 4xx/5xx ka matlab server zinda hai.
    if (!err.status) resolvedBase = null;
    throw err;
  }
}

export function health() {
  return request('/health', {}, 4000);
}
export function getAppConfig() {
  return request('/app/config');
}
export function requestOtp(phone) {
  return request('/auth/otp/request', { method: 'POST', skipAuth: true, body: JSON.stringify({ phone }) }, 20000);
}
export function verifyOtp(phone, code) {
  return request('/auth/otp/verify', { method: 'POST', skipAuth: true, body: JSON.stringify({ phone, code }) }, 20000);
}
export function signup(phone, fullName, password) {
  return request('/auth/signup', { method: 'POST', skipAuth: true, body: JSON.stringify({ phone, fullName, password }) }, 20000);
}
export function loginWithPassword(phone, password) {
  return request('/auth/login', { method: 'POST', skipAuth: true, body: JSON.stringify({ phone, password }) }, 20000);
}
export function changePassword(currentPassword, newPassword) {
  return request('/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}
export function getMe() {
  return request('/me');
}
export function updateMe(profile) {
  return request('/me', { method: 'PATCH', body: JSON.stringify(profile) });
}
export function logoutSession() {
  return request('/auth/logout', { method: 'POST' });
}
export function estimateFare(category, distanceKm, serviceType = 'OUTSTATION', roundTrip = false) {
  return request('/pricing/estimate', {
    method: 'POST',
    body: JSON.stringify({ category, distanceKm, serviceType, roundTrip })
  });
}
export function getWeddingVehicles() {
  return request('/wedding/vehicles', { skipAuth: true });
}
export function createWeddingBooking(payload) {
  return request('/wedding/bookings', { method: 'POST', body: JSON.stringify(payload) }, 15000);
}
// Photo/PDF of a DL, RC or insurance for a pending partner registration.
export function uploadPartnerDocument(applicationId, type, file) {
  return request(`/partners/applications/${applicationId}/documents`, {
    method: 'POST',
    body: JSON.stringify({ type, data: file.data, contentType: file.contentType })
  }, 60000);
}
// All-inclusive prices for every vehicle type for one trip.
export function getQuotes(trip) {
  return request('/pricing/quote', { method: 'POST', skipAuth: true, body: JSON.stringify(trip) }, 15000);
}
export function createBooking(payload) {
  return request('/bookings', { method: 'POST', body: JSON.stringify(payload) });
}
export function submitPartnerApplication(payload) {
  return request('/partners/applications', { method: 'POST', body: JSON.stringify(payload) });
}
export function listBookings() {
  return request('/bookings');
}
export function getBooking(id) {
  return request(`/bookings/${id}`);
}
export function getBookingTracking(id) {
  return request(`/bookings/${id}/tracking`);
}
// Online advance: get the Razorpay payment page, then ask whether it was paid.
export function payAdvance(id) {
  return request(`/bookings/${id}/payment`, { method: 'POST', body: '{}' }, 20000);
}
export function checkAdvance(id) {
  return request(`/bookings/${id}/payment/check`, { method: 'POST', body: '{}' }, 20000);
}
export function cancelBooking(id, note) {
  return request(`/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ note }) });
}
// Driver, vehicle-owner and admin screens: all use the logged-in session.
export function apiRequest(path, method = 'GET', body) {
  return request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}
