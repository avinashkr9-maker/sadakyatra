import { one, query } from './db.js';

// Prices change rarely; keep them for a short while instead of reading the database on every quote.
const CACHE_MS = 30_000;
let cache = null;

export async function loadPricing({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const [categories, settings, routes] = await Promise.all([
    query('SELECT * FROM vehicle_categories ORDER BY sort_order, key'),
    one('SELECT * FROM pricing_settings WHERE id = 1'),
    query('SELECT * FROM fixed_routes WHERE active ORDER BY id')
  ]);
  const data = { categories, settings, routes };
  cache = { at: Date.now(), data };
  return data;
}

export function clearPricingCache() {
  cache = null;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const near = (point, lat, lng, radius) => point?.latitude != null && point?.longitude != null
  && distanceKm(point.latitude, point.longitude, lat, lng) <= radius;

// A fixed route matches when both pins are near its ends, in either direction.
function findFixedRoute(routes, category, pickup, drop) {
  return routes.find((route) => route.category === category && (
    (near(pickup, route.origin_lat, route.origin_lng, route.radius_km) && near(drop, route.dest_lat, route.dest_lng, route.radius_km))
    || (near(pickup, route.dest_lat, route.dest_lng, route.radius_km) && near(drop, route.origin_lat, route.origin_lng, route.radius_km))
  )) || null;
}

// Calendar days the cab is away on a round trip (at least 1).
export function tripDays(tripDatetime, returnDatetime) {
  if (!returnDatetime) return 1;
  const hours = (new Date(returnDatetime) - new Date(tripDatetime)) / 3600e3;
  return Math.max(1, Math.ceil(hours / 24));
}

/**
 * Final all-inclusive price for one vehicle type, or null when it can't be priced yet.
 * tripType: ONE_WAY | ROUND_TRIP | LOCAL. Driver payout = (total - GST) less SadakYatra's commission.
 */
export function quoteFor(pricing, category, { distanceKm: km, tripType, tripDatetime, returnDatetime, pickup, drop }) {
  const rate = pricing.categories.find((item) => item.key === category && item.active);
  if (!rate) return null;
  const { toll_per_km: tollPerKm, gst_percent: gstPercent, commission_percent: commission } = pricing.settings;
  const withGst = (subtotal) => Math.round((subtotal * gstPercent) / 100);
  const payout = (total, gst) => Math.round((total - gst) * (1 - commission / 100));

  if (tripType === 'LOCAL') {
    const baseFare = Math.round(rate.local_fare);
    const gst = withGst(baseFare);
    return { tripType, baseFare, driverAllowance: 0, tollAndParking: 0, gst, total: baseFare + gst, days: 1, billedKm: null, driverPayout: payout(baseFare + gst, gst), fixedRouteId: null };
  }
  if (!(km > 0)) return null;

  const days = tripType === 'ROUND_TRIP' ? tripDays(tripDatetime, returnDatetime) : 1;
  const fixed = findFixedRoute(pricing.routes, category, pickup, drop);
  const fixedTotal = fixed && (tripType === 'ROUND_TRIP' ? fixed.round_trip_fare : fixed.one_way_fare);
  if (fixedTotal) {
    // Fixed prices are all-inclusive; GST is the share already inside them.
    const total = Math.round(fixedTotal);
    const gst = Math.round(total - total / (1 + gstPercent / 100));
    return { tripType, baseFare: total - gst, driverAllowance: 0, tollAndParking: 0, gst, total, days, billedKm: null, driverPayout: payout(total, gst), fixedRouteId: fixed.id, fixedRoute: `${fixed.origin_name} – ${fixed.dest_name}` };
  }

  let baseFare;
  let billedKm;
  const multiplier = pricing.settings.round_trip_multiplier;
  if (tripType === 'ROUND_TRIP' && multiplier > 0) {
    // Rate-sheet style: a round trip costs the one-way fare times the multiplier (e.g. 1.75).
    billedKm = Math.round(km * 2);
    baseFare = Math.round(Math.max(rate.base_fare + km * rate.per_km, rate.min_fare) * multiplier);
  } else if (tripType === 'ROUND_TRIP') {
    // Charged on the km driven there and back, but at least the minimum km for each day away.
    billedKm = Math.max(Math.round(km * 2), Math.round(rate.rt_min_km_per_day * days));
    baseFare = Math.round(Math.max(rate.base_fare + billedKm * rate.rt_per_km, rate.min_fare));
  } else {
    billedKm = Math.round(km);
    baseFare = Math.round(Math.max(rate.base_fare + km * rate.per_km, rate.min_fare));
  }
  const driverAllowance = Math.round(rate.driver_allowance * days);
  const tollAndParking = Math.round(km * tollPerKm * (tripType === 'ROUND_TRIP' ? 2 : 1));
  const gst = withGst(baseFare + driverAllowance + tollAndParking);
  const total = baseFare + driverAllowance + tollAndParking + gst;
  return { tripType, baseFare, driverAllowance, tollAndParking, gst, total, days, billedKm, driverPayout: payout(total, gst), fixedRouteId: null };
}

// What the app shows: active vehicle types with their rates, and the shared settings.
export function publicPricing(pricing) {
  return {
    categories: pricing.categories.filter((item) => item.active).map((item) => ({
      key: item.key,
      name: item.name,
      seats: item.seats_label,
      models: item.models,
      perKm: item.per_km,
      minFare: item.min_fare,
      localFare: item.local_fare,
      roundTripPerKm: item.rt_per_km,
      roundTripMinKmPerDay: item.rt_min_km_per_day,
      driverAllowance: item.driver_allowance
    })),
    tollPerKm: pricing.settings.toll_per_km,
    gstPercent: pricing.settings.gst_percent
  };
}
