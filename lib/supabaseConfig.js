// Supabase settings — SERVER pe har request ke time padhi jaati hain (build ke time nahi).
// process.env[naam] wala tareeka isliye, taaki Next.js inhe build mein "freeze" na kare.
const read = (name) => String(process.env[name] || '').trim().replace(/^["']|["']$/g, '');

export const sbUrl = () => read('NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
export const sbAnonKey = () => read('NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const sbServiceKey = () => read('SUPABASE_SERVICE_ROLE_KEY');
export const sbConfigured = () => Boolean(sbUrl() && sbAnonKey());

// Browser (admin / driver app) ko dene ke liye — sirf public values
export const publicSupabaseConfig = () => ({ url: sbUrl(), anonKey: sbAnonKey() });
