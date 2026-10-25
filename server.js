// Northfield Goods – REST API (Express + SQLite, data persists in store.db)
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const db = new Database(process.env.DB_FILE || "store.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/* ---------- Schema ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL,
  category TEXT NOT NULL, description TEXT, image TEXT);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id), name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS cart_items(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK(qty > 0), PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS orders(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  total REAL NOT NULL, address TEXT, city TEXT, postal_code TEXT, payment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, name TEXT NOT NULL, price REAL NOT NULL, qty INTEGER NOT NULL);
`);

/* ---------- Seed data (same as lab 3) ---------- */
if (!db.prepare("SELECT COUNT(*) c FROM products").get().c) {
  const P = [
    ["Stoneware Mug Set", 34, "Kitchen", "Set of four hand-glazed mugs, dishwasher safe."],
    ["Linen Throw Blanket", 68, "Living", "Stonewashed linen, soft from the first night."],
    ["Oak Serving Board", 42, "Kitchen", "Solid oak with a hand-rubbed oil finish."],
    ["Soy Candle, Cedar", 24, "Living", "40-hour burn time in a reusable tin."],
    ["Ceramic Plant Pot", 29, "Garden", "Drainage hole and saucer included."],
    ["Cotton Bath Towels", 56, "Bath", "Two heavyweight towels in natural white."],
    ["Brass Desk Lamp", 89, "Living", "Adjustable arm with warm dimmable light."],
    ["Herb Garden Kit", 31, "Garden", "Basil, thyme and parsley with pots and soil."],
  ];
  const ip = db.prepare("INSERT INTO products(name,price,category,description,image) VALUES(?,?,?,?,?)");
  P.forEach((p, i) => ip.run(...p, `https://picsum.photos/seed/shop${i + 1}/600/440`));
  const ir = db.prepare("INSERT INTO reviews(product_id,name,rating,text) VALUES(?,?,?,?)");
  [[1,"Amina K.",5,"Sturdy, beautiful and they keep coffee hot."],
   [2,"Daniel R.",5,"Gets softer with every wash. Love it."],
   [7,"Sara M.",4,"Great light, arm could be a little stiffer."],
   [4,"Omar H.",5,"The cedar scent fills the room without being heavy."]].forEach(r => ir.run(...r));
}

/* ---------- App + helpers ---------- */
const app = express();
app.use(cors());
app.use(express.json());

const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const sign = u => jwt.sign({ id: u.id, name: u.name, email: u.email }, SECRET, { expiresIn: "7d" });

function readToken(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return jwt.verify(h.slice(7), SECRET); } catch { return null; }
}
function auth(req, res, next) {
  const u = readToken(req);
  if (!u) return bad(res, "Authentication required", 401);
  req.user = u; next();
}

/* ================= AUTH ================= */
// POST /api/auth/signup  {name, email, password}
app.post("/api/auth/signup", wrap((req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!name || !emailOk(email)) return bad(res, "Valid name and email are required");
  if (password.length < 6) return bad(res, "Password must be at least 6 characters");
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email))
    return bad(res, "That email is already registered", 409);
  const info = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)")
    .run(name, email, bcrypt.hashSync(password, 10));
  const user = { id: info.lastInsertRowid, name, email };
  res.status(201).json({ user, token: sign(user) });
}));

// POST /api/auth/login  {email, password}
app.post("/api/auth/login", wrap((req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ""), u.password_hash))
    return bad(res, "Email or password is incorrect", 401);
  const user = { id: u.id, name: u.name, email: u.email };
  res.json({ user, token: sign(user) });
}));

// GET /api/auth/me  (current user from token)
app.get("/api/auth/me", auth, wrap((req, res) => {
  const u = db.prepare("SELECT id,name,email,created_at FROM users WHERE id=?").get(req.user.id);
  if (!u) return bad(res, "User not found", 404);
  res.json(u);
}));

/* ================= PRODUCTS ================= */
// GET /api/products?category=Kitchen
app.get("/api/products", wrap((req, res) => {
  const base = `SELECT p.*, COALESCE(ROUND(AVG(r.rating)),0) AS avg_rating, COUNT(r.id) AS review_count
                FROM products p LEFT JOIN reviews r ON r.product_id=p.id`;
  const rows = req.query.category
    ? db.prepare(base + " WHERE p.category=? GROUP BY p.id").all(req.query.category)
    : db.prepare(base + " GROUP BY p.id").all();
  res.json(rows);
}));

// GET /api/categories
app.get("/api/categories", wrap((_req, res) => {
  res.json(db.prepare("SELECT DISTINCT category FROM products ORDER BY category").all().map(r => r.category));
}));

// GET /api/products/:id
app.get("/api/products/:id", wrap((req, res) => {
  const p = db.prepare(`SELECT p.*, COALESCE(ROUND(AVG(r.rating)),0) AS avg_rating, COUNT(r.id) AS review_count
    FROM products p LEFT JOIN reviews r ON r.product_id=p.id WHERE p.id=? GROUP BY p.id`).get(req.params.id);
  if (!p) return bad(res, "Product not found", 404);
  res.json(p);
}));

/* ================= REVIEWS ================= */
// GET /api/reviews?limit=4   (latest reviews across the store)
app.get("/api/reviews", wrap((req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  res.json(db.prepare(`SELECT r.*, p.name AS product_name FROM reviews r
    JOIN products p ON p.id=r.product_id ORDER BY r.id DESC LIMIT ?`).all(limit));
}));

// GET /api/products/:id/reviews
app.get("/api/products/:id/reviews", wrap((req, res) => {
  if (!db.prepare("SELECT 1 FROM products WHERE id=?").get(req.params.id)) return bad(res, "Product not found", 404);
  res.json(db.prepare("SELECT * FROM reviews WHERE product_id=? ORDER BY id DESC").all(req.params.id));
}));

// POST /api/products/:id/reviews  {name, rating, text}  (token optional)
app.post("/api/products/:id/reviews", wrap((req, res) => {
  if (!db.prepare("SELECT 1 FROM products WHERE id=?").get(req.params.id)) return bad(res, "Product not found", 404);
  const user = readToken(req);
  const name = String(req.body.name || user?.name || "").trim();
  const rating = parseInt(req.body.rating);
  const text = String(req.body.text || "").trim();
  if (!name || !text) return bad(res, "Name and review text are required");
  if (!(rating >= 1 && rating <= 5)) return bad(res, "Rating must be 1-5");
  const info = db.prepare("INSERT INTO reviews(product_id,user_id,name,rating,text) VALUES(?,?,?,?,?)")
    .run(req.params.id, user?.id ?? null, name, rating, text);
  res.status(201).json(db.prepare("SELECT * FROM reviews WHERE id=?").get(info.lastInsertRowid));
}));

// DELETE /api/reviews/:id  (only the author)
app.delete("/api/reviews/:id", auth, wrap((req, res) => {
  const r = db.prepare("SELECT * FROM reviews WHERE id=?").get(req.params.id);
  if (!r) return bad(res, "Review not found", 404);
  if (r.user_id !== req.user.id) return bad(res, "You can only delete your own reviews", 403);
  db.prepare("DELETE FROM reviews WHERE id=?").run(r.id);
  res.status(204).end();
}));

/* ================= CART (per logged-in user) ================= */
function cartOf(uid) {
  const items = db.prepare(`SELECT c.product_id, p.name, p.price, p.image, c.qty, ROUND(p.price*c.qty,2) AS line_total
    FROM cart_items c JOIN products p ON p.id=c.product_id WHERE c.user_id=? ORDER BY p.id`).all(uid);
  return { items, subtotal: +items.reduce((s, i) => s + i.line_total, 0).toFixed(2) };
}

// GET /api/cart
app.get("/api/cart", auth, wrap((req, res) => res.json(cartOf(req.user.id))));

// POST /api/cart/items  {productId, qty=1}  (adds to existing qty)
app.post("/api/cart/items", auth, wrap((req, res) => {
  const pid = parseInt(req.body.productId), qty = parseInt(req.body.qty ?? 1);
  if (!db.prepare("SELECT 1 FROM products WHERE id=?").get(pid)) return bad(res, "Product not found", 404);
  if (!(qty >= 1)) return bad(res, "qty must be a positive integer");
  db.prepare(`INSERT INTO cart_items(user_id,product_id,qty) VALUES(?,?,?)
    ON CONFLICT(user_id,product_id) DO UPDATE SET qty=qty+excluded.qty`).run(req.user.id, pid, qty);
  res.status(201).json(cartOf(req.user.id));
}));

// PATCH /api/cart/items/:productId  {qty}  (qty<1 removes the item)
app.patch("/api/cart/items/:productId", auth, wrap((req, res) => {
  const qty = parseInt(req.body.qty);
  if (Number.isNaN(qty)) return bad(res, "qty must be a number");
  const r = qty < 1
    ? db.prepare("DELETE FROM cart_items WHERE user_id=? AND product_id=?").run(req.user.id, req.params.productId)
    : db.prepare("UPDATE cart_items SET qty=? WHERE user_id=? AND product_id=?").run(qty, req.user.id, req.params.productId);
  if (!r.changes) return bad(res, "Item not in cart", 404);
  res.json(cartOf(req.user.id));
}));

// DELETE /api/cart/items/:productId
app.delete("/api/cart/items/:productId", auth, wrap((req, res) => {
  const r = db.prepare("DELETE FROM cart_items WHERE user_id=? AND product_id=?").run(req.user.id, req.params.productId);
  if (!r.changes) return bad(res, "Item not in cart", 404);
  res.json(cartOf(req.user.id));
}));

// DELETE /api/cart  (empty the cart)
app.delete("/api/cart", auth, wrap((req, res) => {
  db.prepare("DELETE FROM cart_items WHERE user_id=?").run(req.user.id);
  res.json(cartOf(req.user.id));
}));

/* ================= ORDERS / CHECKOUT ================= */
// POST /api/orders  {address, city, postalCode, payment}  -> turns the cart into an order
app.post("/api/orders", auth, wrap((req, res) => {
  const { address, city, postalCode, payment } = req.body;
  if (![address, city, postalCode].every(v => String(v || "").trim())) return bad(res, "Address, city and postal code are required");
  const method = payment || "Cash on delivery";
  if (!["Cash on delivery", "Card (demo, not charged)"].includes(method)) return bad(res, "Unsupported payment method");

  const place = db.transaction(() => {
    const cart = cartOf(req.user.id);
    if (!cart.items.length) return null;
    const id = "NG-" + Date.now().toString().slice(-6);
    db.prepare("INSERT INTO orders(id,user_id,total,address,city,postal_code,payment) VALUES(?,?,?,?,?,?,?)")
      .run(id, req.user.id, cart.subtotal, address.trim(), city.trim(), String(postalCode).trim(), method);
    const ii = db.prepare("INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)");
    cart.items.forEach(i => ii.run(id, i.product_id, i.name, i.price, i.qty));
    db.prepare("DELETE FROM cart_items WHERE user_id=?").run(req.user.id);
    return id;
  });
  const id = place();
  if (!id) return bad(res, "Your cart is empty");
  res.status(201).json(orderOf(id));
}));

function orderOf(id) {
  const o = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
  if (o) o.items = db.prepare("SELECT product_id,name,price,qty FROM order_items WHERE order_id=?").all(id);
  return o;
}

// GET /api/orders  (my order history)
app.get("/api/orders", auth, wrap((req, res) => {
  const ids = db.prepare("SELECT id FROM orders WHERE user_id=? ORDER BY created_at DESC, id DESC").all(req.user.id);
  res.json(ids.map(r => orderOf(r.id)));
}));

// GET /api/orders/:id
app.get("/api/orders/:id", auth, wrap((req, res) => {
  const o = orderOf(req.params.id);
  if (!o || o.user_id !== req.user.id) return bad(res, "Order not found", 404);
  res.json(o);
}));

/* ---------- Errors ---------- */
app.get("/api/health", (_q, r) => r.json({ status: "ok" }));
app.use((_req, res) => bad(res, "Endpoint not found", 404));
app.use((err, _req, res, _next) => { console.error(err); bad(res, "Internal server error", 500); });

if (require.main === module) app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
module.exports = app;
