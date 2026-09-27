import { SUPABASE_URL, SUPABASE_ANON_KEY, supabaseConfigured } from './supabaseConfig';

// Server se Supabase ko request (anon key, ya admin ke login token ke saath)
export async function sbRest(path, { token, ...init } = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`, ...(init.headers || {}) },
  });
}

// Check: request bhejne wala sach mein admin hai?
export async function isAdminRequest(req) {
  if (!supabaseConfigured) return false;
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
