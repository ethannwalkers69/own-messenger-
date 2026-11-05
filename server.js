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

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static('public'));

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const int = v => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : null; };
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

function auth(req, res, next) {
  try { req.user = jwt.verify(req.cookies.token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Not logged in' }); }
}
function giveToken(res, user) {
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 7 * 24 * 3600 * 1000 });
}

/* ---------- auth ---------- */
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
    const { rows } = await pool.query(
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
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $2', [id, id.toLowerCase()]);
    if (!rows[0] || !(await bcrypt.compare(req.body.password || '', rows[0].password_hash)))
      return res.status(401).json({ error: 'Wrong username/Gmail or password' });
    giveToken(res, rows[0]);
    res.json({ id: rows[0].id, username: rows[0].username, last_name: rows[0].last_name });
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

/* ---------- profile ---------- */
app.get('/api/me', auth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, last_name, bio, avatar, color FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Not logged in' });
  res.json(rows[0]);
}));

app.put('/api/profile', auth, wrap(async (req, res) => {
  const lastName = (req.body.last_name || '').trim();
  const bio = (req.body.bio || '').trim().slice(0, 160);
  const color = /^#[0-9a-fA-F]{6}$/.test(req.body.color || '') ? req.body.color : null;
  const avatar = req.body.avatar || null;
  if (!lastName || lastName.length > 40) return res.status(400).json({ error: 'Enter your last name' });
  if (avatar && (!/^data:image\/(jpeg|png|webp);base64,/.test(avatar) || avatar.length > 80000))
    return res.status(400).json({ error: 'Photo is invalid or too large' });
  await pool.query('UPDATE users SET last_name = $1, bio = $2, color = $3, avatar = $4 WHERE id = $5',
    [lastName, bio, color, avatar, req.user.id]);
  res.json({ ok: true });
}));

/* ---------- users ---------- */
app.get('/api/users', auth, wrap(async (req, res) => {
  await pool.query('UPDATE users SET last_seen = now() WHERE id = $1', [req.user.id]);
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.last_name, u.bio, u.avatar, u.color,
       COALESCE(u.last_seen > now() - interval '30 seconds', false) AS online,
       (SELECT COUNT(*) FROM messages m
         WHERE m.sender_id = u.id AND m.receiver_id = $1 AND m.read_at IS NULL)::int AS unread
     FROM users u WHERE u.id <> $1 ORDER BY u.username`, [req.user.id]);
  res.json(rows);
}));

/* ---------- messages (shared query) ---------- */
const MSG_SQL = `
  SELECT m.id, m.sender_id, u.username AS sender_name, CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body, m.created_at, m.reply_to, m.system,
    m.edited_at, m.deleted_at, m.read_at, (m.image IS NOT NULL) AS has_image,
    CASE WHEN r.deleted_at IS NOT NULL THEN 'Message deleted' WHEN r.body = '' AND r.image IS NOT NULL THEN '📷 Photo' ELSE r.body END AS reply_body,
    ru.username AS reply_name,
    COALESCE((SELECT json_agg(json_build_object('emoji', x.emoji, 'user_id', x.user_id))
              FROM reactions x WHERE x.message_id = m.id), '[]'::json) AS reactions
  FROM messages m
  JOIN users u ON u.id = m.sender_id
  LEFT JOIN messages r ON r.id = m.reply_to
  LEFT JOIN users ru ON ru.id = r.sender_id`;

const isMember = async (gid, uid) =>
  (await pool.query('SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [gid, uid])).rowCount > 0;

function cleanMsg(req, res) {
  const body = (req.body.body || '').trim();
  const image = req.body.image || null;
  if (image && (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > 1500000)) {
    res.status(400).json({ error: 'Image is invalid or too large' }); return null;
  }
  if ((!body && !image) || body.length > 2000) { res.status(400).json({ error: 'Message is empty or too long' }); return null; }
  return { body, image };
}

app.get('/api/messages/:peerId', auth, wrap(async (req, res) => {
  const peer = int(req.params.peerId);
  if (peer === null) return res.status(400).json({ error: 'Bad request' });
  await pool.query(
    'UPDATE messages SET read_at = now() WHERE sender_id = $2 AND receiver_id = $1 AND read_at IS NULL',
    [req.user.id, peer]);
  const { rows } = await pool.query(
    MSG_SQL + ` WHERE m.group_id IS NULL
      AND ((m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1))
      ORDER BY m.id DESC LIMIT 200`, [req.user.id, peer]);
  res.json(rows.reverse());
}));

app.post('/api/messages/:peerId', auth, wrap(async (req, res) => {
  const peer = int(req.params.peerId), msg = cleanMsg(req, res);
  if (msg === null) return;
  if (peer === null) return res.status(400).json({ error: 'Bad request' });
  const replyTo = int(req.body.reply_to);
  if (replyTo !== null) {
    const ok = await pool.query(
      `SELECT 1 FROM messages WHERE id = $1 AND group_id IS NULL
       AND ((sender_id = $2 AND receiver_id = $3) OR (sender_id = $3 AND receiver_id = $2))`, [replyTo, req.user.id, peer]);
    if (!ok.rowCount) return res.status(400).json({ error: 'Replied message not found' });
  }
  await pool.query('INSERT INTO messages (sender_id, receiver_id, body, image, reply_to) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id, peer, msg.body, msg.image, replyTo]);
  res.json({ ok: true });
}));

/* ---------- groups ---------- */
app.get('/api/groups', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.created_by AS leader_id,
       (SELECT COUNT(*) FROM group_members WHERE group_id = g.id)::int AS members,
       (SELECT COUNT(*) FROM messages m WHERE m.group_id = g.id AND m.sender_id <> $1 AND m.id > gm.last_read_id)::int AS unread
     FROM chat_groups g JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
     ORDER BY g.id DESC`, [req.user.id]);
  res.json(rows);
}));

app.post('/api/groups', auth, wrap(async (req, res) => {
  const name = (req.body.name || '').trim();
  const ids = [...new Set((Array.isArray(req.body.members) ? req.body.members : []).map(int).filter(n => n !== null))].slice(0, 50);
  if (!name || name.length > 40) return res.status(400).json({ error: 'Group name: 1-40 characters' });
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one person' });
  const g = await pool.query('INSERT INTO chat_groups (name, created_by) VALUES ($1, $2) RETURNING id, name', [name, req.user.id]);
  await pool.query('INSERT INTO group_members (group_id, user_id) SELECT $1, id FROM users WHERE id = ANY($2::int[])',
    [g.rows[0].id, [...ids, req.user.id]]);
  await sysMsg(g.rows[0].id, req.user.id, `${await nameOf(req.user.id)} created the group`);
  res.json(g.rows[0]);
}));

app.get('/api/groups/:id/messages', auth, wrap(async (req, res) => {
  const gid = int(req.params.id);
  if (gid === null || !(await isMember(gid, req.user.id))) return res.status(403).json({ error: 'Not in this group' });
  await pool.query(
    'UPDATE group_members SET last_read_id = COALESCE((SELECT MAX(id) FROM messages WHERE group_id = $1), 0) WHERE group_id = $1 AND user_id = $2',
    [gid, req.user.id]);
  const { rows } = await pool.query(MSG_SQL + ' WHERE m.group_id = $1 ORDER BY m.id DESC LIMIT 200', [gid]);
  res.json(rows.reverse());
}));

app.post('/api/groups/:id/messages', auth, wrap(async (req, res) => {
  const gid = int(req.params.id), msg = cleanMsg(req, res);
  if (msg === null) return;
  if (gid === null || !(await isMember(gid, req.user.id))) return res.status(403).json({ error: 'Not in this group' });
  const replyTo = int(req.body.reply_to);
  if (replyTo !== null && !(await pool.query('SELECT 1 FROM messages WHERE id = $1 AND group_id = $2', [replyTo, gid])).rowCount)
    return res.status(400).json({ error: 'Replied message not found' });
  await pool.query('INSERT INTO messages (sender_id, group_id, body, image, reply_to) VALUES ($1, $2, $3, $4, $5)',
    [req.user.id, gid, msg.body, msg.image, replyTo]);
  res.json({ ok: true });
}));

/* ---------- group members & leader ---------- */
const nameOf = async uid => {
  const r = await pool.query("SELECT username || COALESCE(' ' || last_name, '') AS n FROM users WHERE id = $1", [uid]);
  return r.rows[0] ? r.rows[0].n : 'Someone';
};
const sysMsg = (gid, uid, body) =>
  pool.query('INSERT INTO messages (sender_id, group_id, body, system) VALUES ($1, $2, $3, true)', [uid, gid, body]);

const leaderOf = async gid => { const r = await pool.query('SELECT created_by FROM chat_groups WHERE id = $1', [gid]); return r.rows[0] && r.rows[0].created_by; };
async function asLeader(req, res) {
  const gid = int(req.params.id);
  if (gid === null || !(await isMember(gid, req.user.id))) { res.status(403).json({ error: 'Not in this group' }); return null; }
  if ((await leaderOf(gid)) !== req.user.id) { res.status(403).json({ error: 'Only the group leader can do that' }); return null; }
  return gid;
}

app.get('/api/groups/:id/members', auth, wrap(async (req, res) => {
  const gid = int(req.params.id);
  if (gid === null || !(await isMember(gid, req.user.id))) return res.status(403).json({ error: 'Not in this group' });
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.last_name, u.bio, u.avatar, u.color,
       COALESCE(u.last_seen > now() - interval '30 seconds', false) AS online,
       (g.created_by = u.id) AS is_leader
     FROM group_members gm JOIN users u ON u.id = gm.user_id JOIN chat_groups g ON g.id = gm.group_id
     WHERE gm.group_id = $1 ORDER BY is_leader DESC, u.username`, [gid]);
  res.json(rows);
}));

app.post('/api/groups/:id/members', auth, wrap(async (req, res) => {
  const gid = await asLeader(req, res); if (gid === null) return;
  const ids = [...new Set((Array.isArray(req.body.members) ? req.body.members : []).map(int).filter(n => n !== null))].slice(0, 50);
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one person' });
  await pool.query(
    `INSERT INTO group_members (group_id, user_id, last_read_id)
     SELECT $1, id, COALESCE((SELECT MAX(id) FROM messages WHERE group_id = $1), 0) FROM users WHERE id = ANY($2::int[])
     ON CONFLICT DO NOTHING RETURNING user_id`, [gid, ids]).then(async r => {
      if (!r.rowCount) return;
      const n = await pool.query("SELECT string_agg(username || COALESCE(' ' || last_name, ''), ', ') AS n FROM users WHERE id = ANY($1::int[])", [r.rows.map(x => x.user_id)]);
      await sysMsg(gid, req.user.id, `${await nameOf(req.user.id)} added ${n.rows[0].n}`);
    });
  res.json({ ok: true });
}));

app.delete('/api/groups/:id/members/:uid', auth, wrap(async (req, res) => {
  const gid = await asLeader(req, res); if (gid === null) return;
  const uid = int(req.params.uid);
  if (uid === null) return res.status(400).json({ error: 'Bad request' });
  if (uid === req.user.id) return res.status(400).json({ error: 'Use Leave group instead' });
  const r = await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [gid, uid]);
  if (!r.rowCount) return res.status(404).json({ error: 'Not a member' });
  await sysMsg(gid, req.user.id, `${await nameOf(req.user.id)} removed ${await nameOf(uid)}`);
  res.json({ ok: true });
}));

app.put('/api/groups/:id', auth, wrap(async (req, res) => {
  const gid = await asLeader(req, res); if (gid === null) return;
  const name = (req.body.name || '').trim();
  if (!name || name.length > 40) return res.status(400).json({ error: 'Group name: 1-40 characters' });
  await pool.query('UPDATE chat_groups SET name = $1 WHERE id = $2', [name, gid]);
  await sysMsg(gid, req.user.id, `${await nameOf(req.user.id)} renamed the group to ${name}`);
  res.json({ ok: true });
}));

app.post('/api/groups/:id/leader', auth, wrap(async (req, res) => {
  const gid = await asLeader(req, res); if (gid === null) return;
  const uid = int(req.body.user_id);
  if (uid === null || !(await isMember(gid, uid))) return res.status(400).json({ error: 'Pick a member of this group' });
  await pool.query('UPDATE chat_groups SET created_by = $1 WHERE id = $2', [uid, gid]);
  await sysMsg(gid, req.user.id, `${await nameOf(req.user.id)} made ${await nameOf(uid)} the leader`);
  res.json({ ok: true });
}));

app.post('/api/groups/:id/leave', auth, wrap(async (req, res) => {
  const gid = int(req.params.id);
  if (gid === null || !(await isMember(gid, req.user.id))) return res.status(403).json({ error: 'Not in this group' });
  await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [gid, req.user.id]);
  const left = await pool.query('SELECT user_id FROM group_members WHERE group_id = $1 ORDER BY joined_at, user_id', [gid]);
  if (!left.rowCount) await pool.query('DELETE FROM chat_groups WHERE id = $1', [gid]);   // last one out closes the group
  else {
    await sysMsg(gid, req.user.id, `${await nameOf(req.user.id)} left`);
    if ((await leaderOf(gid)) === req.user.id) {                                           // leader left: longest-standing member takes over
      const next = left.rows[0].user_id;
      await pool.query('UPDATE chat_groups SET created_by = $1 WHERE id = $2', [next, gid]);
      await sysMsg(gid, next, `${await nameOf(next)} is now the leader`);
    }
  }
  res.json({ ok: true });
}));

/* ---------- images, edit, delete, typing ---------- */
const canSee = async (mid, uid) => (await pool.query(
  `SELECT 1 FROM messages m WHERE m.id = $1 AND NOT m.system AND (m.sender_id = $2 OR m.receiver_id = $2
     OR EXISTS (SELECT 1 FROM group_members g WHERE g.group_id = m.group_id AND g.user_id = $2))`, [mid, uid])).rowCount > 0;

app.get('/api/messages/:id/image', auth, wrap(async (req, res) => {
  const mid = int(req.params.id);
  if (mid === null || !(await canSee(mid, req.user.id))) return res.status(404).end();
  const r = await pool.query('SELECT image FROM messages WHERE id = $1 AND image IS NOT NULL AND deleted_at IS NULL', [mid]);
  const m = r.rows[0] && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(r.rows[0].image);
  if (!m) return res.status(404).end();
  res.set({ 'Content-Type': m[1], 'Cache-Control': 'private, max-age=86400' }).send(Buffer.from(m[2], 'base64'));
}));

app.put('/api/messages/:id', auth, wrap(async (req, res) => {
  const mid = int(req.params.id), body = (req.body.body || '').trim();
  if (mid === null || !body || body.length > 2000) return res.status(400).json({ error: 'Message is empty or too long' });
  const r = await pool.query(
    'UPDATE messages SET body = $1, edited_at = now() WHERE id = $2 AND sender_id = $3 AND deleted_at IS NULL AND NOT system',
    [body, mid, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Message not found' });
  res.json({ ok: true });
}));

app.delete('/api/messages/:id', auth, wrap(async (req, res) => {
  const mid = int(req.params.id);
  if (mid === null) return res.status(400).json({ error: 'Bad request' });
  const r = await pool.query(
    "UPDATE messages SET deleted_at = now(), body = '', image = NULL WHERE id = $1 AND sender_id = $2 AND deleted_at IS NULL AND NOT system",
    [mid, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Message not found' });
  await pool.query('DELETE FROM reactions WHERE message_id = $1', [mid]);
  res.json({ ok: true });
}));

// Typing indicator: kept in memory, so it works with a single server instance.
const typing = new Map();   // chatKey -> Map(userId -> { t, name })
const chatKey = (uid, type, id) => type === 'group' ? 'g' + id : 'd' + [uid, id].sort((a, b) => a - b).join('-');

app.post('/api/typing', auth, wrap(async (req, res) => {
  const id = int(req.body.id), type = req.body.type === 'group' ? 'group' : 'dm';
  if (id !== null && (type === 'dm' || (await isMember(id, req.user.id)))) {
    const k = chatKey(req.user.id, type, id);
    if (!typing.has(k)) typing.set(k, new Map());
    typing.get(k).set(req.user.id, { t: Date.now(), name: req.user.username });
  }
  res.json({ ok: true });
}));

app.get('/api/typing', auth, wrap(async (req, res) => {
  const id = int(req.query.id), type = req.query.type === 'group' ? 'group' : 'dm';
  if (id === null || (type === 'group' && !(await isMember(id, req.user.id)))) return res.json([]);
  const m = typing.get(chatKey(req.user.id, type, id)), out = [], now = Date.now();
  if (m) for (const [uid, v] of m) { if (now - v.t > 4000) m.delete(uid); else if (uid !== req.user.id) out.push(v.name); }
  res.json(out);
}));

/* ---------- reactions (tap same emoji again to remove) ---------- */
app.post('/api/messages/:id/react', auth, wrap(async (req, res) => {
  const mid = int(req.params.id), emoji = req.body.emoji;
  if (mid === null || !EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Bad request' });
  const ok = await pool.query(
    `SELECT 1 FROM messages m WHERE m.id = $1 AND NOT m.system AND m.deleted_at IS NULL AND (m.sender_id = $2 OR m.receiver_id = $2
       OR EXISTS (SELECT 1 FROM group_members g WHERE g.group_id = m.group_id AND g.user_id = $2))`, [mid, req.user.id]);
  if (!ok.rowCount) return res.status(403).json({ error: 'Not allowed' });
  const cur = await pool.query('SELECT emoji FROM reactions WHERE message_id = $1 AND user_id = $2', [mid, req.user.id]);
  if (cur.rows[0] && cur.rows[0].emoji === emoji)
    await pool.query('DELETE FROM reactions WHERE message_id = $1 AND user_id = $2', [mid, req.user.id]);
  else
    await pool.query(
      'INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = $3',
      [mid, req.user.id, emoji]);
  res.json({ ok: true });
}));

app.listen(process.env.PORT || 3000, () => console.log('Running on http://localhost:' + (process.env.PORT || 3000)));
