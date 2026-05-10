-- SadakYatra MVP schema (PostgreSQL)

CREATE TYPE user_role AS ENUM ('CUSTOMER','ADMIN','DRIVER');
CREATE TYPE booking_status AS ENUM ('PENDING','CONFIRMED','ONGOING','COMPLETED','CANCELLED');
CREATE TYPE payment_status AS ENUM ('UNPAID','PARTIAL','PAID','REFUNDED');

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
  license_no VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE vehicles (
  id BIGSERIAL PRIMARY KEY,
  plate_no VARCHAR(30) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL,
  model VARCHAR(80),
  seats INT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
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
  trip_datetime TIMESTAMPTZ NOT NULL,
  estimated_fare NUMERIC(10,2),
  final_fare NUMERIC(10,2),
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
