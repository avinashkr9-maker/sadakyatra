import express from 'express';
import cors from 'cors';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import db from './db.js';
import { execSync } from 'node:child_process';

execSync('node scripts/init-db.js', { stdio: 'inherit' });

const app = express();
const port = process.env.PORT || 4000;
const nano = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8);

app.use(cors());
app.use(express.json());

const validCategories = new Set(['sedan', 'suv', 'traveller']);
const validStatuses = new Set(['PENDING', 'CONFIRMED', 'ONGOING', 'COMPLETED', 'CANCELLED']);
const validServiceTypes = new Set(['OUTSTATION', 'AIRPORT', 'WEDDING', 'LOCAL']);
const fareRates = {
  sedanPerKm: 23,
  suvPerKm: 27,
  roundTripMultiplier: 1.75,
  localSedanFare: 1500,
  localSuvFare: 2000,
  minimumFare: 1500
};
const adminApiKey = process.env.ADMIN_API_KEY || '';
const partnerApplicationAttempts = new Map();

function calculateFare(category, distanceKm, serviceType, roundTrip = false) {
  if (category === 'traveller') return null;
  if (serviceType === 'LOCAL') {
    return category === 'sedan' ? fareRates.localSedanFare : fareRates.localSuvFare;
  }
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;

  const perKmRate = category === 'sedan' ? fareRates.sedanPerKm : fareRates.suvPerKm;
  const oneWayFare = Math.max(distanceKm * perKmRate, fareRates.minimumFare);
  return Math.round(oneWayFare * (roundTrip ? fareRates.roundTripMultiplier : 1));
}

function requireAdmin(req, res, next) {
  if (!adminApiKey) {
    return res.status(503).json({ error: 'Admin API is not configured' });
  }

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

function requireDriver(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Driver authentication required' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const driver = db.prepare(`
    SELECT d.*, p.active AS partner_active
    FROM drivers d
    JOIN partners p ON p.id = d.partner_id
    WHERE d.access_token_hash = ? AND d.is_active = 1 AND p.active = 1
  `).get(tokenHash);
  if (!driver) return res.status(401).json({ error: 'Invalid driver token' });
  req.driver = driver;
  next();
}

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
      a: 'Driver allowance is included. Tolls and state taxes are disclosed before final confirmation.'
    },
    {
      q: 'Do you support wedding packages?',
      a: 'Yes. Wedding package starts around Rs 4500 and includes decoration and chauffeur.'
    }
  ],
  testimonials: [
    { name: 'Arvind Singh', rating: 5, text: 'Wedding car was decorated and arrived on time. Highly recommended.' },
    { name: 'Pooja Verma', rating: 5, text: 'Outstation trip was smooth and driver was punctual and professional.' },
    { name: 'Ravi Thakur', rating: 5, text: 'Transparent rates, clean car, and safe experience.' }
  ]
};

app.get('/', (_req, res) => {
  res.send('SadakYatra backend is running');
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'sadakyatra-backend' });
});

app.get('/app/config', (_req, res) => {
  res.json(appConfig);
});

app.get('/config', (_req, res) => {
  res.json(appConfig);
});

app.post('/auth/mock-login', (req, res) => {
  const { phone, fullName } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    const info = db.prepare('INSERT INTO users (role, full_name, phone) VALUES (?, ?, ?)')
      .run('CUSTOMER', fullName || null, phone);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }

  res.json({
    token: `mock-token-${user.id}`,
    user: { id: user.id, role: user.role, fullName: user.full_name, phone: user.phone }
  });
});

app.post('/partners/applications', limitPartnerApplications, (req, res) => {
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

  const applicationRef = `SY-APP-${nano()}`;
  const result = db.prepare(`
    INSERT INTO partner_applications (
      application_ref, full_name, phone, vehicle_number, vehicle_category,
      vehicle_model, seats, driver_name, driver_phone, city, operating_area
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    applicationRef,
    fullName.trim(),
    phone,
    plate,
    vehicleCategory,
    vehicleModel.trim(),
    seats == null ? null : Number(seats),
    driverName.trim(),
    driverPhone,
    city.trim(),
    operatingArea.trim()
  );

  res.status(201).json({
    application: {
      id: result.lastInsertRowid,
      applicationRef,
      status: 'PENDING',
      message: 'Application received. The team will contact you to verify your phone and documents.'
    }
  });
});

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
  return res.json({
    category,
    distanceKm: parsedDistance,
    serviceType,
    roundTrip,
    estimatedFare: calculateFare(category, parsedDistance, serviceType, roundTrip),
    fareUnavailable: category === 'traveller'
  });
});

app.post('/bookings', (req, res) => {
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
  const coordinates = [pickupLatitude, pickupLongitude, dropLatitude, dropLongitude];
  if (coordinates.some((value) => value != null && !Number.isFinite(Number(value)))) {
    return res.status(400).json({ error: 'Location coordinates must be numeric' });
  }
  if (routeDistanceKm != null && (!Number.isFinite(Number(routeDistanceKm)) || Number(routeDistanceKm) < 0)) {
    return res.status(400).json({ error: 'routeDistanceKm must be a non-negative number' });
  }

  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    const info = db.prepare('INSERT INTO users (role, full_name, phone) VALUES (?, ?, ?)')
      .run('CUSTOMER', fullName || null, phone);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }

  const estimated = calculateFare(
    carCategory,
    routeDistanceKm == null ? null : Number(routeDistanceKm),
    serviceType,
    roundTrip
  );

  const trackingToken = randomBytes(32).toString('base64url');
  const trackingTokenHash = createHash('sha256').update(trackingToken).digest('hex');
  const bookingRef = `SY-${nano()}`;
  const info = db.prepare(`
    INSERT INTO bookings (
      booking_ref, customer_id, service_type, pickup_text, drop_text,
      pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, route_distance_km, tracking_token_hash,
      trip_datetime, car_category, estimated_fare, customer_note, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(
    bookingRef,
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
    estimated,
    customerNote || null
  );

  db.prepare(`
    INSERT INTO booking_status_events (booking_id, old_status, new_status, changed_by_user_id, note)
    VALUES (?, NULL, 'PENDING', ?, ?)
  `).run(info.lastInsertRowid, user.id, 'Booking created');

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ booking: publicBooking(booking), trackingToken });
});

app.get('/bookings/:id', (req, res) => {
  const id = Number(req.params.id);
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const events = db.prepare(
    'SELECT * FROM booking_status_events WHERE booking_id = ? ORDER BY id ASC'
  ).all(id);
  res.json({ booking: publicBooking(booking), events });
});

app.get('/bookings', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone query param is required' });

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(String(phone));
  if (!user) return res.json({ bookings: [] });

  const bookings = db.prepare(
    'SELECT * FROM bookings WHERE customer_id = ? ORDER BY datetime(created_at) DESC'
  ).all(user.id);
  res.json({ bookings: bookings.map(publicBooking) });
});

app.post('/bookings/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const { phone, note } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  const customer = db.prepare('SELECT * FROM users WHERE id = ?').get(booking.customer_id);
  if (!customer || customer.phone !== phone) {
    return res.status(403).json({ error: 'This booking does not belong to this phone number' });
  }
  if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Booking can no longer be cancelled' });
  }

  db.prepare("UPDATE bookings SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?").run(id);
  db.prepare(`
    INSERT INTO booking_status_events (booking_id, old_status, new_status, changed_by_user_id, note)
    VALUES (?, ?, 'CANCELLED', ?, ?)
  `).run(id, booking.status, booking.customer_id, note || 'Cancelled by customer');

  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  res.json({ booking: publicBooking(updated) });
});

app.get('/admin/bookings', requireAdmin, (req, res) => {
  const status = req.query.status;
  if (status && !validStatuses.has(String(status))) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }

  const rows = status
    ? db.prepare('SELECT * FROM bookings WHERE status = ? ORDER BY created_at DESC').all(String(status))
    : db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all();

  res.json({ bookings: rows.map(publicBooking) });
});

app.patch('/admin/bookings/:id/status', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status, changedByUserId, note } = req.body;

  if (!status || !validStatuses.has(status)) {
    return res.status(400).json({ error: 'Valid status is required' });
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  db.prepare(`
    UPDATE bookings
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, id);

  db.prepare(`
    INSERT INTO booking_status_events (booking_id, old_status, new_status, changed_by_user_id, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, booking.status, status, changedByUserId || null, note || null);

  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  res.json({ booking: publicBooking(updated) });
});

app.get('/admin/partners/applications', requireAdmin, (req, res) => {
  const status = String(req.query.status || 'PENDING');
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid application status' });
  }
  const applications = db.prepare(`
    SELECT * FROM partner_applications WHERE status = ? ORDER BY created_at ASC
  `).all(status);
  res.json({ applications });
});

app.patch('/admin/partners/applications/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status, reviewNote } = req.body;
  if (status !== 'REJECTED') {
    return res.status(400).json({ error: 'Use the approval endpoint to approve applications' });
  }
  const application = db.prepare('SELECT * FROM partner_applications WHERE id = ?').get(id);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.status !== 'PENDING') {
    return res.status(409).json({ error: 'Only pending applications can be rejected' });
  }
  db.prepare(`
    UPDATE partner_applications
    SET status = 'REJECTED', review_note = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(String(reviewNote || '').slice(0, 500) || null, id);
  res.json({ application: db.prepare('SELECT * FROM partner_applications WHERE id = ?').get(id) });
});

app.post('/admin/partners/applications/:id/approve', requireAdmin, (req, res) => {
  if (process.env.PARTNER_DOCUMENTS_PRIVATE !== 'true' || !process.env.PARTNER_DOCUMENTS_BUCKET) {
    return res.status(503).json({ error: 'Private partner document storage is not configured' });
  }

  const id = Number(req.params.id);
  const { phoneVerified, rcDocumentKey, dlDocumentKey, insuranceDocumentKey } = req.body;
  const application = db.prepare('SELECT * FROM partner_applications WHERE id = ?').get(id);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.status !== 'PENDING') {
    return res.status(409).json({ error: 'Only pending applications can be approved' });
  }
  if (phoneVerified !== true) {
    return res.status(400).json({ error: 'Verify the partner phone before approval' });
  }

  const documentKeys = [rcDocumentKey, dlDocumentKey, insuranceDocumentKey];
  const documentPrefix = `partners/applications/${application.application_ref}/`;
  if (documentKeys.some((key) => typeof key !== 'string' || !key.startsWith(documentPrefix) || key.includes('..') || key.includes('\\'))) {
    return res.status(400).json({ error: 'RC, DL, and insurance private document keys are required' });
  }

  const existingUser = db.prepare('SELECT * FROM users WHERE phone = ?').get(application.driver_phone);
  if (existingUser) {
    return res.status(409).json({ error: 'Driver phone is already registered; resolve the existing account first' });
  }
  const existingVehicle = db.prepare('SELECT id FROM vehicles WHERE plate_no = ?').get(application.vehicle_number);
  if (existingVehicle) return res.status(409).json({ error: 'Vehicle registration is already in the fleet' });

  const driverToken = randomBytes(32).toString('base64url');
  const driverTokenHash = createHash('sha256').update(driverToken).digest('hex');
  const partnerRef = `SY-PARTNER-${nano()}`;
  const createPartner = db.transaction(() => {
    const partner = db.prepare(`
      INSERT INTO partners (partner_ref, application_id, full_name, phone, city, operating_area)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(partnerRef, id, application.full_name, application.phone, application.city, application.operating_area);
    const user = db.prepare(`
      INSERT INTO users (role, full_name, phone) VALUES ('DRIVER', ?, ?)
    `).run(application.driver_name, application.driver_phone);
    const driver = db.prepare(`
      INSERT INTO drivers (user_id, partner_id, driver_name, phone, access_token_hash)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.lastInsertRowid, partner.lastInsertRowid, application.driver_name, application.driver_phone, driverTokenHash);
    const vehicle = db.prepare(`
      INSERT INTO vehicles (
        plate_no, category, model, seats, partner_id, driver_id,
        rc_document_key, dl_document_key, insurance_document_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      application.vehicle_number,
      application.vehicle_category,
      application.vehicle_model,
      application.seats,
      partner.lastInsertRowid,
      driver.lastInsertRowid,
      rcDocumentKey,
      dlDocumentKey,
      insuranceDocumentKey
    );
    const cabRef = `SY-CAB-${String(vehicle.lastInsertRowid).padStart(6, '0')}`;
    db.prepare('UPDATE vehicles SET cab_ref = ? WHERE id = ?').run(cabRef, vehicle.lastInsertRowid);
    db.prepare(`
      UPDATE partner_applications
      SET status = 'APPROVED', phone_verified = 1,
          rc_document_key = ?, dl_document_key = ?, insurance_document_key = ?,
          reviewed_at = datetime('now')
      WHERE id = ?
    `).run(rcDocumentKey, dlDocumentKey, insuranceDocumentKey, id);
    return { partnerId: partner.lastInsertRowid, driverId: driver.lastInsertRowid, vehicleId: vehicle.lastInsertRowid, cabRef };
  });

  const created = createPartner();
  res.status(201).json({ ...created, partnerRef, driverAccessToken: driverToken });
});

app.get('/admin/partners', requireAdmin, (_req, res) => {
  const partners = db.prepare(`
    SELECT p.id AS partner_id, p.partner_ref, p.full_name, p.phone, p.city, p.operating_area,
      p.active AS partner_active, v.id AS vehicle_id, v.cab_ref, v.plate_no, v.category, v.model, v.active AS vehicle_active,
      d.id AS driver_id, d.driver_name, d.phone AS driver_phone, d.is_online,
      d.latitude, d.longitude, d.location_updated_at
    FROM partners p
    LEFT JOIN vehicles v ON v.partner_id = p.id
    LEFT JOIN drivers d ON d.partner_id = p.id
    ORDER BY p.created_at DESC
  `).all();
  res.json({ partners });
});

app.patch('/admin/partners/:id', requireAdmin, (req, res) => {
  const partnerId = Number(req.params.id);
  const { active } = req.body;
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });
  const partner = db.prepare('SELECT id FROM partners WHERE id = ?').get(partnerId);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const updatePartner = db.transaction(() => {
    db.prepare('UPDATE partners SET active = ? WHERE id = ?').run(Number(active), partnerId);
    if (!active) {
      db.prepare(`
        UPDATE drivers SET is_online = 0, latitude = NULL, longitude = NULL, location_updated_at = NULL
        WHERE partner_id = ?
      `).run(partnerId);
    }
  });
  updatePartner();
  res.json({ partner: { id: partnerId, active } });
});

app.patch('/admin/vehicles/:id', requireAdmin, (req, res) => {
  const vehicleId = Number(req.params.id);
  const { active } = req.body;
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });
  const result = db.prepare('UPDATE vehicles SET active = ? WHERE id = ?').run(Number(active), vehicleId);
  if (!result.changes) return res.status(404).json({ error: 'Vehicle not found' });
  res.json({ vehicle: { id: vehicleId, active } });
});

app.post('/admin/bookings/:id/assign', requireAdmin, (req, res) => {
  const bookingId = Number(req.params.id);
  const vehicleId = Number(req.body.vehicleId);
  if (!Number.isInteger(vehicleId) || vehicleId < 1) {
    return res.status(400).json({ error: 'A valid vehicleId is required' });
  }
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status !== 'PENDING') {
    return res.status(409).json({ error: 'Only pending bookings can be assigned' });
  }
  if (booking.driver_id || booking.vehicle_id) {
    return res.status(409).json({ error: 'Booking already has a cab offer' });
  }

  const vehicle = db.prepare(`
    SELECT v.id, d.id AS driver_id
    FROM vehicles v
    JOIN partners p ON p.id = v.partner_id AND p.active = 1
    JOIN drivers d ON d.id = v.driver_id AND d.is_active = 1 AND d.is_online = 1
    WHERE v.id = ? AND v.active = 1 AND v.category = ?
      AND NOT EXISTS (
        SELECT 1 FROM bookings assigned
        WHERE assigned.vehicle_id = v.id
          AND (assigned.status IN ('CONFIRMED','ONGOING')
            OR (assigned.status = 'PENDING' AND assigned.driver_status = 'OFFERED'))
      )
  `).get(vehicleId, booking.car_category);
  if (!vehicle) {
    return res.status(409).json({ error: 'Vehicle must match the requested category and have an online, available driver' });
  }

  const assign = db.transaction(() => {
    db.prepare(`
      UPDATE bookings
      SET vehicle_id = ?, driver_id = ?, driver_status = 'OFFERED', updated_at = datetime('now')
      WHERE id = ? AND status = 'PENDING'
    `).run(vehicle.id, vehicle.driver_id, bookingId);
    db.prepare(`
      INSERT INTO driver_status_events (booking_id, driver_id, status)
      VALUES (?, ?, 'OFFERED')
    `).run(bookingId, vehicle.driver_id);
  });
  assign();
  res.json({ booking: publicBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId)) });
});

app.patch('/driver/presence', requireDriver, (req, res) => {
  const { online } = req.body;
  if (typeof online !== 'boolean') {
    return res.status(400).json({ error: 'online must be a boolean' });
  }
  db.prepare(`
    UPDATE drivers
    SET is_online = ?,
        latitude = CASE WHEN ? = 0 THEN NULL ELSE latitude END,
        longitude = CASE WHEN ? = 0 THEN NULL ELSE longitude END,
        location_updated_at = CASE WHEN ? = 0 THEN NULL ELSE location_updated_at END
    WHERE id = ?
  `).run(Number(online), Number(online), Number(online), Number(online), req.driver.id);
  res.json({ online });
});

app.post('/driver/location', requireDriver, (req, res) => {
  const { latitude, longitude } = req.body;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }
  if (!req.driver.is_online) return res.status(409).json({ error: 'Driver must be online to share a location' });
  db.prepare(`
    UPDATE drivers
    SET latitude = ?, longitude = ?, location_updated_at = datetime('now')
    WHERE id = ?
  `).run(latitude, longitude, req.driver.id);
  res.json({ latitude, longitude, updatedAt: new Date().toISOString() });
});

app.get('/driver/bookings', requireDriver, (req, res) => {
  const bookings = db.prepare(`
    SELECT b.*, v.plate_no, v.model AS vehicle_model
    FROM bookings b
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    WHERE b.driver_id = ? AND b.status IN ('PENDING','CONFIRMED','ONGOING')
    ORDER BY datetime(b.trip_datetime) ASC
  `).all(req.driver.id);
  res.json({ bookings: bookings.map(publicBooking) });
});

app.patch('/driver/bookings/:id/response', requireDriver, (req, res) => {
  const bookingId = Number(req.params.id);
  const { decision } = req.body;
  if (!['ACCEPT', 'REJECT'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be ACCEPT or REJECT' });
  }
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND driver_id = ?').get(bookingId, req.driver.id);
  if (!booking) return res.status(404).json({ error: 'Booking offer not found' });
  if (booking.status !== 'PENDING' || booking.driver_status !== 'OFFERED') {
    return res.status(409).json({ error: 'This booking is no longer awaiting a response' });
  }

  if (decision === 'REJECT') {
    const rejectOffer = db.transaction(() => {
      db.prepare(`
        UPDATE bookings SET driver_id = NULL, vehicle_id = NULL, driver_status = 'BOOKING_REJECTED', updated_at = datetime('now')
        WHERE id = ? AND driver_id = ? AND driver_status = 'OFFERED'
      `).run(bookingId, req.driver.id);
      db.prepare(`
        INSERT INTO driver_status_events (booking_id, driver_id, status)
        VALUES (?, ?, 'BOOKING_REJECTED')
      `).run(bookingId, req.driver.id);
    });
    rejectOffer();
    return res.json({ accepted: false, booking: publicBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId)) });
  }

  const acceptOffer = db.transaction(() => {
    db.prepare(`
      UPDATE bookings SET status = 'CONFIRMED', driver_status = 'BOOKING_ACCEPTED', updated_at = datetime('now')
      WHERE id = ? AND driver_id = ? AND status = 'PENDING' AND driver_status = 'OFFERED'
    `).run(bookingId, req.driver.id);
    db.prepare(`
      INSERT INTO booking_status_events (booking_id, old_status, new_status, changed_by_user_id, note)
      VALUES (?, 'PENDING', 'CONFIRMED', ?, 'Accepted by assigned partner driver')
    `).run(bookingId, req.driver.user_id);
    db.prepare(`
      INSERT INTO driver_status_events (booking_id, driver_id, status)
      VALUES (?, ?, 'BOOKING_ACCEPTED')
    `).run(bookingId, req.driver.id);
  });
  acceptOffer();
  res.json({ accepted: true, booking: publicBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId)) });
});

app.patch('/driver/bookings/:id/status', requireDriver, (req, res) => {
  const bookingId = Number(req.params.id);
  const { status } = req.body;
  const nextStatus = {
    BOOKING_ACCEPTED: 'GOING_TO_PICKUP',
    GOING_TO_PICKUP: 'ARRIVED',
    ARRIVED: 'TRIP_STARTED',
    TRIP_STARTED: 'TRIP_COMPLETED'
  };
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND driver_id = ?').get(bookingId, req.driver.id);
  if (!booking) return res.status(404).json({ error: 'Assigned booking not found' });
  if (nextStatus[booking.driver_status] !== status) {
    return res.status(409).json({ error: 'Trip status must advance to the next valid stage' });
  }

  const bookingStatus = status === 'TRIP_STARTED' ? 'ONGOING' : status === 'TRIP_COMPLETED' ? 'COMPLETED' : booking.status;
  const updateStatus = db.transaction(() => {
    db.prepare(`
      UPDATE bookings SET driver_status = ?, status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status, bookingStatus, bookingId);
    db.prepare(`
      INSERT INTO driver_status_events (booking_id, driver_id, status) VALUES (?, ?, ?)
    `).run(bookingId, req.driver.id, status);
    if (bookingStatus !== booking.status) {
      db.prepare(`
        INSERT INTO booking_status_events (booking_id, old_status, new_status, changed_by_user_id, note)
        VALUES (?, ?, ?, ?, ?)
      `).run(bookingId, booking.status, bookingStatus, req.driver.user_id, status);
    }
  });
  updateStatus();
  res.json({ booking: publicBooking(db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId)) });
});

app.get('/bookings/:id/tracking', (req, res) => {
  const token = req.get('x-booking-tracking-token') || '';
  if (!token) return res.status(401).json({ error: 'Booking tracking token required' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const booking = db.prepare('SELECT tracking_token_hash FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!booking?.tracking_token_hash) return res.status(404).json({ error: 'Booking not found' });
  const suppliedHash = Buffer.from(tokenHash);
  const expectedHash = Buffer.from(booking.tracking_token_hash);
  if (suppliedHash.length !== expectedHash.length || !timingSafeEqual(suppliedHash, expectedHash)) {
    return res.status(401).json({ error: 'Invalid booking tracking token' });
  }
  const tracking = db.prepare(`
    SELECT b.id, b.booking_ref, b.status, b.driver_status, b.car_category,
      d.driver_name, v.plate_no, v.model AS vehicle_model,
      CASE WHEN d.is_online = 1 THEN d.latitude ELSE NULL END AS latitude,
      CASE WHEN d.is_online = 1 THEN d.longitude ELSE NULL END AS longitude,
      CASE WHEN d.is_online = 1 THEN d.location_updated_at ELSE NULL END AS location_updated_at
    FROM bookings b
    JOIN users u ON u.id = b.customer_id
    LEFT JOIN drivers d ON d.id = b.driver_id
    LEFT JOIN vehicles v ON v.id = b.vehicle_id
    WHERE b.id = ?
  `).get(Number(req.params.id));
  if (!tracking) return res.status(404).json({ error: 'Booking not found' });
  res.json({ tracking });
});

app.listen(port, () => {
  console.log(`SadakYatra backend running on http://localhost:${port}`);
});
