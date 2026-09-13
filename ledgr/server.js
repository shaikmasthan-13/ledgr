/* ==========================================================================
   Ledgr Server
   A real backend: one SQLite database file on disk, one REST API, and the
   app's own front-end files served from the same address. Deploy this one
   project anywhere (or run it on a PC/Raspberry Pi at home) and every
   phone — the host's and every client's — talks to the SAME data, because
   they're all just visiting the same URL.
   ========================================================================== */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'ledgr.db');

const app = express();
app.use(express.json({ limit: '6mb' })); // profile photos are small base64 strings
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------------- Database setup --------------------------- */
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS host (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  photo TEXT
);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  unique_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  target INTEGER,
  photo TEXT,
  join_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('deposit','withdrawal')),
  amount INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_client_date ON transactions(client_id, date);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  details TEXT
);

CREATE TABLE IF NOT EXISTS pending_otp (
  client_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  amount INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

/* ------------------------------ Helpers -------------------------------- */
function newId(){ return crypto.randomBytes(9).toString('base64url'); }
function hashPassword(pw){
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored){
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}
function nextUniqueId(){
  const row = db.prepare(`SELECT COUNT(*) AS n FROM clients`).get();
  return 'CL' + String(row.n + 1).padStart(4, '0');
}
function logAudit(actor, action, details){
  db.prepare(`INSERT INTO audit_log (id, ts, actor, action, details) VALUES (?,?,?,?,?)`)
    .run(newId(), new Date().toISOString(), actor, action, details);
}
function clientBalance(clientId){
  const row = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type='deposit' THEN amount ELSE -amount END),0) AS bal
    FROM transactions WHERE client_id = ?`).get(clientId);
  return row.bal;
}
function hasDepositedThisMonth(clientId){
  const now = new Date();
  const ym = now.toISOString().slice(0,7); // 'YYYY-MM'
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM transactions
    WHERE client_id = ? AND type='deposit' AND substr(date,1,7) = ?`).get(clientId, ym);
  return row.n > 0;
}
function publicClient(row){
  return {
    id: row.id, uniqueId: row.unique_id, name: row.name, phone: row.phone,
    target: row.target, photo: row.photo, joinDate: row.join_date, status: row.status,
    balance: clientBalance(row.id), paidThisMonth: hasDepositedThisMonth(row.id)
  };
}

/* ------------------------------ Host routes ----------------------------- */
// Does a host account already exist? (drives setup-vs-login screen on the frontend)
app.get('/api/host/status', (req, res) => {
  const host = db.prepare(`SELECT name, phone, photo FROM host WHERE id = 1`).get();
  res.json({ exists: !!host, name: host?.name || null, phone: host?.phone || null, photo: host?.photo || null });
});

// One-time setup: password + confirmPassword must match; can't be redone once it exists.
app.post('/api/host/setup', (req, res) => {
  const existing = db.prepare(`SELECT id FROM host WHERE id = 1`).get();
  if (existing) return res.status(409).json({ error: 'Host account already exists. Please log in instead.' });
  const { password, confirmPassword, name, phone, photo } = req.body || {};
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  db.prepare(`INSERT INTO host (id, password_hash, name, phone, photo) VALUES (1, ?, ?, ?, ?)`)
    .run(hashPassword(password), name || null, phone || null, photo || null);
  logAudit('host', 'host_setup', 'Host account created');
  res.json({ ok: true });
});

app.post('/api/host/login', (req, res) => {
  const host = db.prepare(`SELECT password_hash FROM host WHERE id = 1`).get();
  if (!host) return res.status(404).json({ error: 'No host account yet — set one up first.' });
  const { password } = req.body || {};
  if (!password || !verifyPassword(password, host.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  logAudit('host', 'host_login', 'Host logged in');
  res.json({ ok: true });
});

app.post('/api/host/change-password', (req, res) => {
  const host = db.prepare(`SELECT password_hash FROM host WHERE id = 1`).get();
  if (!host) return res.status(404).json({ error: 'No host account yet.' });
  const { oldPassword, newPassword, confirmPassword } = req.body || {};
  if (!verifyPassword(oldPassword || '', host.password_hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters.' });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'New passwords do not match.' });
  db.prepare(`UPDATE host SET password_hash = ? WHERE id = 1`).run(hashPassword(newPassword));
  logAudit('host', 'host_password_changed', 'Host password changed');
  res.json({ ok: true });
});

app.put('/api/host/profile', (req, res) => {
  const { name, phone, photo } = req.body || {};
  const host = db.prepare(`SELECT id FROM host WHERE id = 1`).get();
  if (!host) return res.status(404).json({ error: 'No host account yet.' });
  db.prepare(`UPDATE host SET name = ?, phone = ?, photo = COALESCE(?, photo) WHERE id = 1`)
    .run(name || null, phone || null, photo || null);
  logAudit('host', 'host_profile_updated', 'Host updated their profile');
  res.json({ ok: true });
});

/* ----------------------------- Client routes ----------------------------- */
app.get('/api/clients', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT * FROM clients WHERE status != 'closed'
      AND (name LIKE ? OR unique_id LIKE ? OR phone LIKE ?)
      ORDER BY name COLLATE NOCASE`).all(like, like, like);
  } else {
    rows = db.prepare(`SELECT * FROM clients WHERE status != 'closed' ORDER BY name COLLATE NOCASE`).all();
  }
  res.json(rows.map(publicClient));
});

app.get('/api/clients/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Client not found.' });
  res.json(publicClient(row));
});

app.post('/api/clients', (req, res) => {
  const { name, phone, target, photo } = req.body || {};
  if (!name || !phone || phone.length < 6) return res.status(400).json({ error: 'Enter a name and a valid phone number.' });
  const client = { id: newId(), uniqueId: nextUniqueId(), name, phone, target: target || null, photo: photo || null, joinDate: new Date().toISOString().slice(0,10), status: 'active' };
  db.prepare(`INSERT INTO clients (id, unique_id, name, phone, target, photo, join_date, status) VALUES (?,?,?,?,?,?,?,?)`)
    .run(client.id, client.uniqueId, client.name, client.phone, client.target, client.photo, client.joinDate, client.status);
  logAudit('host', 'client_added', `Added ${client.uniqueId} (${name})`);
  res.json(publicClient(db.prepare(`SELECT * FROM clients WHERE id = ?`).get(client.id)));
});

app.post('/api/clients/bulk', (req, res) => {
  const { lines } = req.body || {}; // [{name, phone}]
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'No lines to add.' });
  let added = 0, skipped = 0;
  const insert = db.prepare(`INSERT INTO clients (id, unique_id, name, phone, target, photo, join_date, status) VALUES (?,?,?,?,?,?,?,?)`);
  const tx = db.transaction((items) => {
    for (const item of items) {
      const name = (item.name || '').trim();
      const phone = (item.phone || '').trim();
      if (!name || phone.length < 6) { skipped++; continue; }
      insert.run(newId(), nextUniqueId(), name, phone, null, null, new Date().toISOString().slice(0,10), 'active');
      added++;
    }
  });
  tx(lines);
  logAudit('host', 'bulk_add', `Bulk added ${added} clients (${skipped} skipped)`);
  res.json({ added, skipped });
});

app.put('/api/clients/:id/photo', (req, res) => {
  const { photo } = req.body || {};
  const result = db.prepare(`UPDATE clients SET photo = ? WHERE id = ?`).run(photo || null, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Client not found.' });
  res.json({ ok: true });
});

app.get('/api/clients/:id/transactions', (req, res) => {
  const range = req.query.range || 'all';
  let rows;
  if (range === 'month') {
    const ym = new Date().toISOString().slice(0,7);
    rows = db.prepare(`SELECT * FROM transactions WHERE client_id = ? AND substr(date,1,7) = ? ORDER BY date DESC, ts DESC`).all(req.params.id, ym);
  } else {
    rows = db.prepare(`SELECT * FROM transactions WHERE client_id = ? ORDER BY date DESC, ts DESC`).all(req.params.id);
  }
  // running balance, newest first
  let running = clientBalance(req.params.id);
  const withRunning = rows.map(t => {
    const out = { id: t.id, type: t.type, amount: t.amount, date: t.date, note: t.note, ts: t.ts, runningBalance: running };
    running -= (t.type === 'deposit' ? t.amount : -t.amount);
    return out;
  });
  res.json(withRunning);
});

app.post('/api/clients/:id/deposit', (req, res) => {
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const { amount, date, note } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  const tx = { id: newId(), clientId: client.id, type: 'deposit', amount: amt, date: date || new Date().toISOString().slice(0,10), note: note || null, ts: Date.now() };
  db.prepare(`INSERT INTO transactions (id, client_id, type, amount, date, note, ts) VALUES (?,?,?,?,?,?,?)`)
    .run(tx.id, tx.clientId, tx.type, tx.amount, tx.date, tx.note, tx.ts);
  logAudit('host', 'deposit', `₹${amt.toLocaleString('en-IN')} deposited to ${client.unique_id}`);
  res.json({ ok: true, balance: clientBalance(client.id) });
});

// Step 1: request withdrawal -> server generates + stores an OTP (demo: also returns it, since there's no real SMS gateway wired up)
app.post('/api/clients/:id/withdraw/request', (req, res) => {
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const { amount } = req.body || {};
  const amt = Number(amount);
  const balance = clientBalance(client.id);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Enter a valid amount.' });
  if (amt > balance) return res.status(400).json({ error: `Cannot withdraw more than the balance (₹${balance.toLocaleString('en-IN')}).` });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 5 * 60 * 1000;
  db.prepare(`INSERT INTO pending_otp (client_id, code, amount, expires_at) VALUES (?,?,?,?)
              ON CONFLICT(client_id) DO UPDATE SET code=excluded.code, amount=excluded.amount, expires_at=excluded.expires_at`)
    .run(client.id, code, amt, expiresAt);
  logAudit('host', 'otp_sent', `OTP generated for ₹${amt.toLocaleString('en-IN')} withdrawal from ${client.unique_id}`);
  // DEMO NOTE: a real deployment sends `code` by SMS and never returns it in this response.
  res.json({ ok: true, demoCode: code, expiresAt, phoneMasked: client.phone.slice(0,-4) + '****' });
});

// Step 2: verify OTP -> creates the withdrawal transaction if it matches and hasn't expired
app.post('/api/clients/:id/withdraw/verify', (req, res) => {
  const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found.' });
  const pending = db.prepare(`SELECT * FROM pending_otp WHERE client_id = ?`).get(client.id);
  const { code } = req.body || {};
  if (!pending) return res.status(400).json({ error: 'No withdrawal in progress. Start again.' });
  if (Date.now() > pending.expires_at) {
    db.prepare(`DELETE FROM pending_otp WHERE client_id = ?`).run(client.id);
    logAudit('host', 'withdrawal_rejected', `OTP expired for ${client.unique_id}`);
    return res.status(400).json({ error: 'expired' });
  }
  if (code !== pending.code) {
    logAudit('host', 'withdrawal_rejected', `Wrong OTP entered for ${client.unique_id}`);
    return res.status(400).json({ error: 'mismatch' });
  }
  const tx = { id: newId(), clientId: client.id, type: 'withdrawal', amount: pending.amount, date: new Date().toISOString().slice(0,10), note: 'OTP verified', ts: Date.now() };
  db.prepare(`INSERT INTO transactions (id, client_id, type, amount, date, note, ts) VALUES (?,?,?,?,?,?,?)`)
    .run(tx.id, tx.clientId, tx.type, tx.amount, tx.date, tx.note, tx.ts);
  db.prepare(`DELETE FROM pending_otp WHERE client_id = ?`).run(client.id);
  logAudit('host', 'withdrawal_approved', `₹${pending.amount.toLocaleString('en-IN')} withdrawn from ${client.unique_id} after OTP match`);
  res.json({ ok: true, balance: clientBalance(client.id) });
});

/* --------------------------- Client login route --------------------------- */
// Search is intentionally public-safe (name/id — no balances), used on the client login screen.
app.get('/api/client-search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT id, unique_id, name, photo FROM clients WHERE status != 'closed'
    AND (name LIKE ? OR unique_id LIKE ? OR phone LIKE ?)
    ORDER BY name COLLATE NOCASE LIMIT 8`).all(like, like, like);
  res.json(rows.map(r => ({ id: r.id, uniqueId: r.unique_id, name: r.name, photo: r.photo })));
});

app.post('/api/client-login', (req, res) => {
  const { clientId, last4 } = req.body || {};
  const row = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(clientId);
  if (!row) return res.status(404).json({ error: 'Client not found.' });
  if (row.phone.slice(-4) !== String(last4 || '')) return res.status(401).json({ error: "That doesn't match our records." });
  logAudit('client', 'client_login', `${row.unique_id} logged in`);
  res.json(publicClient(row));
});

/* ------------------------------ Audit log ------------------------------- */
app.get('/api/audit', (req, res) => {
  const rows = db.prepare(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT 100`).all();
  res.json(rows);
});

app.get('/api/stats', (req, res) => {
  const clients = db.prepare(`SELECT id FROM clients WHERE status != 'closed'`).all();
  const total = clients.reduce((acc, c) => acc + clientBalance(c.id), 0);
  const due = clients.filter(c => !hasDepositedThisMonth(c.id)).length;
  const depositCount = db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type='deposit'`).get().n;
  const withdrawalCount = db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type='withdrawal'`).get().n;
  const auditCount = db.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get().n;
  res.json({ totalClients: clients.length, totalHeld: total, dueThisMonth: due, depositCount, withdrawalCount, auditCount });
});

/* Fallback: any non-API route serves the app itself (so refreshing a deep link still works) */
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Ledgr server running at http://localhost:${PORT}`);
});
