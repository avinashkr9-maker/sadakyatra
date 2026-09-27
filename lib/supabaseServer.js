import { sbUrl, sbAnonKey, sbConfigured } from './supabaseConfig';

// Server se Supabase ko request (anon key, ya admin ke login token ke saath)
export async function sbRest(path, { token, ...init } = {}) {
  return fetch(`${sbUrl()}${path}`, {
    ...init,
    headers: { apikey: sbAnonKey(), Authorization: `Bearer ${token || sbAnonKey()}`, ...(init.headers || {}) },
  });
}

// Check: request bhejne wala sach mein admin hai?
export async function isAdminRequest(req) {
  if (!sbConfigured()) return false;
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const u = await sbRest('/auth/v1/user', { token, cache: 'no-store' });
    if (!u.ok) return false;
    const user = await u.json();
    const a = await sbRest(`/rest/v1/web_admins?select=user_id&user_id=eq.${encodeURIComponent(user.id)}`, { token, cache: 'no-store' });
    if (!a.ok) return false;
    return (await a.json()).length > 0;
  } catch {
    return false;
  }
}
