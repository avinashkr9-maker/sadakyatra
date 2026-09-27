import { sbUrl, sbAnonKey, sbServiceKey } from '@/lib/supabaseConfig';

export const dynamic = 'force-dynamic';

// Setup check — koi secret value nahi dikhata, sirf batata hai kya mila aur kya sahi hai
function jwtInfo(key) {
  if (!key) return { present: false };
  if (key.startsWith('sb_publishable_')) return { present: true, format: 'new publishable key', role: 'anon' };
  if (key.startsWith('sb_secret_')) return { present: true, format: 'new secret key', role: 'service_role' };
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return { present: true, format: 'JWT', role: payload.role || '?', project: payload.ref || '?' };
  } catch {
    return { present: true, format: 'unrecognised (check for extra spaces or a wrong copy)' };
  }
}

export async function GET() {
  const url = sbUrl();
  const urlRef = (/^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(url) || [])[1] || null;
  const anon = jwtInfo(sbAnonKey());
  const service = jwtInfo(sbServiceKey());
  const problems = [];
  if (!url) problems.push('NEXT_PUBLIC_SUPABASE_URL is missing');
  else if (!urlRef) problems.push('NEXT_PUBLIC_SUPABASE_URL should look like https://xxxx.supabase.co (no extra path)');
  if (!anon.present) problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing');
  else if (anon.role !== 'anon') problems.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY has role "${anon.role}" — it should be the anon/publishable key`);
  if (!service.present) problems.push('SUPABASE_SERVICE_ROLE_KEY is missing (needed only to create drivers)');
  else if (service.role !== 'service_role') problems.push(`SUPABASE_SERVICE_ROLE_KEY has role "${service.role}" — it should be the service_role/secret key`);
  for (const [name, k] of [['anon', anon], ['service', service]]) {
    if (k.project && urlRef && k.project !== urlRef) problems.push(`The ${name} key belongs to a different Supabase project than the URL`);
  }
  let reachable = null;
  if (urlRef && anon.present) {
    try {
      const r = await fetch(`${url}/rest/v1/web_fare_rates?select=key&limit=1`, { headers: { apikey: sbAnonKey(), Authorization: `Bearer ${sbAnonKey()}` }, cache: 'no-store' });
      reachable = r.ok;
      if (!r.ok) problems.push(`Supabase answered with status ${r.status} (check the anon key, or run setup.sql)`);
    } catch {
      reachable = false;
      problems.push('Could not reach Supabase from the server');
    }
  }
  return Response.json({
    ok: problems.length === 0,
    supabase_url: url ? { present: true, project: urlRef } : { present: false },
    anon_key: anon,
    service_role_key: service,
    database_reachable: reachable,
    problems,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
