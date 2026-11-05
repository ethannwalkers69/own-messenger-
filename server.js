require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const SECRET = process.env.JWT_SECRET;
const isProd = process.env.NODE_ENV === 'production';
if (isProd) app.set('trust proxy', 1);

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

function auth(req, res, next) {
  try { req.user = jwt.verify(req.cookies.token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Not logged in' }); }
}
function giveToken(res, user) {
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 7 * 24 * 3600 * 1000 });
}

app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '') || (password || '').length < 6)
    return res.status(400).json({ error: 'Username: 3-20 letters, numbers or _. Password: at least 6 characters.' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username', [username, hash]);
    giveToken(res, rows[0]);
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username is already taken' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (!rows[0] || !(await bcrypt.compare(password || '', rows[0].password_hash)))
      return res.status(401).json({ error: 'Wrong username or password' });
    giveToken(res, rows[0]);
    res.json({ id: rows[0].id, username: rows[0].username });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/logout', async (req, res) => {
  try {
    const u = jwt.verify(req.cookies.token, SECRET);
    await pool.query('UPDATE users SET last_seen = NULL WHERE id = $1', [u.id]);
  } catch {}
  res.clearCookie('token');
  res.json({ ok: true });
});
app.get('/api/me', auth, (req, res) => res.json({ id: req.user.id, username: req.user.username }));

app.get('/api/users', auth, async (req, res) => {
  await pool.query('UPDATE users SET last_seen = now() WHERE id = $1', [req.user.id]);
  const { rows } = await pool.query(
    `SELECT u.id, u.username,
       COALESCE(u.last_seen > now() - interval '30 seconds', false) AS online,
       (SELECT COUNT(*) FROM messages m
         WHERE m.sender_id = u.id AND m.receiver_id = $1 AND m.read_at IS NULL)::int AS unread
     FROM users u WHERE u.id <> $1 ORDER BY u.username`, [req.user.id]);
  res.json(rows);
});

app.get('/api/messages/:peerId', auth, async (req, res) => {
  await pool.query(
    'UPDATE messages SET read_at = now() WHERE sender_id = $2 AND receiver_id = $1 AND read_at IS NULL',
    [req.user.id, req.params.peerId]);
  const { rows } = await pool.query(
    `SELECT id, sender_id, body, created_at FROM messages
     WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
     ORDER BY id DESC LIMIT 200`, [req.user.id, req.params.peerId]);
  res.json(rows.reverse());
});

app.post('/api/messages/:peerId', auth, async (req, res) => {
  const body = (req.body.body || '').trim();
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Message is empty or too long' });
  await pool.query('INSERT INTO messages (sender_id, receiver_id, body) VALUES ($1, $2, $3)',
    [req.user.id, req.params.peerId, body]);
  res.json({ ok: true });
});

app.listen(process.env.PORT || 3000, () => console.log('Running on http://localhost:' + (process.env.PORT || 3000)));
