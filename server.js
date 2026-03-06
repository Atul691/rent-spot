require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("./database");

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

app.get("/", (req, res) => {
  const pgList = db.prepare("SELECT * FROM pg ORDER BY id DESC").all();
  const notes = db.prepare("SELECT * FROM notifications ORDER BY id DESC").all();

  const pg = pgList.map((item) => {
    const firstImage = db.prepare("SELECT * FROM images WHERE pg_id=? ORDER BY id ASC LIMIT 1").get(item.id);
    return {
      ...item,
      firstImage: firstImage ? firstImage.image : null
    };
  });

  res.render("home", {
    pg,
    notes,
    user: req.session.user
  });
});
/* -------------------- LOGIN / REGISTER -------------------- */

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.send("Please fill all fields");
  }

  const existing = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (existing) {
    return res.send("Email already registered");
  }

  const hash = await bcrypt.hash(password, 10);

  db.prepare(`
    INSERT INTO users(name,email,password)
    VALUES(?,?,?)
  `).run(name, email, hash);

  res.redirect("/login");
});

app.post("/login", async (req, res) => {
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

  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);

  if (!user) {
    return res.send("User not found");
  }

  const ok = await bcrypt.compare(password, user.password);

  if (!ok) {
    return res.send("Wrong password");
  }

  if (user.approved === 0) {
    return res.send("Admin approval pending");
  }

  req.session.user = user;
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

/* -------------------- ADMIN DASHBOARD -------------------- */

app.get("/admin", admin, (req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY id DESC").all();
  const pg = db.prepare("SELECT * FROM pg ORDER BY id DESC").all();
  const messages = db.prepare("SELECT * FROM messages ORDER BY id DESC").all();

  res.render("admin", {
    users,
    pg,
    messages,
    user: req.session.user
  });
});

/* -------------------- USERS -------------------- */

app.get("/users", admin, (req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY id DESC").all();

  res.render("users", {
    users,
    user: req.session.user
  });
});

app.get("/approve-list", admin, (req, res) => {
  const users = db.prepare("SELECT * FROM users WHERE approved=0 ORDER BY id DESC").all();

  res.render("approve", {
    users,
    user: req.session.user
  });
});

app.get("/approve/:id", admin, (req, res) => {
  db.prepare("UPDATE users SET approved=1 WHERE id=?").run(req.params.id);
  res.redirect("/approve-list");
});

/* -------------------- ADD PG -------------------- */

app.get("/addpg", admin, (req, res) => {
  res.render("addpg", {
    user: req.session.user
  });
});

app.post("/addpg", admin, upload.array("images", 10), (req, res) => {
  try {
    const { title, price, location, description, whatsapp, map } = req.body;

    if (!title || !price || !location || !description) {
      return res.send("Please fill all required PG details");
    }

    const result = db.prepare(`
      INSERT INTO pg(title,price,location,description,whatsapp,map)
      VALUES(?,?,?,?,?,?)
    `).run(
      title,
      price,
      location,
      description,
      whatsapp || "",
      map || ""
    );

    const pgId = result.lastInsertRowid;

    console.log("FILES RECEIVED:", req.files);

    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        db.prepare(`
          INSERT INTO images(pg_id,image)
          VALUES(?,?)
        `).run(pgId, file.filename);
      });
    }

    res.redirect("/admin");
  } catch (error) {
    console.log("ADD PG ERROR:", error);
    res.send("Error while adding PG");
  }
});

app.get("/deletepg/:id", admin, (req, res) => {
  const pgId = req.params.id;

  const images = db.prepare("SELECT * FROM images WHERE pg_id=?").all(pgId);

  images.forEach((img) => {
    const imgPath = path.join(uploadDir, img.image);
    if (fs.existsSync(imgPath)) {
      fs.unlinkSync(imgPath);
    }
  });

  db.prepare("DELETE FROM images WHERE pg_id=?").run(pgId);
  db.prepare("DELETE FROM ratings WHERE pg_id=?").run(pgId);
  db.prepare("DELETE FROM bookings WHERE pg_id=?").run(pgId);
  db.prepare("DELETE FROM pg WHERE id=?").run(pgId);

  res.redirect("/admin");
});


/* PG VIEW PAGE */
app.get("/pg/:id", (req, res) => {
  try {
    const pg = db.prepare("SELECT * FROM pg WHERE id=?").get(req.params.id);

    if (!pg) {
      return res.send("PG not found");
    }

    const images = db.prepare("SELECT * FROM images WHERE pg_id=? ORDER BY id DESC").all(req.params.id);
    const ratings = db.prepare("SELECT * FROM ratings WHERE pg_id=? ORDER BY id DESC").all(req.params.id);

    res.render("pg", {
      pg,
      images,
      ratings,
      user: req.session.user
    });

  } catch (error) {
    console.log("PG VIEW ERROR:", error);
    res.send("Error loading PG page");
  }
});


/* -------------------- PG DETAILS -------------------- */

app.get("/pg/:id", (req, res) => {
  try {
    const pg = db.prepare("SELECT * FROM pg WHERE id=?").get(req.params.id);

    if (!pg) {
      return res.send("PG not found");
    }

    const images = db.prepare("SELECT * FROM images WHERE pg_id=? ORDER BY id ASC").all(req.params.id);
    const ratings = db.prepare("SELECT * FROM ratings WHERE pg_id=? ORDER BY id DESC").all(req.params.id);

    res.render("pg", {
      pg,
      images,
      ratings,
      user: req.session.user
    });
  } catch (error) {
    console.log("PG VIEW ERROR:", error);
    res.send("Error loading PG page");
  }
});

/* -------------------- BOOKINGS -------------------- */

app.get("/book/:id", auth, (req, res) => {
  const pg = db.prepare("SELECT * FROM pg WHERE id=?").get(req.params.id);

  if (!pg) {
    return res.send("PG not found");
  }

  res.render("booking-form", {
    pg,
    user: req.session.user
  });
});

app.post("/book/:id", auth, (req, res) => {
  const pg = db.prepare("SELECT * FROM pg WHERE id=?").get(req.params.id);

  if (!pg) {
    return res.send("PG not found");
  }

  const { full_name, phone, age, entry_date, notes } = req.body;

  if (!full_name || !phone || !age || !entry_date) {
    return res.send("Please fill all booking details");
  }

  db.prepare(`
    INSERT INTO bookings(user_id,pg_id,full_name,phone,age,entry_date,notes,status)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(
    req.session.user.id,
    req.params.id,
    full_name,
    phone,
    age,
    entry_date,
    notes || "",
    "pending"
  );

  res.redirect("/payment");
});

app.get("/bookings", admin, (req, res) => {
  const bookings = db.prepare("SELECT * FROM bookings ORDER BY id DESC").all();

  res.render("bookings", {
    bookings,
    user: req.session.user
  });
});

/* -------------------- PAYMENT -------------------- */

app.get("/payment", auth, (req, res) => {
  const setting = db.prepare("SELECT * FROM settings WHERE id=1").get();

  res.render("payment", {
    user: req.session.user,
    setting
  });
});

app.get("/payment-settings", admin, (req, res) => {
  const setting = db.prepare("SELECT * FROM settings WHERE id=1").get();

  res.render("payment-settings", {
    user: req.session.user,
    setting
  });
});

app.post("/payment-settings", admin, upload.single("qr_image"), (req, res) => {
  const current = db.prepare("SELECT * FROM settings WHERE id=1").get();

  let qrImage = current ? current.qr_image : "";

  if (req.file) {
    qrImage = req.file.filename;
  }

  db.prepare(`
    UPDATE settings
    SET upi=?, qr_image=?
    WHERE id=1
  `).run(req.body.upi, qrImage);

  res.redirect("/payment-settings");
});

/* -------------------- RATINGS -------------------- */

app.post("/rate/:id", auth, (req, res) => {
  try {
    const pgId = req.params.id;
    const rating = req.body.rating;

    if (!rating) {
      return res.send("Please select a rating");
    }

    db.prepare(`
      INSERT INTO ratings(user_id, pg_id, rating, comment)
      VALUES(?,?,?,?)
    `).run(
      req.session.user.id,
      pgId,
      rating,
      ""
    );

    res.redirect("/pg/" + pgId);
  } catch (error) {
    console.log("RATING ERROR:", error);
    res.send("Error while submitting rating");
  }
});

/* -------------------- MESSAGES -------------------- */

app.post("/message", auth, (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.send("Message cannot be empty");
  }

  db.prepare(`
    INSERT INTO messages(user_id,message)
    VALUES(?,?)
  `).run(req.session.user.id, message);

  res.redirect("/");
});

app.get("/messages", admin, (req, res) => {
  const messages = db.prepare("SELECT * FROM messages ORDER BY id DESC").all();

  res.render("messages", {
    messages,
    user: req.session.user
  });
});

/* -------------------- NOTIFICATIONS -------------------- */

app.post("/notify", admin, (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.send("Notification text cannot be empty");
  }

  db.prepare(`
    INSERT INTO notifications(text)
    VALUES(?)
  `).run(text);

  res.redirect("/admin");
});

/* -------------------- ABOUT -------------------- */

app.get("/about", (req, res) => {
  res.render("about", {
    user: req.session.user
  });
});

/* -------------------- SERVER -------------------- */

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});