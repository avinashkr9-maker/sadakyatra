import express from 'express';
import cors from 'cors';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import { one, query, transaction } from './db.js';
import { getPartnerDocumentsBucket, getSupabaseAdmin } from './supabase.js';
import {
  OtpUnavailableError, STAFF_PERMISSIONS, authenticate, checkOtp, createSession, endSession, findOrCreateUser,
  grantRole, isValidIndianPhone, loadAccount, loginWithPhone, normalizePhone, requestOtp, requireLogin, requireStaff
} from './auth.js';
import { CHANNELS, notifyStaff, notifyUsers } from './notify.js';

const app = express();
// Express 4 does not catch rejected promises from async handlers.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const port = process.env.PORT || 4000;
const nano = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8);

app.use(cors());
app.use(express.json());
app.use(authenticate);

const validCategories = new Set(['sedan', 'suv', 'traveller']);
const validServiceTypes = new Set(['OUTSTATION', 'AIRPORT', 'WEDDING', 'LOCAL']);
// Single source of truth for pricing. The app downloads this via /app/config
// and falls back to an identical copy when the backend is unreachable.
const fareConfig = {
  categories: {
    sedan: { perKm: 23, minimumFare: 1500, localFare: 1500 },
    suv: { perKm: 27, minimumFare: 1500, localFare: 2000 },
    traveller: { perKm: 35, minimumFare: 3500, localFare: 3500 }
  },
  roundTripMultiplier: 1.75,
  driverAllowance: 300,
  tollPerKm: 1.5,
  gstPercent: 5
};
const gpsWebhookSecret = process.env.GPS_WEBHOOK_SECRET || '';
const rateLimitHits = new Map();

function calculateFareBreakdown(category, distanceKm, serviceType, roundTrip = false) {
  const rate = fareConfig.categories[category];
  if (!rate) return null;
  const isLocal = serviceType === 'LOCAL';
  if (!isLocal && (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0)) return null;

  const baseFare = isLocal
    ? rate.localFare
    : Math.round(Math.max(distanceKm * rate.perKm, rate.minimumFare) * (roundTrip ? fareConfig.roundTripMultiplier : 1));
  const driverAllowance = isLocal ? 0 : fareConfig.driverAllowance;
  const tollAndParking = isLocal ? 0 : Math.round(distanceKm * fareConfig.tollPerKm * (roundTrip ? 2 : 1));
  const subtotal = baseFare + driverAllowance + tollAndParking;
  const gst = Math.round((subtotal * fareConfig.gstPercent) / 100);
  return { baseFare, driverAllowance, tollAndParking, gst, total: subtotal + gst };
}

function calculateFare(category, distanceKm, serviceType, roundTrip = false) {
  return calculateFareBreakdown(category, distanceKm, serviceType, roundTrip)?.total ?? null;
}

function publicBooking(booking) {
  if (!booking) return booking;
  const { tracking_token_hash: _trackingTokenHash, ...safeBooking } = booking;
  return safeBooking;
}

// In-memory limiter: at most max hits per key within windowMs.
function rateLimit(name, max, windowMs, keyOf = (req) => req.ip) {
  return (req, res, next) => {
    const key = `${name}:${keyOf(req)}`;
    const now = Date.now();
    const recent = (rateLimitHits.get(key) || []).filter((time) => time > now - windowMs);
    if (recent.length >= max) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
    recent.push(now);
    rateLimitHits.set(key, recent);
    next();
  };
}

// The logged-in user must be an approved, active driver.
const requireDriver = handle(async (req, res, next) => {
  if (!req.account) return res.status(401).json({ error: 'Please log in again.' });
  const driver = await one(`
    SELECT d.*, p.active AS partner_active
    FROM drivers d
    JOIN partners p ON p.id = d.partner_id
    WHERE d.user_id = $1 AND d.is_active AND p.active
  `, [req.account.id]);
  if (!driver) return res.status(403).json({ error: 'Your cab partner account is not active.' });
  req.driver = driver;
  next();
});

const getBooking = (id) => one('SELECT * FROM bookings WHERE id = $1', [id]);

const appConfig = {
  brand: {
    name: 'SadakYatra',
    rating: 4.9,
    reviewCount: 40,
    phone: '+919304057169',
    whatsapp: 'https://wa.me/919304057169',
    logoUrl: 'https://plain-apac-prod-public.komododecks.com/202604/12/yU2ygE8uhy2XVXaRsUyW/image.png',
    accent: '#FFCC00',
    location: 'Novel Nook Library, Ramdayalu Nagar, Muzaffarpur, Bihar'
  },
  services: ['OUTSTATION', 'AIRPORT', 'WEDDING', 'LOCAL'],
  categories: ['sedan', 'suv', 'traveller'],
  routes: ['Muzaffarpur', 'Patna', 'Darbhanga', 'Sitamarhi', 'Motihari', 'Samastipur', 'Raxaul'],
  faqs: [
    {
      q: 'How fast can booking be confirmed?',
      a: 'Most requests are confirmed in minutes on WhatsApp or call.'
    },
    {
      q: 'Any hidden charges?',
      a: 'No. The final payable price shown before booking already includes driver allowance, toll, parking, and GST.'
    },
    {
      q: 'Do you support wedding packages?',
      a: 'Yes. Wedding package starts around Rs 4500 and includes decoration and chauffeur.'
    }
  ],
  testimonials: [
    { name: 'Arvind Singh', rating: 5, text: 'Wedding car was decorated and arrived on time. Highly recommended.' },
    { name: 'Pooja Verma', rating: 5, text: 'Drop Only trip was smooth and driver was punctual and professional.' },
    { name: 'Ravi Thakur', rating: 5, text: 'Transparent rates, clean car, and safe experience.' }
  ],
  fareConfig
};

app.get('/', (_req, res) => {
  res.send('SadakYatra backend is running');
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'sadakyatra-backend' });
});

// Reports only the error code (never the message) so connection problems can be diagnosed safely.
app.get('/health/db', async (_req, res) => {
  try {
    await query('SELECT 1 FROM bookings LIMIT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ ok: false, code: error.code || error.name || 'UNKNOWN' });
  }
});

app.get('/app/config', (_req, res) => {
  res.json(appConfig);
});

app.get('/config', (_req, res) => {
  res.json(appConfig);
});

// ---- Login (mobile OTP) -------------------------------------------------
const otpPhone = (req) => normalizePhone(req.body?.phone);

app.post('/auth/otp/request', rateLimit('otp-ip', 30, 15 * 60_000), handle(async (req, res) => {
  const phone = otpPhone(req);
  if (!isValidIndianPhone(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  try {
    const result = await requestOtp(phone);
    if (result.retryAfter) {
      return res.status(429).json({ error: `Please wait ${result.retryAfter} seconds before asking for a new code.`, retryAfter: result.retryAfter });
    }
    res.json({ sent: true });
  } catch (error) {
    if (error instanceof OtpUnavailableError) {
      return res.status(503).json({ error: 'SMS login is not available yet. Please call or WhatsApp SadakYatra to book.' });
    }
    throw error;
  }
}));

app.post('/auth/otp/verify', rateLimit('otp-verify-ip', 60, 15 * 60_000), handle(async (req, res) => {
  const phone = otpPhone(req);
  const code = String(req.body?.code || '').trim();
  if (!isValidIndianPhone(phone) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the 6-digit code sent to your mobile.' });
  }
  if (!(await checkOtp(phone, code))) return res.status(401).json({ error: 'Wrong or expired code. Please try again.' });
  const user = await loginWithPhone(phone);
  const token = await createSession(user.id);
  res.json({ token, account: await loadAccount(user.id) });
}));

app.post('/auth/logout', requireLogin, handle(async (req, res) => {
  await endSession(req.get('authorization').replace(/^Bearer\s+/i, ''));
  res.json({ ok: true });
}));

// Who is logged in, their roles, and where their partner application stands.
async function accountWithPartner(account) {
  const application = await one(`
    SELECT id, application_ref, status, partner_type, vehicle_number, vehicle_category, vehicle_model, review_note, created_at
    FROM partner_applications WHERE applicant_user_id = $1 ORDER BY id DESC LIMIT 1
  `, [account.id]);
  return { ...account, partnerApplication: application || null };
}

app.get('/me', requireLogin, handle(async (req, res) => {
  res.json({ account: await accountWithPartner(req.account) });
}));

app.patch('/me', requireLogin, handle(async (req, res) => {
  const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (fullName.length < 2 || fullName.length > 80) return res.status(400).json({ error: 'Please enter your full name.' });
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return res.status(400).json({ error: 'Please enter a valid email address, or leave it empty.' });
  }
  await query('UPDATE users SET full_name = $1, email = $2 WHERE id = $3', [fullName, email || null, req.account.id]);
  res.json({ account: await accountWithPartner(await loadAccount(req.account.id)) });
}));

// A vehicle owner's own cabs and drivers, with each cab's live status.
app.get('/partner/fleet', requireLogin, handle(async (req, res) => {
  const fleet = await query(`
    SELECT p.partner_ref, p.active AS partner_active, v.id AS vehicle_id, v.cab_ref, v.plate_no, v.category, v.model,
      v.active AS vehicle_active, d.driver_name, d.phone AS driver_phone, d.is_online,
      current.booking_ref AS current_booking_ref, current.driver_status AS current_driver_status
    FROM partners p
    JOIN vehicles v ON v.partner_id = p.id
    LEFT JOIN drivers d ON d.id = v.driver_id
    LEFT JOIN bookings current ON current.id = (
      SELECT b.id FROM bookings b WHERE b.vehicle_id = v.id AND b.status IN ('CONFIRMED','ONGOING')
      ORDER BY b.updated_at DESC LIMIT 1
    )
    WHERE p.user_id = $1
    ORDER BY v.id
  `, [req.account.id]);
  res.json({ fleet });
}));

// ---- Owner manages admin accounts ----------------------------------------
app.get('/admin/admins', requireStaff('admins'), handle(async (_req, res) => {
  const admins = await query(`
    SELECT u.id, u.full_name, u.phone, r.permissions, r.created_at
    FROM user_roles r JOIN users u ON u.id = r.user_id
    WHERE r.role = 'admin' ORDER BY r.created_at
  `);
  res.json({ admins });
}));

app.post('/admin/admins', requireStaff('admins'), handle(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
  const permissions = Array.isArray(req.body.permissions) ? [...new Set(req.body.permissions)] : [];
  if (!isValidIndianPhone(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  if (!permissions.length || permissions.some((item) => !STAFF_PERMISSIONS.includes(item))) {
    return res.status(400).json({ error: `Choose at least one permission: ${STAFF_PERMISSIONS.join(', ')}` });
  }
  const admin = await transaction(async (client) => {
    const user = await findOrCreateUser(phone, fullName || null, client);
    await grantRole(user.id, 'admin', permissions, client);
    return user;
  });
  res.status(201).json({ admin: { id: admin.id, full_name: admin.full_name, phone, permissions } });
}));

app.delete('/admin/admins/:userId', requireStaff('admins'), handle(async (req, res) => {
  const removed = await one("DELETE FROM user_roles WHERE user_id = $1 AND role = 'admin' RETURNING user_id", [Number(req.params.userId)]);
  if (!removed) return res.status(404).json({ error: 'Admin not found' });
  res.json({ removed: true });
}));

// ---- Cab partner registration (from a logged-in account) -----------------
app.post('/partners/applications', requireLogin, rateLimit('partner-apply', 5, 60 * 60_000, (req) => req.account.id), handle(async (req, res) => {
  const { partnerType = 'driver', vehicleNumber, vehicleCategory, vehicleModel, seats, city, operatingArea } = req.body;
  const fullName = String(req.body.fullName || req.account.fullName || '').trim();
  const phone = req.account.phone;
  // A driver drives their own cab; a vehicle owner names the driver (who may be themselves).
  const driverName = partnerType === 'driver' ? fullName : String(req.body.driverName || '').trim();
  const driverPhone = partnerType === 'driver' ? phone : normalizePhone(req.body.driverPhone);
  const plate = String(vehicleNumber || '').trim().toUpperCase();

  if (!['driver', 'vehicle_owner'].includes(partnerType)) {
    return res.status(400).json({ error: 'Choose whether you are a driver or a vehicle owner' });
  }
  if ([fullName, vehicleModel, driverName, city, operatingArea].some((value) => typeof value !== 'string' || value.trim().length < 2 || value.length > 120)) {
    return res.status(400).json({ error: 'Name, model, driver, city, and operating area are required' });
  }
  if (!isValidIndianPhone(driverPhone)) {
    return res.status(400).json({ error: 'Enter a valid 10-digit mobile number for the driver' });
  }
  if (!/^[A-Z0-9 -]{6,20}$/.test(plate)) {
    return res.status(400).json({ error: 'Enter a valid vehicle registration number' });
  }
  if (!validCategories.has(vehicleCategory)) {
    return res.status(400).json({ error: 'Vehicle type must be sedan, suv, or traveller' });
  }
  if (seats != null && (!Number.isInteger(Number(seats)) || Number(seats) < 1 || Number(seats) > 60)) {
    return res.status(400).json({ error: 'Seats must be between 1 and 60' });
  }
  const pending = await one("SELECT id FROM partner_applications WHERE applicant_user_id = $1 AND status = 'PENDING'", [req.account.id]);
  if (pending) return res.status(409).json({ error: 'Your registration is already waiting for SadakYatra approval.' });

  const application = await transaction(async (client) => {
    if (!req.account.fullName) await query('UPDATE users SET full_name = $1 WHERE id = $2', [fullName, req.account.id], client);
    // The applicant proved their number with OTP; a different driver number is checked when that driver logs in.
    return one(`
      INSERT INTO partner_applications (
        application_ref, full_name, phone, vehicle_number, vehicle_category, vehicle_model,
        seats, driver_name, driver_phone, city, operating_area, applicant_user_id, partner_type, phone_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)
      RETURNING id, application_ref, status, partner_type
    `, [`SY-APP-${nano()}`, fullName, phone, plate, vehicleCategory, String(vehicleModel).trim(),
      seats == null ? null : Number(seats), driverName, driverPhone, city.trim(), operatingArea.trim(),
      req.account.id, partnerType], client);
  });

  notifyStaff('partners', {
    title: `New cab partner · ${application.application_ref}`,
    body: `${fullName} (+91 ${phone}) · ${partnerType === 'vehicle_owner' ? 'Vehicle owner' : 'Driver'} · ${plate} ${String(vehicleModel).trim()}`
  });
  res.status(201).json({
    application: {
      id: application.id,
      applicationRef: application.application_ref,
      status: application.status,
      partnerType: application.partner_type,
      message: 'Registration submitted. Waiting for SadakYatra approval.'
    }
  });
}));

app.post('/pricing/estimate', (req, res) => {
  const { category, distanceKm, serviceType = 'OUTSTATION', roundTrip = false } = req.body;
  if (!category) return res.status(400).json({ error: 'category is required' });
  if (!validCategories.has(category)) {
    return res.status(400).json({ error: 'category must be sedan, suv, or traveller' });
  }
  if (!validServiceTypes.has(serviceType)) {
    return res.status(400).json({ error: 'Invalid serviceType' });
  }
  if (typeof roundTrip !== 'boolean') {
    return res.status(400).json({ error: 'roundTrip must be a boolean' });
  }

  if (distanceKm == null && serviceType !== 'LOCAL') {
    return res.status(400).json({ error: 'distanceKm is required for a rate-card estimate' });
  }

  const parsedDistance = distanceKm == null ? null : Number(distanceKm);
  if (parsedDistance != null && (!Number.isFinite(parsedDistance) || parsedDistance <= 0)) {
    return res.status(400).json({ error: 'distanceKm must be a positive number' });
  }
  const breakdown = calculateFareBreakdown(category, parsedDistance, serviceType, roundTrip);
  return res.json({
    category,
    distanceKm: parsedDistance,
    serviceType,
    roundTrip,
    estimatedFare: breakdown?.total ?? null,
    breakdown
  });
});

// ---- Booking flow ---------------------------------------------------------
// Customer requests -> admin approves -> eligible online drivers see it -> first to accept gets it.
const STATUS_LABELS = {
  PENDING_APPROVAL: 'waiting for approval',
  ON_HOLD: 'on hold',
  REJECTED: 'rejected',
  APPROVED: 'searching for a driver',
  DRIVER_NOT_FOUND: 'without a driver',
  CONFIRMED: 'confirmed with a driver',
  ONGOING: 'on its trip',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};
const OPEN_FOR_ADMIN = ['PENDING_APPROVAL', 'ON_HOLD', 'APPROVED', 'DRIVER_NOT_FOUND'];
const CANCELLABLE = [...OPEN_FOR_ADMIN, 'CONFIRMED'];
const DRIVER_SEARCH_MINUTES = Number(process.env.DRIVER_SEARCH_MINUTES || 15);
const DISPATCH_RADIUS_KM = Number(process.env.DISPATCH_RADIUS_KM || 80);
// A cab cannot take two trips that start within this many hours of each other.
const TRIP_GAP_SECONDS = Number(process.env.TRIP_GAP_HOURS || 4) * 3600;
const CATEGORY_NAMES = { sedan: 'Sedan', suv: 'SUV', traveller: 'Tempo Traveller' };

class BookingError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function tripTime(value) {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit'
  });
}
const tripLine = (booking) => `${booking.pickup_text} → ${booking.drop_text}, ${tripTime(booking.trip_datetime)}`;

function recordStatus(client, bookingId, oldStatus, newStatus, actorId, note) {
  return query(`
    INSERT INTO booking_status_events (booking_id, old_status, new_status, changed_by_user_id, note)
    VALUES ($1, $2, $3, $4, $5)
  `, [bookingId, oldStatus, newStatus, actorId, note], client);
}

// Locks the booking, checks it is in an allowed status, runs guard, then moves it and records the change.
// fields may be a function of the locked booking, evaluated after guard.
function transitionBooking(id, fromStatuses, toStatus, { actorId = null, note = null, fields = {}, guard } = {}) {
  return transaction(async (client) => {
    const current = await one('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id], client);
    if (!current) throw new BookingError(404, 'Booking not found');
    if (!fromStatuses.includes(current.status)) {
      throw new BookingError(409, `This booking is ${STATUS_LABELS[current.status] || current.status} and can't be changed this way.`, 'WRONG_STATUS');
    }
    if (guard) await guard(client, current);
    const values = typeof fields === 'function' ? fields(current) : fields;
    const keys = Object.keys(values);
    const booking = await one(`
      UPDATE bookings SET status = $2, updated_at = now()${keys.map((key, i) => `, ${key} = $${i + 3}`).join('')}
      WHERE id = $1 RETURNING *
    `, [id, toStatus, ...keys.map((key) => values[key])], client);
    await recordStatus(client, id, current.status, toStatus, actorId, note);
    return { before: current, booking };
  });
}

// Returns the ref of another trip this cab already has close to this booking's time, if any.
async function cabConflict(client, vehicleId, booking) {
  const clash = await one(`
    SELECT booking_ref FROM bookings
    WHERE vehicle_id = $1 AND id <> $2 AND status IN ('CONFIRMED','ONGOING')
      AND abs(extract(epoch FROM (trip_datetime - $3::timestamptz))) < $4
    LIMIT 1
  `, [vehicleId, booking.id, booking.trip_datetime, TRIP_GAP_SECONDS], client);
  return clash?.booking_ref || null;
}

function distanceKmBetween(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Drivers with an unknown location (or bookings without a pin) are not filtered out.
function inServiceArea(booking, cab) {
  if (booking.pickup_latitude == null || booking.pickup_longitude == null || cab.latitude == null || cab.longitude == null) return true;
  return distanceKmBetween(booking.pickup_latitude, booking.pickup_longitude, cab.latitude, cab.longitude) <= DISPATCH_RADIUS_KM;
}

// Online, active cabs of the right type that are free at that time, near the pickup, and haven't declined it.
async function eligibleCabs(booking, client) {
  const cabs = await query(`
    SELECT v.id AS vehicle_id, d.id AS driver_id, d.user_id, d.latitude, d.longitude
    FROM vehicles v
    JOIN partners p ON p.id = v.partner_id AND p.active
    JOIN drivers d ON d.id = v.driver_id AND d.is_active AND d.is_online
    WHERE v.active AND v.category = $1
      AND NOT EXISTS (SELECT 1 FROM driver_status_events e WHERE e.booking_id = $2 AND e.driver_id = d.id AND e.status = 'BOOKING_REJECTED')
      AND NOT EXISTS (
        SELECT 1 FROM bookings o WHERE o.vehicle_id = v.id AND o.id <> $2 AND o.status IN ('CONFIRMED','ONGOING')
          AND abs(extract(epoch FROM (o.trip_datetime - $3::timestamptz))) < $4
      )
  `, [booking.car_category, booking.id, booking.trip_datetime, TRIP_GAP_SECONDS], client);
  return cabs.filter((cab) => inServiceArea(booking, cab));
}

async function notifyDriverAssigned(booking) {
  const details = await one(`
    SELECT d.driver_name, d.phone, v.model, v.plate_no FROM drivers d JOIN vehicles v ON v.id = $2 WHERE d.id = $1
  `, [booking.driver_id, booking.vehicle_id]);
  notifyUsers([booking.customer_id], {
    title: `Driver assigned · ${booking.booking_ref}`,
    body: `${details.driver_name} (+91 ${details.phone}) · ${details.model} ${details.plate_no}. Pickup ${tripTime(booking.trip_datetime)}.`,
    data: { bookingId: booking.id }
  });
}

async function driverUserId(driverId) {
  return (await one('SELECT user_id FROM drivers WHERE id = $1', [driverId]))?.user_id;
}

app.post('/bookings', requireLogin, handle(async (req, res) => {
  const {
    serviceType,
    pickup,
    drop,
    pickupLatitude,
    pickupLongitude,
    dropLatitude,
    dropLongitude,
    routeDistanceKm,
    tripDatetime,
    carCategory,
    roundTrip = false,
    customerNote
  } = req.body;

  if (!serviceType || !pickup || !drop || !tripDatetime || !carCategory) {
    return res.status(400).json({ error: 'serviceType, pickup, drop, tripDatetime, carCategory are required' });
  }
  if (!validServiceTypes.has(serviceType)) {
    return res.status(400).json({ error: 'serviceType must be OUTSTATION, AIRPORT, WEDDING, or LOCAL' });
  }
  if (!validCategories.has(carCategory)) {
    return res.status(400).json({ error: 'carCategory must be sedan, suv, or traveller' });
  }
  if (typeof roundTrip !== 'boolean') {
    return res.status(400).json({ error: 'roundTrip must be a boolean' });
  }
  if (Number.isNaN(Date.parse(tripDatetime))) {
    return res.status(400).json({ error: 'tripDatetime must be a valid date and time' });
  }
  const coordinates = [pickupLatitude, pickupLongitude, dropLatitude, dropLongitude];
  if (coordinates.some((value) => value != null && !Number.isFinite(Number(value)))) {
    return res.status(400).json({ error: 'Location coordinates must be numeric' });
  }
  if (routeDistanceKm != null && (!Number.isFinite(Number(routeDistanceKm)) || Number(routeDistanceKm) < 0)) {
    return res.status(400).json({ error: 'routeDistanceKm must be a non-negative number' });
  }

  const customer = req.account;
  const fareBreakdown = calculateFareBreakdown(
    carCategory,
    routeDistanceKm == null ? null : Number(routeDistanceKm),
    serviceType,
    roundTrip
  );

  const trackingToken = randomBytes(32).toString('base64url');
  const trackingTokenHash = createHash('sha256').update(trackingToken).digest('hex');
  const booking = await transaction(async (client) => {
    const created = await one(`
      INSERT INTO bookings (
        booking_ref, customer_id, service_type, pickup_text, drop_text,
        pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, route_distance_km, tracking_token_hash,
        trip_datetime, car_category, estimated_fare, fare_breakdown, customer_note, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'PENDING_APPROVAL')
      RETURNING *
    `, [
      `SY-${nano()}`, customer.id, serviceType, pickup, drop,
      pickupLatitude ?? null, pickupLongitude ?? null, dropLatitude ?? null, dropLongitude ?? null,
      routeDistanceKm ?? null, trackingTokenHash, tripDatetime, carCategory,
      fareBreakdown?.total ?? null, fareBreakdown ? JSON.stringify(fareBreakdown) : null, customerNote || null
    ], client);
    await recordStatus(client, created.id, null, 'PENDING_APPROVAL', customer.id, 'Booking requested');
    return created;
  });

  notifyStaff('bookings', {
    title: `New booking · ${booking.booking_ref}`,
    body: `${customer.fullName || 'Customer'} (+91 ${customer.phone}) · ${tripLine(booking)} · ${CATEGORY_NAMES[carCategory]}`
      + `${booking.estimated_fare ? ` · ₹${booking.estimated_fare}` : ''}`,
    data: { bookingId: booking.id }
  });
  res.status(201).json({ booking: publicBooking(booking), trackingToken });
}));

// Customers see only their own bookings; staff with booking access see any.
const canSeeBooking = (account, booking) => booking.customer_id === account.id
  || account.roles.includes('owner')
  || (account.roles.includes('admin') && account.permissions.includes('bookings'));

app.get('/bookings/:id', requireLogin, handle(async (req, res) => {
  const id = Number(req.params.id);
  const booking = await getBooking(id);
  if (!booking || !canSeeBooking(req.account, booking)) return res.status(404).json({ error: 'Booking not found' });

  const events = await query('SELECT * FROM booking_status_events WHERE booking_id = $1 ORDER BY id ASC', [id]);
  res.json({ booking: publicBooking(booking), events });
}));

app.get('/bookings', requireLogin, handle(async (req, res) => {
  const bookings = await query('SELECT * FROM bookings WHERE customer_id = $1 ORDER BY created_at DESC', [req.account.id]);
  res.json({ bookings: bookings.map(publicBooking) });
}));

app.post('/bookings/:id/cancel', requireLogin, handle(async (req, res) => {
  const id = Number(req.params.id);
  const owned = await getBooking(id);
  if (!owned || owned.customer_id !== req.account.id) return res.status(404).json({ error: 'Booking not found' });
  const { booking } = await transitionBooking(id, CANCELLABLE, 'CANCELLED', {
    actorId: req.account.id,
    note: String(req.body.note || 'Cancelled by customer').slice(0, 300)
  });
  if (booking.driver_id) {
    notifyUsers([await driverUserId(booking.driver_id)], {
      title: `Booking cancelled · ${booking.booking_ref}`, body: `The customer cancelled: ${tripLine(booking)}`, channel: CHANNELS.offers
    });
  }
  notifyStaff('bookings', { title: `Customer cancelled · ${booking.booking_ref}`, body: tripLine(booking), data: { bookingId: id } });
  res.json({ booking: publicBooking(booking) });
}));

// ---- Admin: review bookings ----------------------------------------------
app.get('/admin/bookings', requireStaff('bookings'), handle(async (req, res) => {
  const status = req.query.status;
  if (status && !STATUS_LABELS[String(status)]) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }
  const rows = await query(`
    SELECT b.*, u.full_name AS customer_name, u.phone AS customer_phone,
      d.driver_name, d.phone AS driver_phone, v.cab_ref, v.plate_no, v.model AS vehicle_model,
      (SELECT count(*) FROM driver_status_events e WHERE e.booking_id = b.id AND e.status = 'BOOKING_REJECTED')::int AS declined_count
    FROM bookings b
    JOIN users u ON u.id = b.customer_id
    LEFT JOIN drivers d ON d.id = b.driver_id
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    WHERE ($1::text IS NULL OR b.status = $1)
    ORDER BY b.created_at DESC
    LIMIT 200
  `, [status ? String(status) : null]);
  res.json({ bookings: rows.map(publicBooking) });
}));

// How many bookings are in each status, for the dashboard overview.
app.get('/admin/overview', requireStaff('bookings'), handle(async (_req, res) => {
  const counts = Object.fromEntries((await query('SELECT status, count(*)::int AS n FROM bookings GROUP BY status')).map((row) => [row.status, row.n]));
  const online = await one(`
    SELECT count(*)::int AS n FROM drivers d JOIN partners p ON p.id = d.partner_id AND p.active WHERE d.is_online AND d.is_active
  `);
  res.json({ counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0), onlineDrivers: online.n });
}));

app.post('/admin/bookings/:id/approve', requireStaff('bookings'), handle(async (req, res) => {
  const { booking } = await transitionBooking(Number(req.params.id), ['PENDING_APPROVAL', 'ON_HOLD', 'DRIVER_NOT_FOUND'], 'APPROVED', {
    actorId: req.account?.id ?? null,
    note: 'Approved by SadakYatra',
    fields: { approved_by_user_id: req.account?.id ?? null, approved_at: new Date(), status_reason: null }
  });
  const cabs = await eligibleCabs(booking);
  notifyUsers(cabs.map((cab) => cab.user_id), {
    title: 'New booking available',
    body: `${tripLine(booking)} · ${CATEGORY_NAMES[booking.car_category]}. First to accept gets it.`,
    channel: CHANNELS.offers,
    data: { bookingId: booking.id }
  });
  notifyUsers([booking.customer_id], {
    title: `Booking approved · ${booking.booking_ref}`, body: 'We are finding a driver for you.', data: { bookingId: booking.id }
  });
  res.json({ booking: publicBooking(booking), driversNotified: cabs.length });
}));

app.post('/admin/bookings/:id/hold', requireStaff('bookings'), handle(async (req, res) => {
  const reason = String(req.body.reason || '').trim().slice(0, 300) || null;
  const { booking } = await transitionBooking(Number(req.params.id), ['PENDING_APPROVAL', 'APPROVED', 'DRIVER_NOT_FOUND'], 'ON_HOLD', {
    actorId: req.account?.id ?? null, note: reason || 'Put on hold', fields: { status_reason: reason }
  });
  res.json({ booking: publicBooking(booking) });
}));

app.post('/admin/bookings/:id/reject', requireStaff('bookings'), handle(async (req, res) => {
  const reason = String(req.body.reason || '').trim().slice(0, 300) || null;
  const { booking } = await transitionBooking(Number(req.params.id), OPEN_FOR_ADMIN, 'REJECTED', {
    actorId: req.account?.id ?? null, note: reason || 'Rejected', fields: { status_reason: reason }
  });
  notifyUsers([booking.customer_id], {
    title: `Booking not accepted · ${booking.booking_ref}`,
    body: reason || 'Sorry, we cannot serve this trip. Please call us for help.',
    data: { bookingId: booking.id }
  });
  res.json({ booking: publicBooking(booking) });
}));

app.post('/admin/bookings/:id/cancel', requireStaff('bookings'), handle(async (req, res) => {
  const reason = String(req.body.reason || '').trim().slice(0, 300) || 'Cancelled by SadakYatra';
  const { booking } = await transitionBooking(Number(req.params.id), CANCELLABLE, 'CANCELLED', {
    actorId: req.account?.id ?? null, note: reason, fields: { status_reason: reason }
  });
  notifyUsers([booking.customer_id], { title: `Booking cancelled · ${booking.booking_ref}`, body: reason, data: { bookingId: booking.id } });
  if (booking.driver_id) {
    notifyUsers([await driverUserId(booking.driver_id)], {
      title: `Booking cancelled · ${booking.booking_ref}`, body: tripLine(booking), channel: CHANNELS.offers
    });
  }
  res.json({ booking: publicBooking(booking) });
}));

// Cabs an admin can assign, for staff who manage bookings but not partners.
app.get('/admin/cabs', requireStaff('bookings'), handle(async (_req, res) => {
  const cabs = await query(`
    SELECT v.id AS vehicle_id, v.cab_ref, v.plate_no, v.category, v.model, d.driver_name, d.phone AS driver_phone, d.is_online
    FROM vehicles v
    JOIN partners p ON p.id = v.partner_id AND p.active
    JOIN drivers d ON d.id = v.driver_id AND d.is_active
    WHERE v.active
    ORDER BY d.is_online DESC, v.cab_ref
  `);
  res.json({ cabs });
}));

// Admin puts the booking straight on a chosen cab (any active cab, free at that time).
app.post('/admin/bookings/:id/assign', requireStaff('bookings'), handle(async (req, res) => {
  const vehicleId = Number(req.body.vehicleId);
  if (!Number.isInteger(vehicleId) || vehicleId < 1) return res.status(400).json({ error: 'Choose a cab first' });
  let cab;
  const { booking } = await transitionBooking(Number(req.params.id), OPEN_FOR_ADMIN, 'CONFIRMED', {
    actorId: req.account?.id ?? null,
    note: 'Driver assigned by SadakYatra',
    guard: async (client, current) => {
      cab = await one(`
        SELECT v.id, v.driver_id FROM vehicles v
        JOIN partners p ON p.id = v.partner_id AND p.active
        JOIN drivers d ON d.id = v.driver_id AND d.is_active
        WHERE v.id = $1 AND v.active
        FOR UPDATE OF v
      `, [vehicleId], client);
      if (!cab) throw new BookingError(409, 'This cab is paused or has no active driver');
      const clash = await cabConflict(client, vehicleId, current);
      if (clash) throw new BookingError(409, `This cab already has ${clash} around that time`);
    },
    fields: () => ({ vehicle_id: vehicleId, driver_id: cab.driver_id, driver_status: 'BOOKING_ACCEPTED', status_reason: null })
  });
  await query("INSERT INTO driver_status_events (booking_id, driver_id, status) VALUES ($1, $2, 'ASSIGNED')", [booking.id, booking.driver_id]);
  notifyUsers([await driverUserId(booking.driver_id)], {
    title: `Booking assigned to you · ${booking.booking_ref}`, body: tripLine(booking), channel: CHANNELS.offers, data: { bookingId: booking.id }
  });
  notifyDriverAssigned(booking);
  res.json({ booking: publicBooking(booking) });
}));

app.get('/admin/partners/applications', requireStaff('partners'), handle(async (req, res) => {
  const status = String(req.query.status || 'PENDING');
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid application status' });
  }
  const applications = await query('SELECT * FROM partner_applications WHERE status = $1 ORDER BY created_at ASC', [status]);
  res.json({ applications });
}));

app.patch('/admin/partners/applications/:id', requireStaff('partners'), handle(async (req, res) => {
  const id = Number(req.params.id);
  const { status, reviewNote } = req.body;
  if (status !== 'REJECTED') {
    return res.status(400).json({ error: 'Use the approval endpoint to approve applications' });
  }
  const application = await one(`
    UPDATE partner_applications SET status = 'REJECTED', review_note = $1, reviewed_at = now()
    WHERE id = $2 AND status = 'PENDING'
    RETURNING *
  `, [String(reviewNote || '').slice(0, 500) || null, id]);
  if (!application) return res.status(404).json({ error: 'Pending application not found' });
  res.json({ application });
}));

app.post('/admin/partners/applications/:id/approve', requireStaff('partners'), handle(async (req, res) => {
  const id = Number(req.params.id);
  const { phoneVerified } = req.body;
  // Documents are optional for now; blank fields are treated as not provided.
  const documentKey = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const rcDocumentKey = documentKey(req.body.rcDocumentKey);
  const dlDocumentKey = documentKey(req.body.dlDocumentKey);
  const insuranceDocumentKey = documentKey(req.body.insuranceDocumentKey);
  const application = await one('SELECT * FROM partner_applications WHERE id = $1', [id]);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.status !== 'PENDING') {
    return res.status(409).json({ error: 'Only pending applications can be approved' });
  }
  // Applications from a logged-in account were OTP-verified; older ones need the admin's check.
  if (!application.phone_verified && phoneVerified !== true) {
    return res.status(400).json({ error: 'Verify the partner phone before approval' });
  }

  // Any document key that is given must point at an uploaded file for this application.
  const documentKeys = [rcDocumentKey, dlDocumentKey, insuranceDocumentKey].filter(Boolean);
  const documentPrefix = `partners/applications/${application.application_ref}/`;
  if (documentKeys.some((key) => !key.startsWith(documentPrefix) || key.includes('..') || key.includes('\\'))) {
    return res.status(400).json({ error: `Document paths must start with ${documentPrefix}` });
  }
  if (documentKeys.length) {
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(503).json({ error: 'Checking documents needs Supabase storage. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend.' });
    const bucket = getPartnerDocumentsBucket();
    for (const objectKey of documentKeys) {
      const { error } = await supabase.storage.from(bucket).createSignedUrl(objectKey, 30);
      if (error) return res.status(400).json({ error: `Document not found in private storage: ${objectKey}` });
    }
  }

  const partnerRef = `SY-PARTNER-${nano()}`;
  let approved;
  try {
    approved = await transaction(async (client) => {
      const { approved: created } = await one(
        'SELECT approve_partner_application($1, $2, NULL, $3, $4, $5) AS approved',
        [id, partnerRef, rcDocumentKey, dlDocumentKey, insuranceDocumentKey], client
      );
      // The driver logs in with their own mobile number; the applicant gets their partner role.
      const driverUser = await findOrCreateUser(application.driver_phone, application.driver_name, client);
      await grantRole(driverUser.id, 'driver', [], client);
      await query('UPDATE drivers SET user_id = $1 WHERE id = $2', [driverUser.id, created.driverId], client);
      const ownerId = application.applicant_user_id ?? driverUser.id;
      await query('UPDATE partners SET user_id = $1, partner_type = $2 WHERE id = $3',
        [ownerId, application.partner_type, created.partnerId], client);
      if (application.partner_type === 'vehicle_owner') await grantRole(ownerId, 'vehicle_owner', [], client);
      return created;
    });
  } catch (error) {
    console.error('Partner approval failed', error.message);
    return res.status(409).json({ error: 'Could not approve this application. The driver phone or vehicle number may already be registered.' });
  }
  res.status(201).json({
    ...approved,
    partnerRef,
    message: `Approved. The driver can now log in with +91 ${application.driver_phone}.`
  });
}));

app.get('/admin/partners', requireStaff('partners'), handle(async (_req, res) => {
  const partners = await query(`
    SELECT p.id AS partner_id, p.partner_ref, p.full_name, p.phone, p.city, p.operating_area,
      p.active AS partner_active, v.id AS vehicle_id, v.cab_ref, v.plate_no, v.category, v.model, v.active AS vehicle_active,
      v.gps_device_id, d.id AS driver_id, d.driver_name, d.phone AS driver_phone, d.is_online,
      d.latitude, d.longitude, d.location_updated_at,
      current.booking_ref AS current_booking_ref, current.driver_status AS current_driver_status,
      current.pickup_text AS current_pickup, current.drop_text AS current_drop
    FROM partners p
    LEFT JOIN vehicles v ON v.partner_id = p.id
    LEFT JOIN drivers d ON d.partner_id = p.id
    LEFT JOIN bookings current ON current.id = (
      SELECT b.id FROM bookings b
      WHERE b.vehicle_id = v.id
        AND b.status IN ('CONFIRMED','ONGOING')
      ORDER BY b.updated_at DESC LIMIT 1
    )
    ORDER BY p.created_at DESC
  `);
  res.json({ partners });
}));

app.patch('/admin/partners/:id', requireStaff('partners'), handle(async (req, res) => {
  const partnerId = Number(req.params.id);
  const { active } = req.body;
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });
  const found = await transaction(async (client) => {
    const partner = await one('UPDATE partners SET active = $1 WHERE id = $2 RETURNING id', [active, partnerId], client);
    if (partner && !active) {
      await query(`
        UPDATE drivers SET is_online = false, latitude = NULL, longitude = NULL, location_updated_at = NULL
        WHERE partner_id = $1
      `, [partnerId], client);
    }
    return Boolean(partner);
  });
  if (!found) return res.status(404).json({ error: 'Partner not found' });
  res.json({ partner: { id: partnerId, active } });
}));

app.patch('/admin/vehicles/:id', requireStaff('partners'), handle(async (req, res) => {
  const vehicleId = Number(req.params.id);
  const { active, gpsDeviceId } = req.body;
  if (active !== undefined && typeof active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });
  if (gpsDeviceId !== undefined && gpsDeviceId !== null && (typeof gpsDeviceId !== 'string' || !/^[A-Za-z0-9_.:-]{3,64}$/.test(gpsDeviceId.trim()))) {
    return res.status(400).json({ error: 'GPS device ID must be 3-64 letters, digits, or . _ : -' });
  }
  if (active === undefined && gpsDeviceId === undefined) return res.status(400).json({ error: 'Nothing to update' });

  const vehicle = await one('SELECT id, active, gps_device_id FROM vehicles WHERE id = $1', [vehicleId]);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  const nextActive = active === undefined ? vehicle.active : active;
  const nextDevice = gpsDeviceId === undefined ? vehicle.gps_device_id : (gpsDeviceId?.trim() || null);
  try {
    await query('UPDATE vehicles SET active = $1, gps_device_id = $2 WHERE id = $3', [nextActive, nextDevice, vehicleId]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'This GPS device is already linked to another cab' });
    throw error;
  }
  res.json({ vehicle: { id: vehicleId, active: nextActive, gpsDeviceId: nextDevice } });
}));

// Option B: a GPS tracker provider (or a small relay polling the provider's API)
// pushes positions here. The device ID must first be linked to a cab by an admin.
app.post('/integrations/gps/location', handle(async (req, res) => {
  if (!gpsWebhookSecret) return res.status(503).json({ error: 'GPS tracker integration is not configured' });
  const supplied = Buffer.from(req.get('x-gps-webhook-secret') || '');
  const expected = Buffer.from(gpsWebhookSecret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Invalid GPS webhook secret' });
  }
  const { deviceId, latitude, longitude } = req.body;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (typeof deviceId !== 'string' || !deviceId.trim()) return res.status(400).json({ error: 'deviceId is required' });
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }
  const vehicle = await one(`
    SELECT v.driver_id FROM vehicles v
    JOIN partners p ON p.id = v.partner_id AND p.active
    WHERE v.gps_device_id = $1 AND v.active
  `, [deviceId.trim()]);
  if (!vehicle?.driver_id) return res.status(404).json({ error: 'No active cab is linked to this GPS device' });
  await query('UPDATE drivers SET latitude = $1, longitude = $2, location_updated_at = now() WHERE id = $3',
    [lat, lng, vehicle.driver_id]);
  res.json({ ok: true });
}));

// ---- Driver not found ----------------------------------------------------
// Approved bookings nobody accepted in time go back to the admin.
let sweepRunning = false;
async function runDriverSearchSweep() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const expired = await query(`
      SELECT id FROM bookings
      WHERE status = 'APPROVED' AND approved_at <= now() - make_interval(secs => $1)
    `, [DRIVER_SEARCH_MINUTES * 60]);
    for (const { id } of expired) {
      try {
        const { booking } = await transitionBooking(id, ['APPROVED'], 'DRIVER_NOT_FOUND', {
          note: `No driver accepted within ${DRIVER_SEARCH_MINUTES} minutes`
        });
        notifyStaff('bookings', {
          title: `No driver found · ${booking.booking_ref}`,
          body: `${tripLine(booking)}. Assign a cab or approve again.`,
          data: { bookingId: id }
        });
      } catch (error) {
        if (!(error instanceof BookingError)) throw error; // accepted meanwhile
      }
    }
  } catch (error) {
    console.error('Driver search sweep failed', error);
  } finally {
    sweepRunning = false;
  }
}
setInterval(runDriverSearchSweep, 30_000).unref();

// ---- Push tokens (every logged-in user) ----------------------------------
app.post('/me/push-token', requireLogin, handle(async (req, res) => {
  const { token, previousToken } = req.body;
  const valid = (value) => typeof value === 'string' && /^Expo(nent)?PushToken\[[^\]]{10,200}\]$/.test(value);
  if (token !== null && !valid(token)) return res.status(400).json({ error: 'A valid Expo push token is required' });
  if (token === null) {
    // Logging out: stop this phone receiving this account's notifications.
    if (valid(previousToken)) await query('DELETE FROM user_push_tokens WHERE token = $1 AND user_id = $2', [previousToken, req.account.id]);
    return res.json({ registered: false });
  }
  // A phone belongs to one account at a time.
  await query(`
    INSERT INTO user_push_tokens (token, user_id) VALUES ($1, $2)
    ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now()
  `, [token, req.account.id]);
  res.json({ registered: true });
}));

// ---- Driver --------------------------------------------------------------
app.patch('/driver/presence', requireDriver, handle(async (req, res) => {
  const { online } = req.body;
  if (typeof online !== 'boolean') {
    return res.status(400).json({ error: 'online must be a boolean' });
  }
  await query(`
    UPDATE drivers
    SET is_online = $1,
        latitude = CASE WHEN $1 THEN latitude END,
        longitude = CASE WHEN $1 THEN longitude END,
        location_updated_at = CASE WHEN $1 THEN location_updated_at END
    WHERE id = $2
  `, [online, req.driver.id]);
  res.json({ online });
}));

app.post('/driver/location', requireDriver, handle(async (req, res) => {
  const { latitude, longitude } = req.body;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }
  if (!req.driver.is_online) return res.status(409).json({ error: 'Driver must be online to share a location' });
  await query('UPDATE drivers SET latitude = $1, longitude = $2, location_updated_at = now() WHERE id = $3',
    [latitude, longitude, req.driver.id]);
  res.json({ latitude, longitude, updatedAt: new Date().toISOString() });
}));

const driverCab = (driverId) => one('SELECT * FROM vehicles WHERE driver_id = $1', [driverId]);

app.get('/driver/me', requireDriver, handle(async (req, res) => {
  const cab = await one('SELECT cab_ref, plate_no, category, model FROM vehicles WHERE driver_id = $1', [req.driver.id]);
  res.json({ driver: { name: req.driver.driver_name, phone: req.driver.phone, online: Boolean(req.driver.is_online), cab } });
}));

// Drivers see the trip, not who booked it, until they accept.
const offerView = ({ customer_id: _c, tracking_token_hash: _t, customer_note: _n, admin_note: _a, status_reason: _r, ...offer }) => offer;

// The driver's own trips, plus approved bookings they can still accept.
app.get('/driver/bookings', requireDriver, handle(async (req, res) => {
  const bookings = await query(`
    SELECT b.*, v.plate_no, v.model AS vehicle_model, u.full_name AS customer_name, u.phone AS customer_phone
    FROM bookings b
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    JOIN users u ON u.id = b.customer_id
    WHERE b.driver_id = $1 AND b.status IN ('CONFIRMED','ONGOING')
    ORDER BY b.trip_datetime ASC
  `, [req.driver.id]);
  const cab = await driverCab(req.driver.id);
  let offers = [];
  if (req.driver.is_online && cab?.active) {
    offers = (await query(`
      SELECT b.* FROM bookings b
      WHERE b.status = 'APPROVED' AND b.driver_id IS NULL AND b.car_category = $1
        AND NOT EXISTS (SELECT 1 FROM driver_status_events e WHERE e.booking_id = b.id AND e.driver_id = $2 AND e.status = 'BOOKING_REJECTED')
        AND NOT EXISTS (
          SELECT 1 FROM bookings o WHERE o.vehicle_id = $3 AND o.id <> b.id AND o.status IN ('CONFIRMED','ONGOING')
            AND abs(extract(epoch FROM (o.trip_datetime - b.trip_datetime))) < $4
        )
      ORDER BY b.trip_datetime ASC
    `, [cab.category, req.driver.id, cab.id, TRIP_GAP_SECONDS]))
      .filter((booking) => inServiceArea(booking, req.driver))
      .map(offerView);
  }
  res.json({ bookings: bookings.map(publicBooking), offers });
}));

app.patch('/driver/bookings/:id/response', requireDriver, handle(async (req, res) => {
  const bookingId = Number(req.params.id);
  const { decision } = req.body;
  if (!['ACCEPT', 'REJECT'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be ACCEPT or REJECT' });
  }

  if (decision === 'REJECT') {
    const open = await one("SELECT id FROM bookings WHERE id = $1 AND status = 'APPROVED'", [bookingId]);
    if (!open) return res.status(409).json({ error: 'This booking is no longer available' });
    await query(`
      INSERT INTO driver_status_events (booking_id, driver_id, status)
      SELECT $1, $2, 'BOOKING_REJECTED'
      WHERE NOT EXISTS (SELECT 1 FROM driver_status_events WHERE booking_id = $1 AND driver_id = $2 AND status = 'BOOKING_REJECTED')
    `, [bookingId, req.driver.id]);
    return res.json({ accepted: false });
  }

  // First driver to get here wins: the booking row lock lets only one acceptance through.
  const cab = await driverCab(req.driver.id);
  if (!cab?.active) return res.status(409).json({ error: 'Your cab is paused. Please call SadakYatra.' });
  if (!req.driver.is_online) return res.status(409).json({ error: 'Go online to accept bookings' });
  try {
    const { booking } = await transitionBooking(bookingId, ['APPROVED'], 'CONFIRMED', {
      actorId: req.driver.user_id,
      note: `Accepted by ${req.driver.driver_name}`,
      guard: async (client, current) => {
        if (current.car_category !== cab.category) throw new BookingError(409, 'This booking needs a different vehicle type');
        await query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [cab.id], client);
        const clash = await cabConflict(client, cab.id, current);
        if (clash) throw new BookingError(409, `You already have ${clash} around that time`);
      },
      fields: { vehicle_id: cab.id, driver_id: req.driver.id, driver_status: 'BOOKING_ACCEPTED' }
    });
    await query("INSERT INTO driver_status_events (booking_id, driver_id, status) VALUES ($1, $2, 'BOOKING_ACCEPTED')", [bookingId, req.driver.id]);
    notifyDriverAssigned(booking);
    notifyStaff('bookings', {
      title: `Driver accepted · ${booking.booking_ref}`,
      body: `${req.driver.driver_name} · ${cab.cab_ref} ${cab.plate_no} · ${tripLine(booking)}`,
      data: { bookingId }
    });
    res.json({ accepted: true, booking: publicBooking(booking) });
  } catch (error) {
    if (error.code === 'WRONG_STATUS') return res.status(409).json({ error: 'Sorry, this booking was already taken or is no longer available' });
    throw error;
  }
}));

const CUSTOMER_TRIP_UPDATES = {
  GOING_TO_PICKUP: ['Driver on the way', 'Your driver has started towards the pickup point.'],
  ARRIVED: ['Driver has arrived', 'Your driver is waiting at the pickup point.'],
  TRIP_STARTED: ['Trip started', 'Have a safe journey with SadakYatra.'],
  TRIP_COMPLETED: ['Trip completed', 'Thank you for riding with SadakYatra!']
};

app.patch('/driver/bookings/:id/status', requireDriver, handle(async (req, res) => {
  const bookingId = Number(req.params.id);
  const { status } = req.body;
  const nextStatus = {
    BOOKING_ACCEPTED: 'GOING_TO_PICKUP',
    GOING_TO_PICKUP: 'ARRIVED',
    ARRIVED: 'TRIP_STARTED',
    TRIP_STARTED: 'TRIP_COMPLETED'
  };
  const booking = await one("SELECT * FROM bookings WHERE id = $1 AND driver_id = $2 AND status IN ('CONFIRMED','ONGOING')", [bookingId, req.driver.id]);
  if (!booking) return res.status(404).json({ error: 'Assigned booking not found' });
  if (nextStatus[booking.driver_status] !== status) {
    return res.status(409).json({ error: 'Trip status must advance to the next valid stage' });
  }

  const bookingStatus = status === 'TRIP_STARTED' ? 'ONGOING' : status === 'TRIP_COMPLETED' ? 'COMPLETED' : booking.status;
  const advanced = await transaction(async (client) => {
    const updated = await one(`
      UPDATE bookings SET driver_status = $1, status = $2, updated_at = now()
      WHERE id = $3 AND driver_status = $4 AND status IN ('CONFIRMED','ONGOING')
      RETURNING id
    `, [status, bookingStatus, bookingId, booking.driver_status], client);
    if (!updated) return false;
    await query('INSERT INTO driver_status_events (booking_id, driver_id, status) VALUES ($1, $2, $3)',
      [bookingId, req.driver.id, status], client);
    if (bookingStatus !== booking.status) {
      await recordStatus(client, bookingId, booking.status, bookingStatus, req.driver.user_id, status);
    }
    return true;
  });
  if (!advanced) return res.status(409).json({ error: 'Trip status must advance to the next valid stage' });
  const [title, body] = CUSTOMER_TRIP_UPDATES[status];
  notifyUsers([booking.customer_id], { title: `${title} · ${booking.booking_ref}`, body, data: { bookingId } });
  res.json({ booking: publicBooking(await getBooking(bookingId)) });
}));

// The logged-in customer (or staff) can track; a tracking token also works, e.g. for a shared link.
app.get('/bookings/:id/tracking', handle(async (req, res) => {
  const booking = await one('SELECT customer_id, tracking_token_hash FROM bookings WHERE id = $1', [Number(req.params.id)]);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const token = req.get('x-booking-tracking-token') || '';
  const allowedBySession = req.account && canSeeBooking(req.account, booking);
  if (!allowedBySession) {
    if (!token || !booking.tracking_token_hash) return res.status(401).json({ error: 'Please log in to track this booking' });
    const suppliedHash = Buffer.from(createHash('sha256').update(token).digest('hex'));
    const expectedHash = Buffer.from(booking.tracking_token_hash);
    if (suppliedHash.length !== expectedHash.length || !timingSafeEqual(suppliedHash, expectedHash)) {
      return res.status(401).json({ error: 'Invalid booking tracking token' });
    }
  }
  const tracking = await one(`
    SELECT b.id, b.booking_ref, b.status, b.driver_status, b.car_category,
      b.pickup_latitude, b.pickup_longitude, b.drop_latitude, b.drop_longitude,
      d.driver_name, v.plate_no, v.model AS vehicle_model, v.cab_ref,
      CASE WHEN b.driver_status IN ('BOOKING_ACCEPTED','GOING_TO_PICKUP','ARRIVED','TRIP_STARTED') THEN d.phone END AS driver_phone,
      CASE WHEN d.is_online OR v.gps_device_id IS NOT NULL THEN d.latitude END AS latitude,
      CASE WHEN d.is_online OR v.gps_device_id IS NOT NULL THEN d.longitude END AS longitude,
      CASE WHEN d.is_online OR v.gps_device_id IS NOT NULL THEN d.location_updated_at END AS location_updated_at
    FROM bookings b
    LEFT JOIN drivers d ON d.id = b.driver_id
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    WHERE b.id = $1
  `, [Number(req.params.id)]);
  if (!tracking) return res.status(404).json({ error: 'Booking not found' });
  // Hide the cab's position until the driver has accepted, and after the trip ends.
  const live = ['BOOKING_ACCEPTED', 'GOING_TO_PICKUP', 'ARRIVED', 'TRIP_STARTED'].includes(tracking.driver_status);
  if (!live) Object.assign(tracking, { latitude: null, longitude: null, location_updated_at: null });
  res.json({ tracking });
}));

app.use((error, _req, res, _next) => {
  if (error instanceof BookingError) return res.status(error.status).json({ error: error.message });
  console.error('Request failed', error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(port, () => {
  console.log(`SadakYatra backend running on http://localhost:${port}`);
});
