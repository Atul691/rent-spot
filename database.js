require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDb() {

  /* ---------------- USERS ---------------- */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'user',
      approved INTEGER DEFAULT 0
    )
  `);

  /* ---------------- PG ---------------- */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pg(
      id SERIAL PRIMARY KEY,
      title TEXT,
      price TEXT,
      location TEXT,
      description TEXT,
      whatsapp TEXT,
      map TEXT
    )
  `);

  /* ---------------- IMAGES ---------------- */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS images(
      id SERIAL PRIMARY KEY,
      pg_id INTEGER,
      image TEXT
    )
  `);

  /* ---------------- BOOKINGS ---------------- */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings(
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      pg_id INTEGER,
      full_name TEXT,
      phone TEXT,
      age TEXT,
      entry_date TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending'
    )
  `);

  /* ---------------- RATINGS ---------------- */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ratings(
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      pg_id INTEGER,
      rating INTEGER,
      comment TEXT DEFAULT ''
    )
  `);

  /* ---------------- MESSAGES ---------------- */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages(
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      message TEXT
    )
  `);

  /* ---------------- NOTIFICATIONS ---------------- */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications(
      id SERIAL PRIMARY KEY,
      text TEXT
    )
  `);

  /* ---------------- SETTINGS ---------------- */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings(
      id INTEGER PRIMARY KEY,
      upi TEXT,
      qr_image TEXT
    )
  `);

  await pool.query(`
    INSERT INTO settings(id, upi, qr_image)
    VALUES(1, $1, $2)
    ON CONFLICT (id) DO NOTHING
  `, [process.env.UPI_ID || "atul@upi", ""]);


  /* 🔥 ---------------- NEGOTIATION TABLE (NEW FEATURE) ---------------- */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS negotiations(
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      pg_id INTEGER NOT NULL,
      offered_price INTEGER NOT NULL,
      counter_price INTEGER,
      status TEXT DEFAULT 'pending',
      message TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

await pool.query(`
  CREATE TABLE IF NOT EXISTS user_preferences(
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE,
    budget TEXT,
    smoking TEXT DEFAULT '',
    sleep_time TEXT DEFAULT '',
    occupation TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
}
module.exports = { pool, initDb };