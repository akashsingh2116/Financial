const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./paths');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'finance.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial_no TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    product TEXT NOT NULL,
    issuer TEXT,
    amount REAL NOT NULL,
    maturity_amount REAL NOT NULL,
    date_of_issue TEXT NOT NULL,
    date_of_maturity TEXT NOT NULL,
    nominee_name TEXT NOT NULL,
    nominee_relation TEXT,
    premium_frequency TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    remarks TEXT,
    document_path TEXT,
    document_original_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT NOT NULL,
    entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
