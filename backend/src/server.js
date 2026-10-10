import express from 'express';
import cors from 'cors';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import { one, query, transaction } from './db.js';
import { getPartnerDocumentsBucket, getSupabaseAdmin } from './supabase.js';

const app = express();
// Express 4 does not catch rejected promises from async handlers.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const port = process.env.PORT || 4000;
const nano = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8);

app.use(cors());
app.use(express.json());

const validCategories = new Set(['sedan', 'suv', 'traveller']);
const validStatuses = new Set(['PENDING', 'CONFIRMED', 'ONGOING', 'COMPLETED', 'CANCELLED']);
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
const adminApiKey = process.env.ADMIN_API_KEY || '';
const gpsWebhookSecret = process.env.GPS_WEBHOOK_SECRET || '';
const partnerApplicationAttempts = new Map();

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

async function requireAdmin(req, res, next) {
  const bearerToken = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (bearerToken) {
    const supabase = getSupabaseAdmin();
    if (!supabase) return res.status(503).json({ error: 'Supabase admin authentication is not configured' });
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
      if (authError || !authData.user) return res.status(401).json({ error: 'Invalid or expired admin session' });
      const { data: admin, error: adminError } = await supabase
        .from('admin_users')
        .select('user_id, full_name')
        .eq('user_id', authData.user.id)
        .eq('active', true)
        .maybeSingle();
      if (adminError) return res.status(503).json({ error: 'Supabase admin roster is unavailable' });
      if (!admin) return res.status(403).json({ error: 'This Supabase account is not an active SadakYatra admin' });
      req.adminUser = { ...authData.user, adminProfile: admin };
      return next();
    } catch {
      return res.status(503).json({ error: 'Unable to verify the Supabase admin session' });
    }
  }

  if (!adminApiKey) return res.status(401).json({ error: 'Supabase admin sign-in required' });
  const suppliedKey = Buffer.from(req.get('x-admin-api-key') || '');
  const expectedKey = Buffer.from(adminApiKey);
  if (suppliedKey.length !== expectedKey.length || !timingSafeEqual(suppliedKey, expectedKey)) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  next();
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

function isValidIndianPhone(phone) {
  return /^[6-9]\d{9}$/.test(phone);
}

function publicBooking(booking) {
  if (!booking) return booking;
  const { tracking_token_hash: _trackingTokenHash, ...safeBooking } = booking;
  return safeBooking;
}

function limitPartnerApplications(req, res, next) {
  const now = Date.now();
  const cutoff = now - 60_000;
  const recent = (partnerApplicationAttempts.get(req.ip) || []).filter((time) => time > cutoff);
  if (recent.length >= 5) {
    return res.status(429).json({ error: 'Too many applications. Please try again later.' });
  }
  recent.push(now);
  partnerApplicationAttempts.set(req.ip, recent);
  next();
}

const requireDriver = handle(async (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Driver authentication required' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const driver = await one(`
    SELECT d.*, p.active AS partner_active
    FROM drivers d
    JOIN partners p ON p.id = d.partner_id
    WHERE d.access_token_hash = $1 AND d.is_active AND p.active
  `, [tokenHash]);
  if (!driver) return res.status(401).json({ error: 'Invalid driver token' });
  req.driver = driver;
  next();
});

async function findOrCreateCustomer(phone, fullName) {
  const existing = await one('SELECT * FROM users WHERE phone = $1', [phone]);
  if (existing) return existing;
  return one(`
    INSERT INTO users (role, full_name, phone) VALUES ('CUSTOMER', $1, $2)
    ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
    RETURNING *
  `, [fullName || null, phone]);
}

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

app.post('/auth/mock-login', handle(async (req, res) => {
  const { phone, fullName } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const user = await findOrCreateCustomer(String(phone), fullName);

  res.json({
    token: `mock-token-${user.id}`,
    user: { id: user.id, role: user.role, fullName: user.full_name, phone: user.phone }
  });
}));

app.post('/partners/applications', limitPartnerApplications, handle(async (req, res) => {
  const {
    fullName,
    phone: rawPhone,
    vehicleNumber,
    vehicleCategory,
    vehicleModel,
    seats,
    driverName,
    driverPhone: rawDriverPhone,
    city,
    operatingArea
  } = req.body;
  const phone = normalizePhone(rawPhone);
  const driverPhone = normalizePhone(rawDriverPhone);
  const plate = String(vehicleNumber || '').trim().toUpperCase();
  const requiredText = [fullName, vehicleModel, driverName, city, operatingArea];

  if (requiredText.some((value) => typeof value !== 'string' || value.trim().length < 2 || value.length > 120)) {
    return res.status(400).json({ error: 'Name, model, city, and operating area are required' });
  }
  if (!isValidIndianPhone(phone) || !isValidIndianPhone(driverPhone)) {
    return res.status(400).json({ error: 'Valid Indian owner and driver mobile numbers are required' });
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

  const application = await one(`
    INSERT INTO partner_applications (
      application_ref, full_name, phone, vehicle_number, vehicle_category, vehicle_model,
      seats, driver_name, driver_phone, city, operating_area
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id, application_ref, status
  `, [`SY-APP-${nano()}`, fullName.trim(), phone, plate, vehicleCategory, vehicleModel.trim(),
    seats == null ? null : Number(seats), driverName.trim(), driverPhone, city.trim(), operatingArea.trim()]);

  res.status(201).json({
    application: {
      id: application.id,
      applicationRef: application.application_ref,
      status: application.status,
      message: 'Application received. The team will contact you to verify your phone and documents.'
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

app.post('/bookings', handle(async (req, res) => {
  const {
    phone,
    fullName,
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

  if (!phone || !serviceType || !pickup || !drop || !tripDatetime || !carCategory) {
    return res.status(400).json({ error: 'phone, serviceType, pickup, drop, tripDatetime, carCategory are required' });
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

  const user = await findOrCreateCustomer(String(phone), fullName);

  const fareBreakdown = calculateFareBreakdown(
    carCategory,
    routeDistanceKm == null ? null : Number(routeDistanceKm),
    serviceType,
    roundTrip
  );

  const trackingToken = randomBytes(32).toString('base64url');
  const trackingTokenHash = createHash('sha256').update(trackingToken).digest('hex');
  const bookingId = await transaction(async (client) => {
    const { id } = await one(`
      INSERT INTO bookings (
        booking_ref, customer_id, service_type, pickup_text, drop_text,
        pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, route_distance_km, tracking_token_hash,
        trip_datetime, car_category, estimated_fare, fare_breakdown, customer_note, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'PENDING')
      RETURNING id
    `, [
      `SY-${nano()}`,
      user.id,
      serviceType,
      pickup,
      drop,
      pickupLatitude ?? null,
      pickupLongitude ?? null,
      dropLatitude ?? null,
      dropLongitude ?? null,
      routeDistanceKm ?? null,
      trackingTokenHash,
      tripDatetime,
      carCategory,
      fareBreakdown?.total ?? null,
      fareBreakdown ? JSON.stringify(fareBreakdown) : null,
      customerNote || null
    ], client);
    await query(`
      INSERT INTO booking_status_events (booking_id, old_status, new_status, changed_by_user_id, note)
      VALUES ($1, NULL, 'PENDING', $2, 'Booking created')
    `, [id, user.id], client);
    return id;
  });

  await autoDispatch(bookingId);
  res.status(201).json({ booking: publicBooking(await getBooking(bookingId)), trackingToken });
}));

app.get('/bookings/:id', handle(async (req, res) => {
  const id = Number(req.params.id);
  const booking = await getBooking(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const events = await query('SELECT * FROM booking_status_events WHERE booking_id = $1 ORDER BY id ASC', [id]);
  res.json({ booking: publicBooking(booking), events });
}));

app.get('/bookings', handle(async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone query param is required' });

  const bookings = await query(`
    SELECT b.* FROM bookings b
    JOIN users u ON u.id = b.customer_id
    WHERE u.phone = $1
    ORDER BY b.created_at DESC
  `, [String(phone)]);
  res.json({ bookings: bookings.map(publicBooking) });
}));

app.post('/bookings/:id/cancel', handle(async (req, res) => {
  const id = Number(req.params.id);
  const { phone, note } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const booking = await one(`
    SELECT b.*, u.phone AS customer_phone FROM bookings b
    JOIN users u ON u.id = b.customer_id
    WHERE b.id = $1
  `, [id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.customer_phone !== phone) {
    return res.status(403).json({ error: 'This booking does not belong to this phone number' });
  }
  if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Booking can no longer be cancelled' });
  }

  await transaction(async (client) => {
    await query("UPDATE bookings SET status = 'CANCELLED', updated_at = now() WHERE id = $1", [id], client);
    await query(`
      INSERT INTO booking_status_events (booking_id, old_status, new_status, changed_by_user_id, note)
      VALUES ($1, $2, 'CANCELLED', $3, $4)
    `, [id, booking.status, booking.customer_id, note || 'Cancelled by customer'], client);
  });

  res.json({ booking: publicBooking(await getBooking(id)) });
}));

app.get('/admin/bookings', requireAdmin, handle(async (req, res) => {
  const status = req.query.status;
  if (status && !validStatuses.has(String(status))) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }

  const rows = status
    ? await query('SELECT * FROM bookings WHERE status = $1 ORDER BY created_at DESC', [String(status)])
    : await query('SELECT * FROM bookings ORDER BY created_at DESC');

  res.json({ bookings: rows.map(publicBooking) });
}));

app.patch('/admin/bookings/:id/status', requireAdmin, handle(async (req, res) => {
  const id = Number(req.params.id);
  const { status, changedByUserId, note } = req.body;

  if (!status || !validStatuses.has(status)) {
    return res.status(400).json({ error: 'Valid status is required' });
  }

  const booking = await getBooking(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  await transaction(async (client) => {
    await query('UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2', [status, id], client);
    await query(`
      INSERT INTO booking_status_events (booking_id, old_status, new_status, changed_by_user_id, note)
      VALUES ($1, $2, $3, $4, $5)
    `, [id, booking.status, status, changedByUserId || null, note || null], client);
  });

  res.json({ booking: publicBooking(await getBooking(id)) });
}));

app.get('/admin/partners/applications', requireAdmin, handle(async (req, res) => {
  const status = String(req.query.status || 'PENDING');
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid application status' });
  }
  const applications = await query('SELECT * FROM partner_applications WHERE status = $1 ORDER BY created_at ASC', [status]);
  res.json({ applications });
}));

app.patch('/admin/partners/applications/:id', requireAdmin, handle(async (req, res) => {
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

app.post('/admin/partners/applications/:id/approve', requireAdmin, handle(async (req, res) => {
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
  if (phoneVerified !== true) {
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

  const driverToken = randomBytes(32).toString('base64url');
  const driverTokenHash = createHash('sha256').update(driverToken).digest('hex');
  const partnerRef = `SY-PARTNER-${nano()}`;
  let approved;
  try {
    ({ approved } = await one(
      'SELECT approve_partner_application($1, $2, $3, $4, $5, $6) AS approved',
      [id, partnerRef, driverTokenHash, rcDocumentKey, dlDocumentKey, insuranceDocumentKey]
    ));
  } catch (error) {
    console.error('Partner approval failed', error.message);
    return res.status(409).json({ error: 'Could not approve this application. The driver phone or vehicle number may already be registered.' });
  }
  res.status(201).json({ ...approved, partnerRef, driverAccessToken: driverToken });
}));

app.get('/admin/partners', requireAdmin, handle(async (_req, res) => {
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
        AND (b.status IN ('CONFIRMED','ONGOING') OR (b.status = 'PENDING' AND b.driver_status = 'OFFERED'))
      ORDER BY b.updated_at DESC LIMIT 1
    )
    ORDER BY p.created_at DESC
  `);
  res.json({ partners });
}));

app.patch('/admin/partners/:id', requireAdmin, handle(async (req, res) => {
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

app.patch('/admin/vehicles/:id', requireAdmin, handle(async (req, res) => {
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

// ---- Dispatch -------------------------------------------------------------
// A cab is available when its partner, vehicle and driver are active, the
// driver is online, and it holds no open offer or unfinished trip.
const OFFER_TIMEOUT_SECONDS = Number(process.env.OFFER_TIMEOUT_SECONDS || 60);
const cabIsFreeSql = `
  NOT EXISTS (
    SELECT 1 FROM bookings assigned
    WHERE assigned.vehicle_id = v.id
      AND (assigned.status IN ('CONFIRMED','ONGOING')
        OR (assigned.status = 'PENDING' AND assigned.driver_status = 'OFFERED'))
  )
`;
const availableCabsSql = `
  SELECT v.id AS vehicle_id, d.id AS driver_id, d.latitude, d.longitude
  FROM vehicles v
  JOIN partners p ON p.id = v.partner_id AND p.active
  JOIN drivers d ON d.id = v.driver_id AND d.is_active AND d.is_online
  WHERE v.active AND v.category = $1 AND ${cabIsFreeSql}
`;

function distanceKmBetween(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Alert the driver's phone (even when locked) through Expo's push service.
// Best effort: dispatch never waits on or fails because of a push.
async function sendOfferPush(bookingId, driverId) {
  try {
    const offer = await one(`
      SELECT d.push_token, b.pickup_text, b.drop_text, b.car_category
      FROM drivers d JOIN bookings b ON b.id = $1
      WHERE d.id = $2 AND d.push_token IS NOT NULL
    `, [bookingId, driverId]);
    if (!offer) return;
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        to: offer.push_token,
        title: 'New booking offer',
        body: `${offer.pickup_text} → ${offer.drop_text} (${offer.car_category}). Respond within ${OFFER_TIMEOUT_SECONDS}s.`,
        sound: 'default',
        priority: 'high',
        channelId: 'booking-offers',
        ttl: OFFER_TIMEOUT_SECONDS,
        data: { bookingId }
      })
    });
    const result = (await response.json())?.data;
    if (result?.details?.error === 'DeviceNotRegistered') {
      await query('UPDATE drivers SET push_token = NULL WHERE id = $1 AND push_token = $2', [driverId, offer.push_token]);
    } else if (result?.status === 'error') {
      console.error('Offer push rejected', result.message);
    }
  } catch (error) {
    console.error('Offer push failed', error.message);
  }
}

// Locking the vehicle row stops two concurrent offers from grabbing the same cab.
async function offerBooking(bookingId, cab) {
  const offered = await transaction(async (client) => {
    await query("SELECT id FROM vehicles WHERE id = $1 FOR UPDATE", [cab.vehicle_id], client);
    const free = await one(`SELECT v.id FROM vehicles v WHERE v.id = $1 AND ${cabIsFreeSql}`, [cab.vehicle_id], client);
    if (!free) return false;
    const offered = await one(`
      UPDATE bookings
      SET vehicle_id = $1, driver_id = $2, driver_status = 'OFFERED', updated_at = now()
      WHERE id = $3 AND status = 'PENDING' AND driver_id IS NULL
      RETURNING id
    `, [cab.vehicle_id, cab.driver_id, bookingId], client);
    if (!offered) return false;
    await query("INSERT INTO driver_status_events (booking_id, driver_id, status) VALUES ($1, $2, 'OFFERED')",
      [bookingId, cab.driver_id], client);
    return true;
  });
  if (offered) sendOfferPush(bookingId, cab.driver_id);
  return offered;
}

function releaseOffer(bookingId, driverId) {
  return transaction(async (client) => {
    const released = await one(`
      UPDATE bookings SET driver_id = NULL, vehicle_id = NULL, driver_status = 'BOOKING_REJECTED', updated_at = now()
      WHERE id = $1 AND driver_id = $2 AND status = 'PENDING' AND driver_status = 'OFFERED'
      RETURNING id
    `, [bookingId, driverId], client);
    if (!released) return false;
    await query("INSERT INTO driver_status_events (booking_id, driver_id, status) VALUES ($1, $2, 'BOOKING_REJECTED')",
      [bookingId, driverId], client);
    return true;
  });
}

// Offer a pending booking to the nearest available cab that hasn't already
// declined it. Cabs without a known location are tried after located ones.
async function autoDispatch(bookingId) {
  const booking = await getBooking(bookingId);
  if (!booking || booking.status !== 'PENDING' || booking.driver_id) return false;
  const declined = new Set((await query(`
    SELECT driver_id FROM driver_status_events WHERE booking_id = $1 AND status = 'BOOKING_REJECTED'
  `, [bookingId])).map((row) => row.driver_id));
  const hasPickup = booking.pickup_latitude != null && booking.pickup_longitude != null;
  const candidates = (await query(availableCabsSql, [booking.car_category]))
    .filter((cab) => !declined.has(cab.driver_id))
    .map((cab) => ({
      ...cab,
      distance: hasPickup && cab.latitude != null
        ? distanceKmBetween(booking.pickup_latitude, booking.pickup_longitude, cab.latitude, cab.longitude)
        : Infinity
    }))
    .sort((a, b) => a.distance - b.distance);
  for (const cab of candidates) {
    if (await offerBooking(bookingId, cab)) return true;
  }
  return false;
}

// Expire unanswered offers, then try to place every waiting booking.
let sweepRunning = false;
async function runDispatchSweep() {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    const expired = await query(`
      SELECT id, driver_id FROM bookings
      WHERE status = 'PENDING' AND driver_status = 'OFFERED'
        AND updated_at <= now() - make_interval(secs => $1)
    `, [OFFER_TIMEOUT_SECONDS]);
    for (const offer of expired) await releaseOffer(offer.id, offer.driver_id);
    const waiting = await query(`
      SELECT id FROM bookings WHERE status = 'PENDING' AND driver_id IS NULL
      ORDER BY trip_datetime ASC
    `);
    for (const booking of waiting) await autoDispatch(booking.id);
  } catch (error) {
    console.error('Dispatch sweep failed', error);
  } finally {
    sweepRunning = false;
  }
}
setInterval(runDispatchSweep, 10_000).unref();

app.post('/admin/bookings/:id/assign', requireAdmin, handle(async (req, res) => {
  const bookingId = Number(req.params.id);
  const vehicleId = Number(req.body.vehicleId);
  if (!Number.isInteger(vehicleId) || vehicleId < 1) {
    return res.status(400).json({ error: 'Choose a cab first' });
  }
  const booking = await getBooking(bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status !== 'PENDING') {
    return res.status(409).json({ error: 'Only pending bookings can be assigned' });
  }
  const cab = await one(`${availableCabsSql} AND v.id = $2`, [booking.car_category, vehicleId]);
  if (!cab) {
    return res.status(409).json({ error: 'This cab is offline, busy with another booking, or a different vehicle type' });
  }
  // Admin choice overrides an automatic offer that is still waiting.
  if (booking.driver_id) {
    if (booking.driver_status !== 'OFFERED') return res.status(409).json({ error: 'A driver has already accepted this booking' });
    await releaseOffer(bookingId, booking.driver_id);
  }
  if (!(await offerBooking(bookingId, cab))) return res.status(409).json({ error: 'Booking could not be offered; refresh and try again' });
  res.json({ booking: publicBooking(await getBooking(bookingId)) });
}));

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
  if (!online) {
    const offers = await query(`SELECT id FROM bookings WHERE driver_id = $1 AND status = 'PENDING' AND driver_status = 'OFFERED'`, [req.driver.id]);
    for (const offer of offers) await releaseOffer(offer.id, req.driver.id);
  }
  await runDispatchSweep();
  res.json({ online });
}));

// The driver app registers its Expo push token so offers can ring a locked phone.
app.post('/driver/push-token', requireDriver, handle(async (req, res) => {
  const { token } = req.body;
  if (token !== null && (typeof token !== 'string' || !/^Expo(nent)?PushToken\[[^\]]{10,200}\]$/.test(token))) {
    return res.status(400).json({ error: 'A valid Expo push token is required' });
  }
  // A phone belongs to one driver at a time: drop the token from anyone else who had it.
  await transaction(async (client) => {
    if (token) await query('UPDATE drivers SET push_token = NULL WHERE push_token = $1 AND id <> $2', [token, req.driver.id], client);
    await query('UPDATE drivers SET push_token = $1 WHERE id = $2', [token, req.driver.id], client);
  });
  res.json({ registered: Boolean(token) });
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

app.get('/driver/me', requireDriver, handle(async (req, res) => {
  const cab = await one('SELECT cab_ref, plate_no, category, model FROM vehicles WHERE driver_id = $1', [req.driver.id]);
  res.json({ driver: { name: req.driver.driver_name, phone: req.driver.phone, online: Boolean(req.driver.is_online), cab } });
}));

app.get('/driver/bookings', requireDriver, handle(async (req, res) => {
  const bookings = await query(`
    SELECT b.*, v.plate_no, v.model AS vehicle_model
    FROM bookings b
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    WHERE b.driver_id = $1 AND b.status IN ('PENDING','CONFIRMED','ONGOING')
    ORDER BY b.trip_datetime ASC
  `, [req.driver.id]);
  res.json({ bookings: bookings.map(publicBooking) });
}));

app.patch('/driver/bookings/:id/response', requireDriver, handle(async (req, res) => {
  const bookingId = Number(req.params.id);
  const { decision } = req.body;
  if (!['ACCEPT', 'REJECT'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be ACCEPT or REJECT' });
  }
  const booking = await one('SELECT * FROM bookings WHERE id = $1 AND driver_id = $2', [bookingId, req.driver.id]);
  if (!booking) return res.status(404).json({ error: 'Booking offer not found' });
  if (booking.status !== 'PENDING' || booking.driver_status !== 'OFFERED') {
    return res.status(409).json({ error: 'This booking is no longer awaiting a response' });
  }

  if (decision === 'REJECT') {
    await releaseOffer(bookingId, req.driver.id);
    await runDispatchSweep();
    return res.json({ accepted: false });
  }

  const accepted = await transaction(async (client) => {
    const updated = await one(`
      UPDATE bookings SET status = 'CONFIRMED', driver_status = 'BOOKING_ACCEPTED', updated_at = now()
      WHERE id = $1 AND driver_id = $2 AND status = 'PENDING' AND driver_status = 'OFFERED'
      RETURNING id
    `, [bookingId, req.driver.id], client);
    if (!updated) return false;
    await query(`
      INSERT INTO booking_status_events (booking_id, old_status, new_status, note)
      VALUES ($1, 'PENDING', 'CONFIRMED', 'Accepted by assigned partner driver')
    `, [bookingId], client);
    await query("INSERT INTO driver_status_events (booking_id, driver_id, status) VALUES ($1, $2, 'BOOKING_ACCEPTED')",
      [bookingId, req.driver.id], client);
    return true;
  });
  if (!accepted) return res.status(409).json({ error: 'This booking is no longer awaiting a response' });
  res.json({ accepted: true, booking: publicBooking(await getBooking(bookingId)) });
}));

app.patch('/driver/bookings/:id/status', requireDriver, handle(async (req, res) => {
  const bookingId = Number(req.params.id);
  const { status } = req.body;
  const nextStatus = {
    BOOKING_ACCEPTED: 'GOING_TO_PICKUP',
    GOING_TO_PICKUP: 'ARRIVED',
    ARRIVED: 'TRIP_STARTED',
    TRIP_STARTED: 'TRIP_COMPLETED'
  };
  const booking = await one('SELECT * FROM bookings WHERE id = $1 AND driver_id = $2', [bookingId, req.driver.id]);
  if (!booking) return res.status(404).json({ error: 'Assigned booking not found' });
  if (nextStatus[booking.driver_status] !== status) {
    return res.status(409).json({ error: 'Trip status must advance to the next valid stage' });
  }

  const bookingStatus = status === 'TRIP_STARTED' ? 'ONGOING' : status === 'TRIP_COMPLETED' ? 'COMPLETED' : booking.status;
  const advanced = await transaction(async (client) => {
    const updated = await one(`
      UPDATE bookings SET driver_status = $1, status = $2, updated_at = now()
      WHERE id = $3 AND driver_status = $4
      RETURNING id
    `, [status, bookingStatus, bookingId, booking.driver_status], client);
    if (!updated) return false;
    await query('INSERT INTO driver_status_events (booking_id, driver_id, status) VALUES ($1, $2, $3)',
      [bookingId, req.driver.id, status], client);
    if (bookingStatus !== booking.status) {
      await query(`
        INSERT INTO booking_status_events (booking_id, old_status, new_status, note)
        VALUES ($1, $2, $3, $4)
      `, [bookingId, booking.status, bookingStatus, status], client);
    }
    return true;
  });
  if (!advanced) return res.status(409).json({ error: 'Trip status must advance to the next valid stage' });
  if (status === 'TRIP_COMPLETED') await runDispatchSweep();
  res.json({ booking: publicBooking(await getBooking(bookingId)) });
}));

app.get('/bookings/:id/tracking', handle(async (req, res) => {
  const token = req.get('x-booking-tracking-token') || '';
  if (!token) return res.status(401).json({ error: 'Booking tracking token required' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const booking = await one('SELECT tracking_token_hash FROM bookings WHERE id = $1', [Number(req.params.id)]);
  if (!booking?.tracking_token_hash) return res.status(404).json({ error: 'Booking not found' });
  const suppliedHash = Buffer.from(tokenHash);
  const expectedHash = Buffer.from(booking.tracking_token_hash);
  if (suppliedHash.length !== expectedHash.length || !timingSafeEqual(suppliedHash, expectedHash)) {
    return res.status(401).json({ error: 'Invalid booking tracking token' });
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
  console.error('Request failed', error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(port, () => {
  console.log(`SadakYatra backend running on http://localhost:${port}`);
});
