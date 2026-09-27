import { sbUrl, sbConfigured, sbServiceKey } from '@/lib/supabaseConfig';
import { isAdminRequest } from '@/lib/supabaseServer';
import { cleanPhone, driverEmail } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Service role key SIRF server pe (Vercel env). Kabhi NEXT_PUBLIC_ mat lagana.

function svc(path, init = {}) {
  const SERVICE_KEY = sbServiceKey();
  return fetch(`${sbUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}
const fail = (status, error) => Response.json({ error }, { status });

async function guard(req) {
  if (!sbConfigured()) return fail(503, 'Supabase is not configured.');
  if (!sbServiceKey()) return fail(503, 'SUPABASE_SERVICE_ROLE_KEY is missing. Add it to .env.local (and Vercel env), then restart the server.');
  if (!(await isAdminRequest(req))) return fail(401, 'Only the owner can manage drivers.');
  return null;
}

// Naya driver account
export async function POST(req) {
  const g = await guard(req); if (g) return g;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const phone = cleanPhone(body.phone);
  const pin = String(body.pin || '').trim();
  if (!name) return fail(400, 'Driver name is required.');
  if (phone.length !== 10) return fail(400, 'Enter a valid 10-digit phone number.');
  if (!/^\d{6,}$/.test(pin)) return fail(400, 'PIN must be at least 6 digits.');

  const u = await svc('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: driverEmail(phone), password: pin, email_confirm: true, user_metadata: { name, phone, role: 'driver' } }),
  });
  const user = await u.json().catch(() => ({}));
  if (!u.ok) {
    const msg = String(user.msg || user.message || user.error_description || '');
    if (/already|exists|registered/i.test(msg)) return fail(409, 'A driver with this phone number already exists.');
    return fail(400, msg || 'Could not create the login.');
  }
  const ins = await svc('/rest/v1/web_drivers', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: user.id, name, phone, active: true }),
  });
  if (!ins.ok) {
    await svc(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' }); // aadha bana account hatao
    return fail(400, 'Could not save the driver profile.');
  }
  const [driver] = await ins.json();
  return Response.json({ driver });
}

// PIN reset / band / chalu / naam badlo
export async function PATCH(req) {
  const g = await guard(req); if (g) return g;
  const { user_id, action, pin, name } = await req.json().catch(() => ({}));
  if (!user_id) return fail(400, 'Missing driver.');
  let authPatch = null, rowPatch = null;
  if (action === 'reset_pin') {
    if (!/^\d{6,}$/.test(String(pin || ''))) return fail(400, 'PIN must be at least 6 digits.');
    authPatch = { password: String(pin) };
  } else if (action === 'deactivate') {
    authPatch = { ban_duration: '876000h' }; rowPatch = { active: false };
  } else if (action === 'activate') {
    authPatch = { ban_duration: 'none' }; rowPatch = { active: true };
  } else if (action === 'rename') {
    if (!String(name || '').trim()) return fail(400, 'Name is required.');
    rowPatch = { name: String(name).trim() };
  } else return fail(400, 'Unknown action.');

  if (authPatch) {
    const r = await svc(`/auth/v1/admin/users/${encodeURIComponent(user_id)}`, { method: 'PUT', body: JSON.stringify(authPatch) });
    if (!r.ok) return fail(400, 'Could not update the login.');
  }
  if (rowPatch) {
    const r = await svc(`/rest/v1/web_drivers?user_id=eq.${encodeURIComponent(user_id)}`, { method: 'PATCH', body: JSON.stringify(rowPatch) });
    if (!r.ok) return fail(400, 'Could not update the driver.');
  }
  return Response.json({ ok: true });
}
