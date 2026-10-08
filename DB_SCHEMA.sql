-- SadakYatra MVP schema (PostgreSQL)

CREATE TYPE user_role AS ENUM ('CUSTOMER','ADMIN','DRIVER');
CREATE TYPE booking_status AS ENUM ('PENDING','CONFIRMED','ONGOING','COMPLETED','CANCELLED');
CREATE TYPE payment_status AS ENUM ('UNPAID','PARTIAL','PAID','REFUNDED');
CREATE TYPE partner_application_status AS ENUM ('PENDING','APPROVED','REJECTED');

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  role user_role NOT NULL,
  full_name VARCHAR(120),
  phone VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE drivers (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE NOT NULL REFERENCES users(id),
  partner_id BIGINT,
  driver_name VARCHAR(120),
  phone VARCHAR(20),
  access_token_hash CHAR(64),
  license_no VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  location_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE partner_applications (
  id BIGSERIAL PRIMARY KEY,
  application_ref VARCHAR(40) UNIQUE NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  vehicle_number VARCHAR(20) NOT NULL,
  vehicle_category VARCHAR(20) NOT NULL CHECK(vehicle_category IN ('sedan','suv','traveller')),
  vehicle_model VARCHAR(120) NOT NULL,
  seats INT,
  driver_name VARCHAR(120) NOT NULL,
  driver_phone VARCHAR(20) NOT NULL,
  city VARCHAR(120) NOT NULL,
  operating_area VARCHAR(240) NOT NULL,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  rc_document_key TEXT,
  dl_document_key TEXT,
  insurance_document_key TEXT,
  status partner_application_status NOT NULL DEFAULT 'PENDING',
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE partners (
  id BIGSERIAL PRIMARY KEY,
  partner_ref VARCHAR(40) UNIQUE NOT NULL,
  application_id BIGINT UNIQUE NOT NULL REFERENCES partner_applications(id),
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  city VARCHAR(120) NOT NULL,
  operating_area VARCHAR(240) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE drivers ADD CONSTRAINT fk_drivers_partner FOREIGN KEY (partner_id) REFERENCES partners(id);

CREATE TABLE vehicles (
  id BIGSERIAL PRIMARY KEY,
  cab_ref VARCHAR(40) UNIQUE NOT NULL,
  plate_no VARCHAR(30) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL,
  model VARCHAR(80),
  seats INT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  partner_id BIGINT REFERENCES partners(id),
  driver_id BIGINT REFERENCES drivers(id),
  rc_document_key TEXT,
  dl_document_key TEXT,
  insurance_document_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fare_rules (
  id BIGSERIAL PRIMARY KEY,
  origin VARCHAR(120) NOT NULL,
  destination VARCHAR(120) NOT NULL,
  sedan_fare NUMERIC(10,2),
  suv_fare NUMERIC(10,2),
  traveller_fare NUMERIC(10,2),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE bookings (
  id BIGSERIAL PRIMARY KEY,
  booking_ref VARCHAR(30) UNIQUE NOT NULL,
  customer_id BIGINT NOT NULL REFERENCES users(id),
  driver_id BIGINT REFERENCES drivers(id),
  vehicle_id BIGINT REFERENCES vehicles(id),
  service_type VARCHAR(40) NOT NULL,
  pickup_text VARCHAR(240) NOT NULL,
  drop_text VARCHAR(240) NOT NULL,
  pickup_latitude DOUBLE PRECISION,
  pickup_longitude DOUBLE PRECISION,
  drop_latitude DOUBLE PRECISION,
  drop_longitude DOUBLE PRECISION,
  route_distance_km NUMERIC(8,2),
  tracking_token_hash CHAR(64),
  trip_datetime TIMESTAMPTZ NOT NULL,
  estimated_fare NUMERIC(10,2),
  final_fare NUMERIC(10,2),
  driver_status VARCHAR(32),
  status booking_status NOT NULL DEFAULT 'PENDING',
  payment_state payment_status NOT NULL DEFAULT 'UNPAID',
  customer_note TEXT,
  admin_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE booking_status_events (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  old_status booking_status,
  new_status booking_status NOT NULL,
  changed_by BIGINT REFERENCES users(id),
  note TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE driver_status_events (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  driver_id BIGINT NOT NULL REFERENCES drivers(id),
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  mode VARCHAR(30) NOT NULL,
  status payment_status NOT NULL,
  txn_ref VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX idx_bookings_driver_id ON bookings(driver_id);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_trip_datetime ON bookings(trip_datetime);
CREATE INDEX idx_status_events_booking_id ON booking_status_events(booking_id);
CREATE INDEX idx_partner_applications_status ON partner_applications(status);
CREATE INDEX idx_drivers_online ON drivers(is_online, is_active);
CREATE INDEX idx_vehicles_partner ON vehicles(partner_id, active);
CREATE INDEX idx_driver_status_events_booking ON driver_status_events(booking_id, id);
