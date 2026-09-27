import { sbUrl, sbAnonKey, sbConfigured } from '@/lib/supabaseConfig';

export const dynamic = 'force-dynamic';

// Website ka fare calculator yahan se rates + routes leta hai.
// Admin panel mein save karo → 1 minute ke andar website pe dikhega.
export async function GET() {
  if (!sbConfigured()) {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }
  const SUPABASE_URL = sbUrl();
  const headers = { apikey: sbAnonKey(), Authorization: `Bearer ${sbAnonKey()}` };
  try {
    const [ratesRes, routesRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/web_fare_rates?select=key,value`, { headers, cache: 'no-store' }),
      fetch(`${SUPABASE_URL}/rest/v1/web_fare_routes?select=from_city,to_city,distance_km&active=eq.true&limit=10000`, { headers, cache: 'no-store' }),
    ]);
    if (!ratesRes.ok || !routesRes.ok) throw new Error(`Supabase ${ratesRes.status}/${routesRes.status}`);
    const rates = {};
    for (const r of await ratesRes.json()) rates[r.key] = Number(r.value);
    const routes = {};
    for (const r of await routesRes.json()) routes[`${r.from_city}|${r.to_city}`] = r.distance_km;
    return Response.json(
      { rates, routes },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (e) {
    return Response.json({ error: 'fetch_failed', detail: String(e.message || e) }, { status: 502 });
  }
}
