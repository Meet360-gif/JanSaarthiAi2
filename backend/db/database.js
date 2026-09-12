// Real, persistent SQLite database.
// The file jansaarthi.db is created automatically on first run in this folder.
// Every customer/officer registration, login attempt and OTP is a real row in this file —
// open it any time with a tool like "DB Browser for SQLite" to inspect it.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'jansaarthi.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role            TEXT NOT NULL CHECK(role IN ('customer','officer')),
  full_name       TEXT NOT NULL,
  phone           TEXT NOT NULL UNIQUE,
  email           TEXT,
  password_hash   TEXT NOT NULL,
  account_number  TEXT UNIQUE,
  employee_id     TEXT UNIQUE,
  branch          TEXT,
  is_verified     INTEGER NOT NULL DEFAULT 0,
  is_locked       INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK(purpose IN ('register','login','reset')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  phone       TEXT,
  event       TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_otps_phone_purpose ON otps(phone, purpose);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
`);

function logEvent(userId, phone, event, detail) {
  db.prepare(
    `INSERT INTO audit_log (user_id, phone, event, detail) VALUES (?, ?, ?, ?)`
  ).run(userId || null, phone || null, event, detail || null);
}

module.exports = { db, logEvent };
