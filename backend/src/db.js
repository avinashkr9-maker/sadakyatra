import sqlite3 from 'sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.cwd(), 'data.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
});

export default db;
