import fs from 'node:fs';
import path from 'node:path';
import db from '../src/db.js';

const schemaPath = path.resolve(process.cwd(), 'sql/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

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
