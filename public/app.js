const $ = id => document.getElementById(id);
const IC = {
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'
};
const icon = (n, c = 'w-5 h-5') => '<svg class="' + c + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>';
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon, el.dataset.cls || 'w-5 h-5'); });
const EMOJIS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F621}'];
const COLORS = ['bg-violet-500', 'bg-fuchsia-600', 'bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-500'];
let mode = 'login', me = null, ws = null, convs = [], users = [], online = new Set();
let cur = null, lastSig = '', lastMsgs = [], pickerFor = null, replyTo = null;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const fullName = u => (u.username + ' ' + (u.last_name || '')).trim();
const other = c => c.members.find(m => m.id !== me.id) || c.members[0];
const convName = c => c.is_group ? c.name : fullName(other(c));

function avatar(name, size = 'w-10 h-10', onl, group) {
  const wrap = document.createElement('div');
  wrap.className = 'relative shrink-0';
  const d = document.createElement('div');
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  if (group) d.innerHTML = icon('users'); else d.textContent = name[0].toUpperCase();
  d.className = size + ' rounded-full grid place-items-center font-semibold text-white ' + COLORS[h];
  wrap.appendChild(d);
  if (onl !== undefined) {
    const dot = document.createElement('span');
    dot.className = 'absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-ube-900 ' + (onl ? 'bg-green-400' : 'bg-slate-500');
    wrap.appendChild(dot);
  }
  return wrap;
}

function show(view) {
  $('auth').style.display = view === 'auth' ? '' : 'none';
  $('chat').style.display = view === 'chat' ? 'flex' : 'none';
}

function setMode(m) {
  mode = m;
  const login = m === 'login';
  $('authTitle').textContent = login ? 'Log in' : 'Create account';
  $('authBtn').textContent = login ? 'Log in' : 'Create account';
  $('toggleAuth').textContent = login ? 'Create an account' : 'I already have an account';
  $('userLbl').textContent = login ? 'Username or Gmail' : 'Username';
  $('emailWrap').style.display = $('lastWrap').style.display = login ? 'none' : '';
  $('password').autocomplete = login ? 'current-password' : 'new-password';
  $('authError').textContent = '';
}
$('toggleAuth').onclick = () => setMode(mode === 'login' ? 'signup' : 'login');

$('authForm').onsubmit = async e => {
  e.preventDefault();
  const username = $('username').value.trim(), password = $('password').value;
  let body = { username, password };
  if (mode === 'signup') {
    const email = $('email').value.trim();
    if (!/^[^\s@]+@gmail\.com$/i.test(email)) return $('authError').textContent = 'Use a valid Gmail address (name@gmail.com)';
    body = { email, username, last_name: $('lastName').value.trim(), password };
  }
  $('authBtn').disabled = true;
  try { const u = await api(mode, 'POST', body); $('password').value = ''; startChat(u); }
  catch (err) { $('authError').textContent = err.message; }
  $('authBtn').disabled = false;
};

function startChat(u) {
  me = u;
  const box = $('meBox'); box.innerHTML = '';
  const t = document.createElement('div');
  t.innerHTML = '<p class="text-xs text-ube-100">Signed in as</p><p class="font-medium"></p>';
  t.lastChild.textContent = fullName(u);
  box.append(avatar(u.username), t);
  show('chat'); closeConv(); loadUsers(); connectWS();
}

function connectWS() {
  if (ws) { ws.onclose = null; ws.close(); }
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { loadConvs(); loadMessages(); };
  ws.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.type === 'presence') { online = new Set(d.online); loadUsers(); updateHeader(); return; }
    loadConvs();
    if (cur && (d.type === 'refresh' || d.conversation_id === cur.id)) loadMessages();
  };
  ws.onclose = () => { if (me) setTimeout(connectWS, 2000); };
}

async function loadUsers() { try { users = await api('users'); renderList(); } catch {} }
async function loadConvs() {
  try {
    convs = await api('conversations');
    if (cur) { const c = convs.find(x => x.id === cur.id); if (c) cur = c; }
    renderList(); updateHeader();
  } catch {}
}

function row(av, title, sub, badge, active, onclick) {
  const li = document.createElement('li');
  li.className = 'px-4 py-3 cursor-pointer hover:bg-white/10 flex items-center gap-3' + (active ? ' bg-white/10' : '');
  const t = document.createElement('div'); t.className = 'flex-1 min-w-0';
  const a = document.createElement('p'); a.className = 'truncate'; a.textContent = title;
  const b = document.createElement('p'); b.className = 'truncate text-xs text-ube-100/70'; b.textContent = sub || '';
  t.append(a, b); li.append(av, t);
  if (badge > 0) {
    const x = document.createElement('span'); x.textContent = badge;
    x.className = 'bg-mango text-ube-900 text-xs font-semibold rounded-full px-2 py-0.5';
    li.appendChild(x);
  }
  li.onclick = onclick; return li;
}

function renderList() {
  const qy = $('search').value.trim().toLowerCase(), ul = $('list'); ul.innerHTML = '';
  convs.filter(c => convName(c).toLowerCase().includes(qy)).forEach(c => {
    const av = c.is_group ? avatar(c.name, 'w-10 h-10', undefined, true) : avatar(other(c).username, 'w-10 h-10', online.has(other(c).id));
    const active = cur && cur.id === c.id;
    ul.appendChild(row(av, convName(c), c.last_body, active ? 0 : c.unread, active, () => openConv(c)));
  });
  const peers = new Set(convs.filter(c => !c.is_group).map(c => other(c).id));
  const people = users.filter(u => !peers.has(u.id) && fullName(u).toLowerCase().includes(qy));
  if (people.length) {
    const hd = document.createElement('li');
    hd.textContent = 'People'; hd.className = 'px-4 pt-4 pb-1 text-xs text-ube-100/70';
    ul.appendChild(hd);
    people.forEach(u => ul.appendChild(row(avatar(u.username, 'w-10 h-10', online.has(u.id)), fullName(u), '', 0, false, () => openPerson(u))));
  }
}
$('search').oninput = renderList;

async function openPerson(u) {
  try {
    const { id } = await api('direct', 'POST', { user_id: u.id });
    await loadConvs();
    const c = convs.find(x => x.id === id);
    if (c) openConv(c);
  } catch {}
}

function updateHeader() {
  if (!cur) return;
  $('peerName').textContent = convName(cur);
  $('peerStatus').textContent = cur.is_group ? cur.members.map(m => m.username).join(', ') : (online.has(other(cur).id) ? 'Online' : 'Offline');
  $('leaveBtn').style.display = cur.is_group ? '' : 'none';
}

function openConv(c) {
  cur = c; lastSig = ''; lastMsgs = []; pickerFor = null; replyTo = null; updateReplyBar();
  const pa = $('peerAvatar'); pa.innerHTML = '';
  pa.appendChild(c.is_group ? avatar(c.name, 'w-10 h-10', undefined, true) : avatar(other(c).username));
  $('empty').style.display = 'none'; $('convo').style.display = 'flex';
  $('sidebar').classList.add('hidden'); $('main').classList.remove('hidden');
  $('messages').innerHTML = '';
  updateHeader(); renderList(); loadMessages();
}

function closeConv() {
  cur = null; pickerFor = null; replyTo = null;
  $('empty').style.display = ''; $('convo').style.display = 'none';
  $('sidebar').classList.remove('hidden'); $('main').classList.add('hidden');
  loadConvs();
}
$('backBtn').onclick = closeConv;

$('leaveBtn').onclick = async () => {
  if (!cur || !confirm('Leave this group?')) return;
  try { await api('conversations/' + cur.id + '/leave', 'POST'); } catch {}
  closeConv();
};

function updateReplyBar() {
  $('replyBar').style.display = replyTo ? 'flex' : 'none';
  if (replyTo) $('replyText').textContent = 'Replying to ' + replyTo.username + ': ' + replyTo.body;
}
$('replyCancel').onclick = () => { replyTo = null; updateReplyBar(); };

async function loadMessages() {
  if (!cur) return;
  const id = cur.id;
  let msgs;
  try { msgs = await api('conversations/' + id + '/messages'); }
  catch (e) { if (e.message === 'Not allowed') closeConv(); return; }
  if (!cur || cur.id !== id) return;
  const sig = JSON.stringify(msgs);
  if (sig === lastSig) return;
  const stick = lastSig === '' || msgs.length !== lastMsgs.length;
  lastSig = sig; lastMsgs = msgs;
  renderMessages(stick);
}

async function react(id, emoji) {
  pickerFor = null;
  try { await api('messages/' + id + '/react', 'POST', { emoji }); } catch {}
  loadMessages();
}

function renderMessages(stick) {
  const box = $('messages'), keep = box.scrollTop;
  box.innerHTML = '';
  if (!lastMsgs.length) box.innerHTML = '<p class="m-auto text-sm text-ube-700/70">No messages yet. Say hi.</p>';
  lastMsgs.forEach(m => {
    const mine = m.sender_id === me.id;
    const wrap = document.createElement('div');
    wrap.className = 'max-w-[75%] flex flex-col ' + (mine ? 'self-end items-end' : 'self-start items-start');
    if (cur.is_group && !mine) {
      const who = document.createElement('span');
      who.textContent = m.username; who.className = 'text-xs text-slate-500 mb-0.5';
      wrap.appendChild(who);
    }
    const bubble = document.createElement('div');
    bubble.className = 'px-4 py-2 break-words whitespace-pre-wrap rounded-2xl cursor-pointer ' +
      (mine ? 'bg-ube-700 text-white rounded-br-md' : 'bg-white border border-ube-100 rounded-bl-md');
    if (m.reply_to && m.reply_body) {
      const qt = document.createElement('div');
      qt.textContent = (m.reply_user || '') + ': ' + m.reply_body;
      qt.className = 'text-xs mb-1 pl-2 border-l-2 truncate opacity-80 ' + (mine ? 'border-white/60' : 'border-ube-600');
      bubble.appendChild(qt);
    }
    bubble.appendChild(document.createTextNode(m.body));
    bubble.onclick = () => { pickerFor = pickerFor === m.id ? null : m.id; renderMessages(false); };
    wrap.appendChild(bubble);
    if (pickerFor === m.id) {
      const bar = document.createElement('div');
      bar.className = 'flex items-center gap-1 mt-1 bg-white border border-ube-100 rounded-full px-2 py-1';
      EMOJIS.forEach(e => {
        const b = document.createElement('button');
        b.textContent = e; b.className = 'text-xl px-1 hover:scale-125';
        b.onclick = () => react(m.id, e);
        bar.appendChild(b);
      });
      const rb = document.createElement('button');
      rb.innerHTML = icon('reply', 'w-4 h-4') + '<span>Reply</span>'; rb.className = 'flex items-center gap-1 text-sm text-ube-700 font-medium px-2';
      rb.onclick = () => { replyTo = m; pickerFor = null; updateReplyBar(); renderMessages(false); $('msgInput').focus(); };
      bar.appendChild(rb);
      wrap.appendChild(bar);
    }
    const counts = {};
    (m.reactions || []).forEach(r => {
      const x = counts[r.emoji] || (counts[r.emoji] = { n: 0, mine: false });
      x.n++; if (r.user_id === me.id) x.mine = true;
    });
    const keys = Object.keys(counts);
    if (keys.length) {
      const rowEl = document.createElement('div');
      rowEl.className = 'flex gap-1 mt-1 flex-wrap';
      keys.forEach(e => {
        const chip = document.createElement('button');
        chip.textContent = e + ' ' + counts[e].n;
        chip.className = 'text-xs rounded-full px-2 py-0.5 border ' + (counts[e].mine ? 'bg-ube-100 border-ube-600' : 'bg-white border-ube-100');
        chip.onclick = () => react(m.id, e);
        rowEl.appendChild(chip);
      });
      wrap.appendChild(rowEl);
    }
    const time = document.createElement('span');
    time.textContent = new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    time.className = 'text-xs text-slate-400 mt-0.5';
    wrap.appendChild(time);
    box.appendChild(wrap);
  });
  box.scrollTop = stick ? box.scrollHeight : keep;
}

$('composer').onsubmit = async e => {
  e.preventDefault();
  const text = $('msgInput').value.trim();
  if (!text || !cur) return;
  const body = { body: text, reply_to: replyTo ? replyTo.id : null };
  $('msgInput').value = ''; replyTo = null; updateReplyBar();
  try { await api('conversations/' + cur.id + '/messages', 'POST', body); } catch {}
  loadMessages();
};

$('newGroup').onclick = () => {
  $('groupName').value = ''; $('groupError').textContent = '';
  const box = $('groupMembers'); box.innerHTML = '';
  users.forEach(u => {
    const l = document.createElement('label'); l.className = 'flex items-center gap-2 py-1';
    const c = document.createElement('input'); c.type = 'checkbox'; c.value = u.id;
    const s = document.createElement('span'); s.textContent = fullName(u);
    l.append(c, s); box.appendChild(l);
  });
  $('groupModal').style.display = 'grid';
};
$('groupCancel').onclick = () => { $('groupModal').style.display = 'none'; };
$('groupForm').onsubmit = async e => {
  e.preventDefault();
  const ids = [...document.querySelectorAll('#groupMembers input:checked')].map(i => Number(i.value));
  try {
    const { id } = await api('groups', 'POST', { name: $('groupName').value, member_ids: ids });
    $('groupModal').style.display = 'none';
    await loadConvs();
    const c = convs.find(x => x.id === id);
    if (c) openConv(c);
  } catch (err) { $('groupError').textContent = err.message; }
};

$('logoutBtn').onclick = async () => {
  await api('logout', 'POST');
  me = null; if (ws) { ws.onclose = null; ws.close(); }
  setMode('login'); show('auth');
};

(async () => {
  setMode('login');
  try { startChat(await api('me')); } catch { show('auth'); }
})();
