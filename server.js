require('dotenv').config();
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
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

const q = (text, params) => pool.query(text, params);
const h = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

function auth(req, res, next) {
  try { req.user = jwt.verify(req.cookies.token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Not logged in' }); }
}
function giveToken(res, user) {
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 7 * 24 * 3600 * 1000 });
}

// ---------- real-time ----------
const clients = new Map(); // userId -> Set of sockets
function push(userIds, payload) {
  const s = JSON.stringify(payload);
  for (const id of userIds) for (const ws of clients.get(id) || []) if (ws.readyState === 1) ws.send(s);
}
const presence = () => push([...clients.keys()], { type: 'presence', online: [...clients.keys()] });
async function memberIds(cid) {
  const { rows } = await q('SELECT user_id FROM members WHERE conversation_id = $1', [cid]);
  return rows.map(r => r.user_id);
}
async function isMember(cid, uid) {
  return (await q('SELECT 1 FROM members WHERE conversation_id = $1 AND user_id = $2', [cid, uid])).rows.length > 0;
}

// ---------- account ----------
app.post('/api/signup', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const username = (req.body.username || '').trim();
  const lastName = (req.body.last_name || '').trim();
  const password = req.body.password || '';
  if (!/^[a-z0-9._+-]+@gmail\.com$/.test(email)) return res.status(400).json({ error: 'Use a valid Gmail address (name@gmail.com)' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username: 3-20 letters, numbers or _' });
  if (!lastName || lastName.length > 40) return res.status(400).json({ error: 'Enter your last name' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await q(
      'INSERT INTO users (username, email, last_name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, username, last_name',
      [username, email, lastName, hash]);
    giveToken(res, rows[0]);
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: (e.constraint || '').includes('email') ? 'That Gmail is already registered' : 'Username is already taken' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const id = (req.body.username || '').trim();
  try {
    const { rows } = await q('SELECT * FROM users WHERE username = $1 OR email = $2', [id, id.toLowerCase()]);
    if (!rows[0] || !(await bcrypt.compare(req.body.password || '', rows[0].password_hash)))
      return res.status(401).json({ error: 'Wrong username/Gmail or password' });
    giveToken(res, rows[0]);
    res.json({ id: rows[0].id, username: rows[0].username, last_name: rows[0].last_name });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

app.get('/api/me', auth, h(async (req, res) => {
  const { rows } = await q('SELECT id, username, last_name FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Not logged in' });
  res.json(rows[0]);
}));

app.get('/api/users', auth, h(async (req, res) => {
  const { rows } = await q('SELECT id, username, last_name FROM users WHERE id <> $1 ORDER BY username', [req.user.id]);
  res.json(rows);
}));

// ---------- conversations ----------
app.get('/api/conversations', auth, h(async (req, res) => {
  const { rows } = await q(`
    SELECT c.id, c.name, c.is_group,
      (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'last_name', u.last_name) ORDER BY u.username)
         FROM members mm JOIN users u ON u.id = mm.user_id WHERE mm.conversation_id = c.id) AS members,
      (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_body,
      (SELECT max(id) FROM messages WHERE conversation_id = c.id) AS last_id,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND id > m.last_read_id AND sender_id <> $1)::int AS unread
    FROM conversations c JOIN members m ON m.conversation_id = c.id AND m.user_id = $1
    WHERE c.is_group OR c.created_by = $1 OR EXISTS (SELECT 1 FROM messages WHERE conversation_id = c.id)
    ORDER BY last_id DESC NULLS LAST, c.id DESC`, [req.user.id]);
  res.json(rows);
}));

app.post('/api/direct', auth, h(async (req, res) => {
  const other = parseInt(req.body.user_id, 10);
  if (!other || other === req.user.id) return res.status(400).json({ error: 'Invalid user' });
  if (!(await q('SELECT 1 FROM users WHERE id = $1', [other])).rows[0]) return res.status(404).json({ error: 'User not found' });
  const f = await q(`SELECT c.id FROM conversations c
    JOIN members a ON a.conversation_id = c.id AND a.user_id = $1
    JOIN members b ON b.conversation_id = c.id AND b.user_id = $2
    WHERE NOT c.is_group LIMIT 1`, [req.user.id, other]);
  if (f.rows[0]) return res.json({ id: f.rows[0].id });
  const c = await q('INSERT INTO conversations (is_group, created_by) VALUES (false, $1) RETURNING id', [req.user.id]);
  await q('INSERT INTO members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)', [c.rows[0].id, req.user.id, other]);
  res.json({ id: c.rows[0].id });
}));

app.post('/api/groups', auth, h(async (req, res) => {
  const name = (req.body.name || '').trim();
  const ids = [...new Set((req.body.member_ids || []).map(Number).filter(n => n && n !== req.user.id))];
  if (!name || name.length > 40 || !ids.length) return res.status(400).json({ error: 'Add a group name and at least one member' });
  const valid = (await q('SELECT id FROM users WHERE id = ANY($1::int[])', [ids])).rows.map(r => r.id);
  if (!valid.length) return res.status(400).json({ error: 'Add at least one member' });
  const c = await q('INSERT INTO conversations (name, is_group, created_by) VALUES ($1, true, $2) RETURNING id', [name, req.user.id]);
  await q('INSERT INTO members (conversation_id, user_id) SELECT $1, unnest($2::int[])', [c.rows[0].id, [req.user.id, ...valid]]);
  push(valid, { type: 'refresh' });
  res.json({ id: c.rows[0].id });
}));

app.post('/api/conversations/:id/leave', auth, h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const c = await q('SELECT is_group FROM conversations WHERE id = $1', [id]);
  if (!c.rows[0] || !c.rows[0].is_group) return res.status(400).json({ error: 'Not a group' });
  const ids = await memberIds(id);
  if (!ids.includes(req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  await q('DELETE FROM members WHERE conversation_id = $1 AND user_id = $2', [id, req.user.id]);
  if (ids.length <= 1) await q('DELETE FROM conversations WHERE id = $1', [id]);
  push(ids, { type: 'refresh' });
  res.json({ ok: true });
}));

app.get('/api/conversations/:id/messages', auth, h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || !(await isMember(id, req.user.id))) return res.status(403).json({ error: 'Not allowed' });
  const { rows } = await q(`
    SELECT m.id, m.sender_id, u.username, m.body, m.created_at, m.reply_to,
      r.body AS reply_body, ru.username AS reply_user,
      COALESCE((SELECT json_agg(json_build_object('user_id', x.user_id, 'emoji', x.emoji))
                FROM reactions x WHERE x.message_id = m.id), '[]') AS reactions
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN messages r ON r.id = m.reply_to
    LEFT JOIN users ru ON ru.id = r.sender_id
    WHERE m.conversation_id = $1
    ORDER BY m.id DESC LIMIT 200`, [id]);
  if (rows.length)
    await q('UPDATE members SET last_read_id = GREATEST(last_read_id, $3) WHERE conversation_id = $1 AND user_id = $2', [id, req.user.id, rows[0].id]);
  res.json(rows.reverse());
}));

app.post('/api/conversations/:id/messages', auth, h(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = (req.body.body || '').trim();
  if (!body || body.length > 2000) return res.status(400).json({ error: 'Message is empty or too long' });
  if (!id || !(await isMember(id, req.user.id))) return res.status(403).json({ error: 'Not allowed' });
  let replyTo = parseInt(req.body.reply_to, 10) || null;
  if (replyTo && !(await q('SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2', [replyTo, id])).rows[0]) replyTo = null;
  await q('INSERT INTO messages (conversation_id, sender_id, body, reply_to) VALUES ($1, $2, $3, $4)', [id, req.user.id, body, replyTo]);
  push(await memberIds(id), { type: 'message', conversation_id: id });
  res.json({ ok: true });
}));

const REACTIONS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F621}'];
app.post('/api/messages/:id/react', auth, h(async (req, res) => {
  const id = parseInt(req.params.id, 10), emoji = req.body.emoji;
  if (!id || !REACTIONS.includes(emoji)) return res.status(400).json({ error: 'Invalid reaction' });
  const msg = await q(`SELECT m.conversation_id FROM messages m
    JOIN members b ON b.conversation_id = m.conversation_id AND b.user_id = $2 WHERE m.id = $1`, [id, req.user.id]);
  if (!msg.rows[0]) return res.status(404).json({ error: 'Message not found' });
  const cur = await q('SELECT emoji FROM reactions WHERE message_id = $1 AND user_id = $2', [id, req.user.id]);
  if (cur.rows[0] && cur.rows[0].emoji === emoji)
    await q('DELETE FROM reactions WHERE message_id = $1 AND user_id = $2', [id, req.user.id]);
  else
    await q('INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji', [id, req.user.id, emoji]);
  const cid = msg.rows[0].conversation_id;
  push(await memberIds(cid), { type: 'message', conversation_id: cid });
  res.json({ ok: true });
}));

// ---------- server + websocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  try {
    const m = /(?:^|;\s*)token=([^;]+)/.exec(req.headers.cookie || '');
    const user = jwt.verify(decodeURIComponent(m[1]), SECRET);
    wss.handleUpgrade(req, socket, head, ws => { ws.userId = user.id; wss.emit('connection', ws); });
  } catch { socket.destroy(); }
});
wss.on('connection', ws => {
  if (!clients.has(ws.userId)) clients.set(ws.userId, new Set());
  clients.get(ws.userId).add(ws);
  presence();
  ws.on('close', () => {
    const set = clients.get(ws.userId);
    if (set) { set.delete(ws); if (!set.size) clients.delete(ws.userId); }
    presence();
  });
});
setInterval(() => wss.clients.forEach(ws => ws.ping()), 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Running on http://localhost:' + PORT));
