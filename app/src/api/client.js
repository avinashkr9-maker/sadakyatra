import Constants from 'expo-constants';

let BASE_URL = 'http://192.168.29.135:4000';

export function getBaseUrl() {
  return BASE_URL;
}

export function setBaseUrl(url) {
  BASE_URL = url.trim().replace(/\/+$/, '');
}

let authToken = null;

async function request(path, options = {}) {
  const expoHost = Constants?.expoConfig?.hostUri?.split(':')?.[0];
  const candidates = [
    BASE_URL,
    expoHost ? `http://${expoHost}:4000` : null,
    'http://10.0.2.2:4000',
    'http://127.0.0.1:4000'
  ].filter(Boolean);

  let lastErr = null;
  for (const base of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };
      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }
      const res = await fetch(`${base}${path}`, {
        headers,
        signal: controller.signal,
        ...options
      });
      clearTimeout(timeout);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      BASE_URL = base;
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Network request failed. Tried: ${candidates.join(', ')}. Last error: ${lastErr?.message || 'unknown'}`
  );
}

export function health() {
  return request('/health');
}
export function getAppConfig() {
  return request('/app/config');
}
export function login(phone, fullName) {
  return request('/auth/mock-login', {
    method: 'POST',
    body: JSON.stringify({ phone, fullName })
  });
}
export function setAuthToken(token) {
  authToken = token;
}
export function estimateFare(origin, destination, category) {
  return request('/pricing/estimate', { method: 'POST', body: JSON.stringify({ origin, destination, category }) });
}
export function createBooking(payload) {
  return request('/bookings', { method: 'POST', body: JSON.stringify(payload) });
}
export function listBookings(phone) {
  return request(`/bookings?phone=${encodeURIComponent(phone)}`);
}
export function getBooking(id) {
  return request(`/bookings/${id}`);
}
export function cancelBooking(id, phone, note) {
  return request(`/bookings/${id}/cancel`, { method: 'POST', body: JSON.stringify({ phone, note }) });
}
