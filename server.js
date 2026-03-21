require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const cloudinary =
require("cloudinary").v2;
const { CloudinaryStorage } =
require("multer-storage-cloudinary");
const path = require("path");
const fs = require("fs");

const { pool, initDb } = require("./database");

const app = express();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "rentspotsecret",
    resave: false,
    saveUninitialized: false
  })
);

/* -------------------- UPLOAD FOLDER CHECK -------------------- */

const uploadDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/* -------------------- MULTER SETUP -------------------- */
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "rent-spot",
    allowed_formats: ["jpg", "png", "jpeg", "webp"]
  }
});

const upload = multer({ storage });

/* -------------------- MIDDLEWARE -------------------- */

function auth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

function admin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/");
  }
  next();
}

/* -------------------- HOME -------------------- */

app.get("/", async (req, res) => {
  try {
    const pgListResult = await pool.query('SELECT * FROM pg ORDER BY id DESC');
    let notesResult;

if (req.session.user) {
  notesResult = await pool.query(
    `SELECT * FROM notifications
     WHERE user_id IS NULL OR user_id = $1
     ORDER BY id DESC`,
    [req.session.user.id]
  );
} else {
  notesResult = await pool.query(
    `SELECT * FROM notifications
     WHERE user_id IS NULL
     ORDER BY id DESC`
  );
}

    const pgList = pgListResult.rows;
    const notes = notesResult.rows;

    const pg = [];

    for (const item of pgList) {
      const firstImageResult = await pool.query(
        'SELECT * FROM images WHERE pg_id=$1 ORDER BY id ASC LIMIT 1',
        [item.id]
      );

      pg.push({
        ...item,
        firstImage: firstImageResult.rows[0] ? firstImageResult.rows[0].image : null
      });
    }

    res.render("home", {
      pg,
      notes,
      user: req.session.user
    });
  } catch (error) {
    console.log("HOME ERROR:", error);
    res.send("Error loading home page");
  }
});

/* -------------------- LOGIN / REGISTER -------------------- */

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.send("Please fill all fields");
    }

    const existingResult = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    if (existingResult.rows[0]) {
      return res.send("Email already registered");
    }

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users(name,email,password,phone)
       VALUES($1,$2,$3,$4)`,
      [name, email, hash, phone]
    );

    res.redirect("/login");
  } catch (error) {
    console.log("REGISTER ERROR:", error);
    res.send("Register failed");
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      req.session.user = {
        id: 0,
        name: "Admin",
        email: process.env.ADMIN_EMAIL,
        role: "admin"
      };
      return res.redirect("/admin");
    }

    const userResult = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [email]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.send("User not found");
    }

    const ok = await bcrypt.compare(password, user.password);

    if (!ok) {
      return res.send("Wrong password");
    }

    if (Number(user.approved) === 0) {
      return res.send("Admin approval pending");
    }

    req.session.user = user;
    res.redirect("/");
  } catch (error) {
    console.log("LOGIN ERROR:", error);
    res.send("Login failed");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

/* -------------------- ADMIN DASHBOARD -------------------- */

app.get("/admin", admin, async (req, res) => {
  try {
    const usersResult = await pool.query("SELECT * FROM users ORDER BY id DESC");
    const pgResult = await pool.query("SELECT * FROM pg ORDER BY id DESC");
    const messagesResult = await pool.query("SELECT * FROM messages ORDER BY id DESC");

    res.render("admin", {
      users: usersResult.rows,
      pg: pgResult.rows,
      messages: messagesResult.rows,
      user: req.session.user
    });
  } catch (error) {
    console.log("ADMIN ERROR:", error);
    res.send("Error loading admin dashboard");
  }
});

/* -------------------- USERS -------------------- */

app.get("/users", admin, async (req, res) => {
  try {
    const usersResult = await pool.query("SELECT * FROM users ORDER BY id DESC");

    res.render("users", {
      users: usersResult.rows,
      user: req.session.user
    });
  } catch (error) {
    console.log("USERS ERROR:", error);
    res.send("Error loading users");
  }
});

app.get("/approve-list", admin, async (req, res) => {
  try {
    const usersResult = await pool.query(
      "SELECT * FROM users WHERE approved=0 ORDER BY id DESC"
    );

    res.render("approve", {
      users: usersResult.rows,
      user: req.session.user
    });
  } catch (error) {
    console.log("APPROVE LIST ERROR:", error);
    res.send("Error loading approve list");
  }
});

app.get("/approve/:id", admin, async (req, res) => {
  try {
    await pool.query(
      "UPDATE users SET approved=1 WHERE id=$1",
      [req.params.id]
    );
    res.redirect("/approve-list");
  } catch (error) {
    console.log("APPROVE USER ERROR:", error);
    res.send("Error approving user");
  }
});

/* -------------------- ADD PG -------------------- */

app.get("/addpg", admin, (req, res) => {
  res.render("addpg", {
    user: req.session.user
  });
});

app.post("/addpg", admin, upload.array("images", 10), async (req, res) => {
  try {
    const {
      title,
      price,
      location,
      description,
      whatsapp,
      map,
      single_rooms,
      twin_rooms,
      triple_rooms,
      twin_price,
      triple_price
    } = req.body;

    if (!title || !price || !location || !description) {
      return res.send("Please fill all required PG details");
    }

    const result = await pool.query(
      `INSERT INTO pg(
        title,
        price,
        location,
        description,
        whatsapp,
        map,
        single_rooms,
        twin_rooms,
        triple_rooms,
        twin_price,
        triple_price
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id`,
      [
        title,
        price,
        location,
        description,
        whatsapp || "",
        map || "",
        Number(single_rooms) || 0,
        Number(twin_rooms) || 0,
        Number(triple_rooms) || 0,
        Number(twin_price) || 0,
        Number(triple_price) || 0
      ]
    );

    const pgId = result.rows[0].id;

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query(
          `INSERT INTO images(pg_id,image)
           VALUES($1,$2)`,
          [pgId, file.path]
        );
      }
    }

    res.redirect("/admin");
  } catch (error) {
    console.log("ADD PG ERROR:", error);
    res.send("Error while adding PG");
  }
});

app.get("/deletepg/:id", admin, async (req, res) => {
  try {
    const pgId = req.params.id;

    const imagesResult = await pool.query(
      "SELECT * FROM images WHERE pg_id=$1",
      [pgId]
    );

    const images = imagesResult.rows;

    for (const img of images) {
      const imgPath = path.join(uploadDir, img.image);
      if (fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath);
      }
    }

    await pool.query("DELETE FROM images WHERE pg_id=$1", [pgId]);
    await pool.query("DELETE FROM ratings WHERE pg_id=$1", [pgId]);
    await pool.query("DELETE FROM bookings WHERE pg_id=$1", [pgId]);
    await pool.query("DELETE FROM pg WHERE id=$1", [pgId]);

    res.redirect("/admin");
  } catch (error) {
    console.log("DELETE PG ERROR:", error);
    res.send("Error deleting PG");
  }
});

/* -------------------- PG DETAILS -------------------- */

app.get("/pg/:id", async (req, res) => {
  try {
    const pgResult = await pool.query(
      "SELECT * FROM pg WHERE id=$1",
      [req.params.id]
    );

    const pg = pgResult.rows[0];

    if (!pg) {
      return res.send("PG not found");
    }

    const imagesResult = await pool.query(
      "SELECT * FROM images WHERE pg_id=$1 ORDER BY id ASC",
      [req.params.id]
    );

    const ratingsResult = await pool.query(
      "SELECT * FROM ratings WHERE pg_id=$1 ORDER BY id DESC",
      [req.params.id]
    );

    res.render("pg", {
      pg,
      images: imagesResult.rows,
      ratings: ratingsResult.rows,
      user: req.session.user
    });
  } catch (error) {
    console.log("PG VIEW ERROR:", error);
    res.send("Error loading PG page");
  }
});

/* -------------------- BOOKINGS -------------------- */

app.get("/book/:id", auth, async (req, res) => {
  try {
    const pgResult = await pool.query(
      "SELECT * FROM pg WHERE id=$1",
      [req.params.id]
    );

    const pg = pgResult.rows[0];

    if (!pg) {
      return res.send("PG not found");
    }

    const roommatesResult = await pool.query(
      `SELECT u.id, u.name, u.email
       FROM roommate_requests rr
       JOIN users u ON u.id = rr.sender_id OR u.id = rr.receiver_id
       WHERE rr.status = 'accepted'
         AND (rr.sender_id = $1 OR rr.receiver_id = $1)
         AND u.id != $1`,
      [req.session.user.id]
    );

    res.render("booking-form", {
      pg,
      user: req.session.user,
      roommates: roommatesResult.rows
    });
  } catch (error) {
    console.log("BOOK PAGE ERROR:", error);
    res.send("Error loading booking form");
  }
});

app.post("/book/:id", auth, async (req, res) => {
  try {
    const pgResult = await pool.query(
      "SELECT * FROM pg WHERE id=$1",
      [req.params.id]
    );

    const pg = pgResult.rows[0];

    if (!pg) {
      return res.send("PG not found");
    }

    const { full_name, phone, age, entry_date, notes, booking_type, roommate_user_id } = req.body;

    if (!full_name || !phone || !age || !entry_date) {
      return res.send("Please fill all booking details");
    }

   await pool.query(
  `INSERT INTO bookings(user_id,pg_id,full_name,phone,age,entry_date,notes,status,roommate_user_id,booking_type)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [
    req.session.user.id,
    req.params.id,
    full_name,
    phone,
    age,
    entry_date,
    notes || "",
    "pending",
    booking_type === "roommate" && roommate_user_id ? roommate_user_id : null,
    booking_type || "solo"
  ]
);
    res.redirect("/payment");
  } catch (error) {
    console.log("BOOKING SUBMIT ERROR:", error);
    res.send("Error submitting booking");
  }
});

app.get("/bookings", admin, async (req, res) => {
  try {
    const bookingsResult = await pool.query(`
  SELECT bookings.*, 
         pg.title AS pg_title,
         u2.name AS roommate_name
  FROM bookings
  LEFT JOIN pg ON bookings.pg_id = pg.id
  LEFT JOIN users u2 ON bookings.roommate_user_id = u2.id
  ORDER BY bookings.id DESC
`);

    res.render("bookings", {
      bookings: bookingsResult.rows,
      user: req.session.user
    });
  } catch (error) {
    console.log("BOOKINGS ERROR:", error);
    res.send("Error loading bookings");
  }
});

app.get("/approve-booking/:id", admin, async (req, res) => {
  try {
    await pool.query(
      "UPDATE bookings SET status='approved' WHERE id=$1",
      [req.params.id]
    );
    res.redirect("/bookings");
  } catch (error) {
    console.log("APPROVE BOOKING ERROR:", error);
    res.send("Error approving booking");
  }
});

app.get("/reject-booking/:id", admin, async (req, res) => {
  try {
    await pool.query(
      "UPDATE bookings SET status='rejected' WHERE id=$1",
      [req.params.id]
    );
    res.redirect("/bookings");
  } catch (error) {
    console.log("REJECT BOOKING ERROR:", error);
    res.send("Error rejecting booking");
  }
});

app.get("/my-bookings", auth, async (req, res) => {
  try {
    const bookingsResult = await pool.query(`
      SELECT bookings.*, 
             pg.title AS pg_title,
             pg.location AS pg_location,
             pg.price AS pg_price
      FROM bookings
      LEFT JOIN pg ON bookings.pg_id = pg.id
      WHERE bookings.user_id = $1
      ORDER BY bookings.id DESC
    `, [req.session.user.id]);

    res.render("my-bookings", {
      bookings: bookingsResult.rows,
      user: req.session.user
    });
  } catch (error) {
    console.log("MY BOOKINGS ERROR:", error);
    res.send("Error loading my bookings");
  }
});
/* -------------------- NEGOTIATIONS -------------------- */

app.post("/negotiate/:pgId", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const pgId = req.params.pgId;
    const userId = req.session.user.id;
    const offeredPrice = parseInt(req.body.offered_price, 10);
    const message = req.body.message || "";

    if (!offeredPrice || offeredPrice <= 0) {
      return res.send("Invalid offer price");
    }

    await pool.query(
      `INSERT INTO negotiations (user_id, pg_id, offered_price, message, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, pgId, offeredPrice, message, "pending"]
    );

    res.redirect("/my-negotiations");
  } catch (error) {
    console.log("NEGOTIATION SUBMIT ERROR:", error);
    res.send("Error sending offer");
  }
});

app.get("/my-negotiations", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const result = await pool.query(
      `SELECT n.*, p.title AS pg_title, p.price AS original_price
       FROM negotiations n
       JOIN pg p ON p.id = n.pg_id
       WHERE n.user_id = $1
       ORDER BY n.id DESC`,
      [req.session.user.id]
    );

    res.render("my-negotiations", {
      user: req.session.user,
      negotiations: result.rows
    });
  } catch (error) {
    console.log("MY NEGOTIATIONS ERROR:", error);
    res.send("Error loading negotiations");
  }
});

app.get("/admin-negotiations", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== "admin") {
      return res.redirect("/login");
    }

    const result = await pool.query(
      `SELECT n.*, u.name AS user_name, u.email, p.title AS pg_title, p.price AS original_price
       FROM negotiations n
       JOIN users u ON u.id = n.user_id
       JOIN pg p ON p.id = n.pg_id
       ORDER BY n.id DESC`
    );

    res.render("admin-negotiations", {
      user: req.session.user,
      negotiations: result.rows
    });
  } catch (error) {
    console.log("ADMIN NEGOTIATIONS ERROR:", error);
    res.send("Error loading admin negotiations");
  }
});

app.get("/accept-negotiation/:id", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== "admin") {
      return res.redirect("/login");
    }

    await pool.query(
      `UPDATE negotiations
       SET status = 'accepted'
       WHERE id = $1`,
      [req.params.id]
    );

    res.redirect("/admin-negotiations");
  } catch (error) {
    console.log("ACCEPT NEGOTIATION ERROR:", error);
    res.send("Error accepting negotiation");
  }
});

app.get("/reject-negotiation/:id", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== "admin") {
      return res.redirect("/login");
    }

    await pool.query(
      `UPDATE negotiations
       SET status = 'rejected'
       WHERE id = $1`,
      [req.params.id]
    );

    res.redirect("/admin-negotiations");
  } catch (error) {
    console.log("REJECT NEGOTIATION ERROR:", error);
    res.send("Error rejecting negotiation");
  }
});

app.post("/counter-negotiation/:id", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.role !== "admin") {
      return res.redirect("/login");
    }

    const counterPrice = parseInt(req.body.counter_price, 10);

    if (!counterPrice || counterPrice <= 0) {
      return res.send("Invalid counter price");
    }

    const negotiationResult = await pool.query(
      "SELECT * FROM negotiations WHERE id = $1",
      [req.params.id]
    );

    const negotiation = negotiationResult.rows[0];

    if (!negotiation) {
      return res.send("Negotiation not found");
    }

    await pool.query(
      `UPDATE negotiations
       SET status = 'countered',
           counter_price = $1
       WHERE id = $2`,
      [counterPrice, req.params.id]
    );

    // 🔥 IMPORTANT: notification insert
    await pool.query(
      `INSERT INTO notifications(text, user_id)
       VALUES($1, $2)`,
      [
        `Admin sent you a counter offer of ₹${counterPrice}`,
        negotiation.user_id
      ]
    );

    res.redirect("/admin-negotiations");

  } catch (error) {
    console.log("COUNTER NEGOTIATION ERROR:", error);
    res.send("Error sending counter offer");
  }
});
/* -------------------- ROOMMATE MATCHING -------------------- */

app.get("/roommate-profile", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM user_preferences WHERE user_id = $1",
      [req.session.user.id]
    );

    res.render("roommate-profile", {
      user: req.session.user,
      pref: result.rows[0] || null
    });
  } catch (error) {
    console.log("ROOMMATE PROFILE PAGE ERROR:", error);
    res.send("Error loading roommate profile");
  }
});

app.post("/roommate-profile", auth, async (req, res) => {
  try {
    const { budget, smoking, sleep_time, occupation } = req.body;

    await pool.query(
      `INSERT INTO user_preferences (user_id, budget, smoking, sleep_time, occupation)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET
         budget = EXCLUDED.budget,
         smoking = EXCLUDED.smoking,
         sleep_time = EXCLUDED.sleep_time,
         occupation = EXCLUDED.occupation`,
      [
        req.session.user.id,
        budget || "",
        smoking || "",
        sleep_time || "",
        occupation || ""
      ]
    );

    res.redirect("/roommate-matches");
  } catch (error) {
    console.log("ROOMMATE PROFILE SAVE ERROR:", error);
    res.send("Error saving roommate profile");
  }
});

/* -------- MY SENT REQUESTS -------- */
app.get("/roommate-requests", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
          rr.id,
          rr.status,
          rr.sender_id,
          rr.receiver_id,
          u.id AS user_id,
          u.name,
          u.email,
          u.phone
       FROM roommate_requests rr
       JOIN users u ON u.id = rr.receiver_id
       WHERE rr.sender_id = $1
       ORDER BY rr.id DESC`,
      [req.session.user.id]
    );

    res.render("roommate-requests", {
      requests: result.rows,
      user: req.session.user
    });
  } catch (error) {
    console.log("ROOMMATE REQUESTS PAGE ERROR:", error);
    res.send("Error loading roommate requests");
  }
});

/* -------- RECEIVED REQUESTS -------- */
app.get("/received-roommate-requests", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
          rr.id,
          rr.status,
          rr.sender_id,
          rr.receiver_id,
          u.id AS user_id,
          u.name,
          u.email,
          u.phone
       FROM roommate_requests rr
       JOIN users u ON u.id = rr.sender_id
       WHERE rr.receiver_id = $1
       ORDER BY rr.id DESC`,
      [req.session.user.id]
    );

    res.render("received-roommate-requests", {
      requests: result.rows,
      user: req.session.user
    });
  } catch (error) {
    console.log("RECEIVED ROOMMATE REQUEST ERROR:", error);
    res.send("Error loading received roommate requests");
  }
});

app.get("/accept-roommate/:id", auth, async (req, res) => {
  try {
    const requestResult = await pool.query(
      "SELECT * FROM roommate_requests WHERE id = $1",
      [req.params.id]
    );

    const requestRow = requestResult.rows[0];

    if (!requestRow) {
      return res.send("Request not found");
    }

    if (requestRow.receiver_id !== req.session.user.id) {
      return res.send("Unauthorized action");
    }

    await pool.query(
      "UPDATE roommate_requests SET status = 'accepted' WHERE id = $1",
      [req.params.id]
    );

    res.redirect("/received-roommate-requests");
  } catch (error) {
    console.log("ACCEPT ROOMMATE ERROR:", error);
    res.send("Error accepting roommate request");
  }
});

app.get("/reject-roommate/:id", auth, async (req, res) => {
  try {
    const requestResult = await pool.query(
      "SELECT * FROM roommate_requests WHERE id = $1",
      [req.params.id]
    );

    const requestRow = requestResult.rows[0];

    if (!requestRow) {
      return res.send("Request not found");
    }

    if (requestRow.receiver_id !== req.session.user.id) {
      return res.send("Unauthorized action");
    }

    await pool.query(
      "UPDATE roommate_requests SET status = 'rejected' WHERE id = $1",
      [req.params.id]
    );

    res.redirect("/received-roommate-requests");
  } catch (error) {
    console.log("REJECT ROOMMATE ERROR:", error);
    res.send("Error rejecting roommate request");
  }
});

app.post("/send-roommate-request/:receiverId", auth, async (req, res) => {
  try {
    const senderId = Number(req.session.user.id);
    const receiverId = Number(req.params.receiverId);

    if (!receiverId || !senderId || senderId === receiverId) {
      return res.send("Invalid roommate request");
    }

    const receiverResult = await pool.query(
      "SELECT id, name, email FROM users WHERE id = $1 AND approved = 1",
      [receiverId]
    );

    if (receiverResult.rows.length === 0) {
      return res.send("Receiver not found");
    }

    const existingResult = await pool.query(
      `SELECT * FROM roommate_requests
       WHERE sender_id = $1 AND receiver_id = $2`,
      [senderId, receiverId]
    );

    if (existingResult.rows.length > 0) {
      return res.redirect("/roommate-requests");
    }

    await pool.query(
      `INSERT INTO roommate_requests (sender_id, receiver_id, status)
       VALUES ($1, $2, $3)`,
      [senderId, receiverId, "pending"]
    );

    res.redirect("/roommate-requests");
  } catch (error) {
    console.log("SEND ROOMMATE REQUEST ERROR:", error);
    res.send("Error sending roommate request");
  }
});

app.get("/roommate-matches", auth, async (req, res) => {
  try {
    const myPrefResult = await pool.query(
      "SELECT * FROM user_preferences WHERE user_id = $1",
      [req.session.user.id]
    );

    const myPref = myPrefResult.rows[0];

    if (!myPref) {
      return res.redirect("/roommate-profile");
    }

    const usersResult = await pool.query(
      `SELECT
          u.id AS user_id,
          u.name,
          u.email,
          u.phone,
          p.budget,
          p.smoking,
          p.sleep_time,
          p.occupation,
          rr.status AS request_status
       FROM users u
       JOIN user_preferences p ON p.user_id = u.id
       LEFT JOIN roommate_requests rr
         ON rr.receiver_id = u.id AND rr.sender_id = $1
       WHERE u.id != $1
         AND u.approved = 1
       ORDER BY u.id DESC`,
      [req.session.user.id]
    );

    const matches = usersResult.rows
      .map(item => {
        let score = 0;

        if (myPref.budget && item.budget && myPref.budget === item.budget) score += 30;
        if (myPref.smoking && item.smoking && myPref.smoking === item.smoking) score += 25;
        if (myPref.sleep_time && item.sleep_time && myPref.sleep_time === item.sleep_time) score += 25;
        if (myPref.occupation && item.occupation && myPref.occupation === item.occupation) score += 20;

        return {
          ...item,
          match_score: score
        };
      })
      .sort((a, b) => b.match_score - a.match_score);

    res.render("roommate-matches", {
      user: req.session.user,
      myPref,
      matches
    });
  } catch (error) {
    console.log("ROOMMATE MATCH ERROR:", error);
    res.send("Error loading roommate matches");
  }
});
/* -------------------- PAYMENT -------------------- */

app.get("/payment", auth, async (req, res) => {
  try {
    const settingResult = await pool.query(
      "SELECT * FROM settings WHERE id=1"
    );

    res.render("payment", {
      user: req.session.user,
      setting: settingResult.rows[0]
    });
  } catch (error) {
    console.log("PAYMENT PAGE ERROR:", error);
    res.send("Error loading payment page");
  }
});

app.get("/payment-settings", admin, async (req, res) => {
  try {
    const settingResult = await pool.query(
      "SELECT * FROM settings WHERE id=1"
    );

    res.render("payment-settings", {
      user: req.session.user,
      setting: settingResult.rows[0]
    });
  } catch (error) {
    console.log("PAYMENT SETTINGS PAGE ERROR:", error);
    res.send("Error loading payment settings");
  }
});

app.post("/payment-settings", admin, upload.single("qr_image"), async (req, res) => {
  try {
    const currentResult = await pool.query(
      "SELECT * FROM settings WHERE id=1"
    );

    const current = currentResult.rows[0];
    let qrImage = current ? current.qr_image : "";

    if (req.file) {
      qrImage = req.file.path;
    }

    await pool.query(
      `UPDATE settings
       SET upi=$1, qr_image=$2
       WHERE id=1`,
      [req.body.upi, qrImage]
    );

    res.redirect("/payment-settings");
  } catch (error) {
    console.log("PAYMENT SETTINGS UPDATE ERROR:", error);
    res.send("Error updating payment settings");
  }
});

/* -------------------- RATINGS -------------------- */

app.post("/rate/:id", auth, async (req, res) => {
  try {
    const pgId = req.params.id;
    const rating = req.body.rating;

    if (!rating) {
      return res.send("Please select a rating");
    }

    await pool.query(
      `INSERT INTO ratings(user_id, pg_id, rating, comment)
       VALUES($1,$2,$3,$4)`,
      [req.session.user.id, pgId, rating, ""]
    );

    res.redirect("/pg/" + pgId);
  } catch (error) {
    console.log("RATING ERROR:", error);
    res.send("Error while submitting rating");
  }
});

/* -------------------- MESSAGES -------------------- */

app.post("/message", auth, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.send("Message cannot be empty");
    }

    await pool.query(
      `INSERT INTO messages(user_id,message)
       VALUES($1,$2)`,
      [req.session.user.id, message]
    );

    res.redirect("/");
  } catch (error) {
    console.log("MESSAGE ERROR:", error);
    res.send("Error sending message");
  }
});

app.get("/messages", admin, async (req, res) => {
  try {
    const messagesResult = await pool.query(
      "SELECT * FROM messages ORDER BY id DESC"
    );

    res.render("messages", {
      messages: messagesResult.rows,
      user: req.session.user
    });
  } catch (error) {
    console.log("MESSAGES PAGE ERROR:", error);
    res.send("Error loading messages");
  }
});

/* -------------------- NOTIFICATIONS -------------------- */

app.post("/notify", admin, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.send("Notification text cannot be empty");
    }

    await pool.query(
      `INSERT INTO notifications(text)
       VALUES($1)`,
      [text]
    );

    res.redirect("/admin");
  } catch (error) {
    console.log("NOTIFY ERROR:", error);
    res.send("Error sending notification");
  }
});

/* -------------------- ABOUT -------------------- */

app.get("/about", (req, res) => {
  res.render("about", {
    user: req.session.user
  });
});

/* -------------------- SERVER -------------------- */

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Server running on port " + PORT);
    });
  })
  .catch((err) => {
    console.error("DB INIT ERROR:", err);
  });