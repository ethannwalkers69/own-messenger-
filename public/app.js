const $ = id => document.getElementById(id);
let mode = 'login', myId = null, peerId = null, msgTimer = null, userTimer = null, lastCount = -1;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function show(view) {
  $('auth').style.display = view === 'auth' ? 'grid' : 'none';
  $('chat').style.display = view === 'chat' ? 'flex' : 'none';
}

function setMode(m) {
  mode = m;
  const login = m === 'login';
  $('authTitle').textContent = login ? 'Log in' : 'Sign up';
  $('authBtn').textContent = login ? 'Log in' : 'Create account';
  $('toggleAuth').textContent = login ? 'Create an account' : 'I already have an account';
  $('authError').textContent = '';
}
$('toggleAuth').onclick = () => setMode(mode === 'login' ? 'signup' : 'login');

async function submitAuth() {
  try {
    const u = await api(mode, 'POST', { username: $('username').value.trim(), password: $('password').value });
    $('password').value = '';
    startChat(u);
  } catch (e) { $('authError').textContent = e.message; }
}
$('authBtn').onclick = submitAuth;
$('password').onkeydown = e => { if (e.key === 'Enter') submitAuth(); };

function startChat(u) {
  myId = u.id; peerId = null;
  $('me').textContent = u.username;
  $('peer').textContent = 'Pick someone to chat with';
  $('composer').style.display = 'none';
  $('messages').innerHTML = '';
  show('chat');
  loadUsers();
  userTimer = setInterval(loadUsers, 4000);
}

let allUsers = [];
async function loadUsers() {
  allUsers = await api('users');
  renderUsers();
}

function renderUsers() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('users'); ul.innerHTML = '';
  allUsers.filter(u => u.username.toLowerCase().includes(q)).forEach(u => {
    const li = document.createElement('li');
    li.className = 'px-4 py-3 cursor-pointer hover:bg-slate-800 flex items-center gap-2' + (u.id === peerId ? ' bg-slate-800' : '');
    const dot = document.createElement('span');
    dot.className = 'w-2.5 h-2.5 rounded-full ' + (u.online ? 'bg-green-400' : 'bg-slate-600');
    const name = document.createElement('span');
    name.textContent = u.username; name.className = 'flex-1 truncate';
    li.append(dot, name);
    if (u.unread > 0 && u.id !== peerId) {
      const badge = document.createElement('span');
      badge.textContent = u.unread;
      badge.className = 'bg-teal-500 text-white text-xs rounded-full px-2 py-0.5';
      li.appendChild(badge);
    }
    li.onclick = () => openPeer(u);
    ul.appendChild(li);
  });
}
$('search').oninput = renderUsers;

function openPeer(u) {
  peerId = u.id; lastCount = -1;
  $('peer').textContent = u.username;
  $('composer').style.display = 'flex';
  loadMessages().then(loadUsers);
  clearInterval(msgTimer);
  msgTimer = setInterval(loadMessages, 2500);
}

async function loadMessages() {
  if (!peerId) return;
  const msgs = await api('messages/' + peerId);
  if (msgs.length === lastCount) return;
  lastCount = msgs.length;
  const box = $('messages'); box.innerHTML = '';
  msgs.forEach(m => {
    const d = document.createElement('div');
    const mine = m.sender_id === myId;
    d.textContent = m.body;
    d.className = 'max-w-[70%] px-3 py-2 rounded-lg break-words ' +
      (mine ? 'self-end bg-teal-700 text-white' : 'self-start bg-white border');
    box.appendChild(d);
  });
  box.scrollTop = box.scrollHeight;
}

async function sendMessage() {
  const text = $('msgInput').value.trim();
  if (!text || !peerId) return;
  $('msgInput').value = '';
  await api('messages/' + peerId, 'POST', { body: text });
  loadMessages();
}
$('sendBtn').onclick = sendMessage;
$('msgInput').onkeydown = e => { if (e.key === 'Enter') sendMessage(); };

$('logoutBtn').onclick = async () => {
  await api('logout', 'POST');
  clearInterval(msgTimer); clearInterval(userTimer);
  setMode('login'); show('auth');
};

(async () => {
  try { startChat(await api('me')); }
  catch { setMode('login'); show('auth'); }
})();
