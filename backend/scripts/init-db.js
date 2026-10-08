import fs from 'node:fs';
import path from 'node:path';
import db from '../src/db.js';

const schemaPath = path.resolve(process.cwd(), 'sql/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

const bookingColumns = new Set(db.pragma('table_info(bookings)').map((column) => column.name));
const bookingColumnMigrations = [
  ['pickup_latitude', 'REAL'],
  ['pickup_longitude', 'REAL'],
  ['drop_latitude', 'REAL'],
  ['drop_longitude', 'REAL'],
  ['route_distance_km', 'REAL'],
  ['tracking_token_hash', 'TEXT']
];
for (const [column, type] of bookingColumnMigrations) {
  if (!bookingColumns.has(column)) {
    db.exec(`ALTER TABLE bookings ADD COLUMN ${column} ${type}`);
  }
}

const migrations = [
  ['partner_applications', 'phone_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ['partner_applications', 'rc_document_key', 'TEXT'],
  ['partner_applications', 'dl_document_key', 'TEXT'],
  ['partner_applications', 'insurance_document_key', 'TEXT'],
  ['vehicles', 'cab_ref', 'TEXT'],
  ['drivers', 'partner_id', 'INTEGER'],
  ['drivers', 'driver_name', 'TEXT'],
  ['drivers', 'phone', 'TEXT'],
  ['drivers', 'access_token_hash', 'TEXT'],
  ['drivers', 'is_online', 'INTEGER NOT NULL DEFAULT 0'],
  ['drivers', 'latitude', 'REAL'],
  ['drivers', 'longitude', 'REAL'],
  ['drivers', 'location_updated_at', 'TEXT'],
  ['vehicles', 'partner_id', 'INTEGER'],
  ['vehicles', 'driver_id', 'INTEGER'],
  ['vehicles', 'rc_document_key', 'TEXT'],
  ['vehicles', 'dl_document_key', 'TEXT'],
  ['vehicles', 'insurance_document_key', 'TEXT'],
  ['bookings', 'driver_status', 'TEXT']
];
const tableColumns = new Map();
for (const [table, column, type] of migrations) {
  if (!tableColumns.has(table)) {
    tableColumns.set(table, new Set(db.pragma(`table_info(${table})`).map((item) => item.name)));
  }
  const columns = tableColumns.get(table);
  if (!columns.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    columns.add(column);
  }
}

db.prepare("UPDATE vehicles SET cab_ref = 'SY-CAB-' || printf('%06d', id) WHERE cab_ref IS NULL").run();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_drivers_online ON drivers(is_online, is_active);
  CREATE INDEX IF NOT EXISTS idx_vehicles_partner ON vehicles(partner_id, active);
`);

const insertFareRule = db.prepare(`
  INSERT INTO fare_rules (origin, destination, sedan_fare, suv_fare, traveller_fare, active)
  VALUES (?, ?, ?, ?, ?, 1)
`);

const count = db.prepare('SELECT COUNT(*) AS c FROM fare_rules').get().c;
if (!count) {
  const seed = [
    ['Muzaffarpur', 'Patna', 1699, 2999, 1999],
    ['Muzaffarpur', 'Darbhanga', 1699, 2899, 1999],
    ['Muzaffarpur', 'Sitamarhi', 1700, 2799, 2000],
    ['Muzaffarpur', 'Motihari', 1999, 3399, 2299],
    ['Muzaffarpur', 'Raxaul', 2599, 4399, 2899]
  ];
  const tx = db.transaction((rows) => rows.forEach((r) => insertFareRule.run(...r)));
  tx(seed);
}

const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='ADMIN'").get().c;
if (!adminCount) {
  db.prepare('INSERT INTO users (role, full_name, phone) VALUES (?, ?, ?)')
    .run('ADMIN', 'SadakYatra Admin', '9000000000');
}

console.log('Database initialized');
