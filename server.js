require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { pool, initDb } = require("./database");

const app = express();

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = Date.now() + "-" + file.originalname.replace(/\s+/g, "-");
    cb(null, safeName);
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
    const notesResult = await pool.query('SELECT * FROM notifications ORDER BY id DESC');

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
    const { name, email, password } = req.body;

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
      `INSERT INTO users(name,email,password)
       VALUES($1,$2,$3)`,
      [name, email, hash]
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
    const { title, price, location, description, whatsapp, map } = req.body;

    if (!title || !price || !location || !description) {
      return res.send("Please fill all required PG details");
    }

    const result = await pool.query(
      `INSERT INTO pg(title,price,location,description,whatsapp,map)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [title, price, location, description, whatsapp || "", map || ""]
    );

    const pgId = result.rows[0].id;

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query(
          `INSERT INTO images(pg_id,image)
           VALUES($1,$2)`,
          [pgId, file.filename]
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

    res.render("booking-form", {
      pg,
      user: req.session.user
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

    const { full_name, phone, age, entry_date, notes } = req.body;

    if (!full_name || !phone || !age || !entry_date) {
      return res.send("Please fill all booking details");
    }

    await pool.query(
      `INSERT INTO bookings(user_id,pg_id,full_name,phone,age,entry_date,notes,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        req.session.user.id,
        req.params.id,
        full_name,
        phone,
        age,
        entry_date,
        notes || "",
        "pending"
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
      SELECT bookings.*, pg.title AS pg_title
      FROM bookings
      LEFT JOIN pg ON bookings.pg_id = pg.id
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
      qrImage = req.file.filename;
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