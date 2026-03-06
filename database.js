const Database = require("better-sqlite3");

const db = new Database("rentspot.db");

db.prepare(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  approved INTEGER DEFAULT 0
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS pg(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  price TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  whatsapp TEXT DEFAULT '',
  map TEXT DEFAULT ''
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS images(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pg_id INTEGER NOT NULL,
  image TEXT NOT NULL
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pg_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  age TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'pending'
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS ratings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  pg_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT DEFAULT ''
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS settings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upi TEXT DEFAULT '',
  qr_image TEXT DEFAULT ''
)
`).run();

const setting = db.prepare("SELECT * FROM settings WHERE id = 1").get();

if (!setting) {
  db.prepare(`
    INSERT INTO settings(id, upi, qr_image)
    VALUES(1, ?, ?)
  `).run("atul@upi", "");
}

module.exports = db;