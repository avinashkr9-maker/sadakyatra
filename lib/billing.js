// Billing ke common helpers (driver app, admin, public bill — sab jagah same hisaab)

export const DRIVER_EMAIL_DOMAIN = 'driver.sadakyatra.app';

// Phone number ko 10 digit mein saaf karo: "+91 90000 00001" → "9000000001"
export function cleanPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}
export const driverEmail = (phone) => `${cleanPhone(phone)}@${DRIVER_EMAIL_DOMAIN}`;

export const VEHICLES = { sedan: 'Sedan', suv: 'SUV', tempo: 'Tempo Traveller' };
export const TRIP_TYPES = { outstation: 'Outstation / Route', local: 'Local (full day)', custom: 'Custom amount' };

export function money(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Website calculator jaisa hi fare (sirf preview; asli hisaab database karta hai)
export function previewFare({ tripType, vehicle, km, roundTrip }, rates) {
  if (tripType === 'local') return vehicle === 'suv' ? rates.localSuvFare : vehicle === 'sedan' ? rates.localSedanFare : null;
  if (tripType !== 'outstation' || !km) return null;
  const perKm = vehicle === 'suv' ? rates.suvPerKm : vehicle === 'tempo' ? rates.tempoPerKm : rates.sedanPerKm;
  let f = km * (perKm || 0);
  if (roundTrip) f *= rates.roundTripMultiplier || 1;
  return Math.max(Math.round(f / 10) * 10, rates.minimumFare || 0);
}

export function upiLink({ upiId, upiName, amount, note }) {
  if (!upiId) return '';
  const q = new URLSearchParams({ pa: upiId, pn: upiName || 'SadakYatra', am: Number(amount || 0).toFixed(2), cu: 'INR', tn: note || 'SadakYatra bill' });
  return `upi://pay?${q.toString()}`;
}
