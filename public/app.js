const $ = id => document.getElementById(id);
const COLORS = ['bg-violet-500', 'bg-fuchsia-600', 'bg-sky-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-500'];
let mode = 'login', me = null, peer = null, allUsers = [], msgTimer = null, userTimer = null, lastCount = -1;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const fullName = u => (u.username + ' ' + (u.last_name || '')).trim();

function avatar(name, size = 'w-10 h-10', online) {
  const wrap = document.createElement('div');
  wrap.className = 'relative shrink-0';
  const d = document.createElement('div');
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  d.textContent = name[0].toUpperCase();
  d.className = size + ' rounded-full grid place-items-center font-semibold text-white ' + COLORS[h];
  wrap.appendChild(d);
  if (online !== undefined) {
    const dot = document.createElement('span');
    dot.className = 'absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-ube-900 ' + (online ? 'bg-green-400' : 'bg-slate-500');
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
  show('chat'); closePeer();
  loadUsers(); userTimer = setInterval(loadUsers, 4000);
}

async function loadUsers() {
  allUsers = await api('users');
  if (peer) { const p = allUsers.find(x => x.id === peer.id); if (p) { peer = p; $('peerStatus').textContent = p.online ? 'Online' : 'Offline'; } }
  renderUsers();
}

function renderUsers() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('users'); ul.innerHTML = '';
  allUsers.filter(u => fullName(u).toLowerCase().includes(q)).forEach(u => {
    const li = document.createElement('li');
    li.className = 'px-4 py-3 cursor-pointer hover:bg-white/10 flex items-center gap-3' + (peer && u.id === peer.id ? ' bg-white/10' : '');
    const name = document.createElement('span');
    name.textContent = fullName(u); name.className = 'flex-1 truncate';
    li.append(avatar(u.username, 'w-10 h-10', u.online), name);
    if (u.unread > 0 && !(peer && u.id === peer.id)) {
      const b = document.createElement('span');
      b.textContent = u.unread; b.className = 'bg-mango text-ube-900 text-xs font-semibold rounded-full px-2 py-0.5';
      li.appendChild(b);
    }
    li.onclick = () => openPeer(u);
    ul.appendChild(li);
  });
}
$('search').oninput = renderUsers;

function openPeer(u) {
  peer = u; lastCount = -1;
  $('peerName').textContent = fullName(u);
  $('peerStatus').textContent = u.online ? 'Online' : 'Offline';
  const pa = $('peerAvatar'); pa.innerHTML = ''; pa.appendChild(avatar(u.username));
  $('empty').style.display = 'none'; $('convo').style.display = 'flex';
  $('sidebar').classList.add('hidden'); $('main').classList.remove('hidden');
  $('messages').innerHTML = '';
  loadMessages().then(loadUsers);
  clearInterval(msgTimer); msgTimer = setInterval(loadMessages, 2500);
}

function closePeer() {
  peer = null; clearInterval(msgTimer);
  $('empty').style.display = ''; $('convo').style.display = 'none';
  $('sidebar').classList.remove('hidden'); $('main').classList.add('hidden');
  renderUsers();
}
$('backBtn').onclick = closePeer;

async function loadMessages() {
  if (!peer) return;
  const id = peer.id;
  const msgs = await api('messages/' + id);
  if (!peer || peer.id !== id || msgs.length === lastCount) return;
  lastCount = msgs.length;
  const box = $('messages'); box.innerHTML = '';
  if (!msgs.length) box.innerHTML = '<p class="m-auto text-sm text-ube-700/70">No messages yet. Say hi.</p>';
  msgs.forEach(m => {
    const mine = m.sender_id === me.id;
    const wrap = document.createElement('div');
    wrap.className = 'max-w-[75%] flex flex-col ' + (mine ? 'self-end items-end' : 'self-start items-start');
    const bubble = document.createElement('p');
    bubble.textContent = m.body;
    bubble.className = 'px-4 py-2 break-words whitespace-pre-wrap rounded-2xl ' +
      (mine ? 'bg-ube-700 text-white rounded-br-md' : 'bg-white border border-ube-100 rounded-bl-md');
    const time = document.createElement('span');
    time.textContent = new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    time.className = 'text-xs text-slate-400 mt-0.5';
    wrap.append(bubble, time); box.appendChild(wrap);
  });
  box.scrollTop = box.scrollHeight;
}

$('composer').onsubmit = async e => {
  e.preventDefault();
  const text = $('msgInput').value.trim();
  if (!text || !peer) return;
  $('msgInput').value = '';
  await api('messages/' + peer.id, 'POST', { body: text });
  loadMessages();
};

$('logoutBtn').onclick = async () => {
  await api('logout', 'POST');
  clearInterval(msgTimer); clearInterval(userTimer);
  setMode('login'); show('auth');
};

(async () => {
  setMode('login');
  try { startChat(await api('me')); } catch { show('auth'); }
})();
