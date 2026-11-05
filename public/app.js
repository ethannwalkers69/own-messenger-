const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const COLORS = ['#1456D8', '#E8346B', '#14A66B', '#F28C0F', '#7A3FD1', '#0E9AA7'];
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
let mode = 'login', me = null, chat = null, allUsers = [], allGroups = [], tab = 'people';
let msgTimer = null, userTimer = null, lastSig = '', replyTo = null, openMsg = null;
let typingTimer = null, lastTyped = 0, pendingImage = null, seenId = null;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const fullName = u => (u.username + ' ' + (u.last_name || '')).trim();
const hashColor = name => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % COLORS.length; return COLORS[h]; };
const colorOf = u => u.color || hashColor(u.username || '?');

function avatar(u, size = 'w-10 h-10', online) {
  const wrap = el('div', 'relative shrink-0');
  const d = el('div', size + ' rounded-full overflow-hidden grid place-items-center font-semibold text-white');
  if (u.avatar) { const i = new Image(); i.src = u.avatar; i.alt = ''; i.className = 'w-full h-full object-cover'; d.appendChild(i); }
  else { d.textContent = (u.username || '?')[0].toUpperCase(); d.style.background = colorOf(u); }
  wrap.appendChild(d);
  if (online !== undefined) wrap.appendChild(el('span', 'absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-ink ' + (online ? 'bg-leaf' : 'bg-mist/60')));
  return wrap;
}

function show(view) {
  $('auth').style.display = view === 'auth' ? '' : 'none';
  $('chat').style.display = view === 'chat' ? 'flex' : 'none';
}

/* ---------- modal ---------- */
function modal(build) {
  const box = $('modalBox'); box.innerHTML = ''; build(box);
  $('modal').classList.remove('hidden'); $('modal').classList.add('flex');
}
function closeModal() { $('modal').classList.add('hidden'); $('modal').classList.remove('flex'); }
$('modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- auth ---------- */
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
  try { await api(mode, 'POST', body); $('password').value = ''; startChat(await api('me')); }
  catch (err) { $('authError').textContent = err.message; }
  $('authBtn').disabled = false;
};

function renderMe() {
  const box = $('meBox'); box.innerHTML = '';
  const t = el('div', 'min-w-0');
  t.append(el('p', 'text-xs text-mist', 'Signed in as'), el('p', 'font-medium truncate', fullName(me)));
  box.append(avatar(me), t);
}

function startChat(u) {
  me = u; renderMe();
  show('chat'); closeChat(); setTab('people');
  loadUsers(); clearInterval(userTimer); userTimer = setInterval(loadUsers, 4000);
}

/* ---------- profile ---------- */
function resizeImage(file) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas');
      c.width = c.height = 128;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => no(new Error('Could not read that image'));
    img.src = URL.createObjectURL(file);
  });
}

function editProfile() {
  let photo = me.avatar || '', color = me.color || hashColor(me.username);
  modal(b => {
    b.append(el('h2', 'font-display text-lg font-medium mb-4', 'Your profile'));
    const holder = el('div');
    const draw = () => { holder.innerHTML = ''; holder.appendChild(avatar({ username: me.username, avatar: photo, color }, 'w-20 h-20 text-2xl')); };
    draw();
    const file = el('input', 'text-sm w-full'); file.type = 'file'; file.accept = 'image/*';
    const err = el('p', 'text-sm text-hib min-h-5');
    file.onchange = async () => { try { if (file.files[0]) { photo = await resizeImage(file.files[0]); draw(); } } catch (x) { err.textContent = x.message; } };
    const rm = el('button', 'text-sm text-hib mt-1', 'Remove photo'); rm.type = 'button';
    rm.onclick = () => { photo = ''; draw(); };
    const side = el('div', 'flex-1 min-w-0'); side.append(file, rm);
    const top = el('div', 'flex items-center gap-4 mb-4'); top.append(holder, side);

    const swatches = el('div', 'flex gap-2 mb-4');
    COLORS.forEach(c => {
      const s = el('button', 'w-8 h-8 rounded-full border-2 border-white ring-1 ring-line'); s.type = 'button'; s.style.background = c;
      s.setAttribute('aria-label', 'Color ' + c); s.onclick = () => { color = c; draw(); };
      swatches.appendChild(s);
    });
    const last = el('input', 'field mb-3'); last.value = me.last_name || ''; last.placeholder = 'Last name';
    const bio = el('textarea', 'field mb-3 resize-none'); bio.rows = 3; bio.maxLength = 160; bio.value = me.bio || ''; bio.placeholder = 'Short bio';
    const row = el('div', 'flex gap-2 justify-end');
    const cancel = el('button', 'px-4 py-2.5 text-sm text-ink/70', 'Cancel'); cancel.type = 'button'; cancel.onclick = closeModal;
    const save = el('button', 'btn', 'Save changes'); save.type = 'button';
    save.onclick = async () => {
      save.disabled = true;
      try {
        await api('profile', 'PUT', { last_name: last.value, bio: bio.value, color, avatar: photo });
        me = await api('me'); renderMe(); closeModal(); loadUsers();
      } catch (x) { err.textContent = x.message; save.disabled = false; }
    };
    row.append(cancel, save);
    b.append(top, el('p', 'lbl', 'Color when no photo'), swatches, last, bio, err, row);
  });
}
$('meBox').onclick = editProfile;

function viewProfile(u) {
  modal(b => {
    const top = el('div', 'flex flex-col items-center text-center gap-2');
    top.append(avatar(u, 'w-24 h-24 text-3xl', u.online), el('p', 'font-display text-lg font-medium', fullName(u)),
      el('p', 'text-sm text-ink/60', u.online ? 'Online' : 'Offline'),
      el('p', 'text-sm whitespace-pre-wrap', u.bio || 'No bio yet.'));
    const close = el('button', 'btn mt-5 w-full', 'Close'); close.onclick = closeModal;
    b.append(top, close);
  });
}

/* ---------- groups ---------- */
function newGroup() {
  const picked = new Set();
  modal(b => {
    b.append(el('h2', 'font-display text-lg font-medium mb-4', 'New group'));
    const name = el('input', 'field mb-3'); name.placeholder = 'Group name'; name.maxLength = 40;
    const list = el('div', 'max-h-56 overflow-y-auto border border-line rounded-xl divide-y divide-line mb-3');
    allUsers.forEach(u => {
      const row = el('label', 'flex items-center gap-3 px-3 py-2 cursor-pointer');
      const cb = el('input'); cb.type = 'checkbox'; cb.onchange = () => cb.checked ? picked.add(u.id) : picked.delete(u.id);
      row.append(cb, avatar(u, 'w-8 h-8 text-sm'), el('span', 'truncate', fullName(u)));
      list.appendChild(row);
    });
    const err = el('p', 'text-sm text-hib min-h-5');
    const row = el('div', 'flex gap-2 justify-end');
    const cancel = el('button', 'px-4 py-2.5 text-sm text-ink/70', 'Cancel'); cancel.type = 'button'; cancel.onclick = closeModal;
    const go = el('button', 'btn', 'Create group'); go.type = 'button';
    go.onclick = async () => {
      go.disabled = true;
      try { const g = await api('groups', 'POST', { name: name.value, members: [...picked] }); closeModal(); await loadUsers(); const full = allGroups.find(x => x.id === g.id); if (full) openChat('group', full); }
      catch (x) { err.textContent = x.message; go.disabled = false; }
    };
    row.append(cancel, go);
    b.append(name, list, err, row);
  });
}
$('newGroupBtn').onclick = newGroup;

async function groupAct(path, method, body, ask) {
  if (ask && !confirm(ask)) return;
  try { await api(path, method, body); await loadUsers(); groupInfo(); } catch (e) { alert(e.message); }
}

async function groupInfo() {
  if (!chat || chat.type !== 'group') return;
  const gid = chat.id;
  let members;
  try { members = await api(`groups/${gid}/members`); } catch (e) { return alert(e.message); }
  const iAmLeader = members.some(m => m.id === me.id && m.is_leader);
  const mini = (label, cls, fn) => { const b = el('button', 'text-xs px-2 py-1 rounded-lg border border-line ' + cls, label); b.type = 'button'; b.onclick = fn; return b; };
  modal(b => {
    b.append(el('h2', 'font-display text-lg font-medium', chat.name), el('p', 'text-sm text-ink/60 mb-4', members.length + ' members'));
    if (iAmLeader) {
      const row = el('div', 'flex gap-2 mb-4');
      const nm = el('input', 'field'); nm.value = chat.name; nm.maxLength = 40; nm.setAttribute('aria-label', 'Group name');
      const rn = el('button', 'btn shrink-0', 'Rename'); rn.type = 'button';
      rn.onclick = () => nm.value.trim() && nm.value.trim() !== chat.name && groupAct(`groups/${gid}`, 'PUT', { name: nm.value });
      row.append(nm, rn); b.appendChild(row);
    }
    const list = el('ul', 'divide-y divide-line border border-line rounded-xl mb-4');
    members.forEach(m => {
      const li = el('li', 'flex items-center gap-2 px-3 py-2');
      const nm = el('div', 'flex-1 min-w-0');
      nm.append(el('p', 'truncate text-sm font-medium', fullName(m) + (m.id === me.id ? ' (you)' : '')));
      if (m.is_leader) nm.append(el('p', 'text-xs font-semibold text-hib', 'Leader'));
      li.append(avatar(m, 'w-9 h-9 text-sm', m.online), nm);
      if (iAmLeader && m.id !== me.id) {
        li.append(
          mini('Make leader', 'text-ocean', () => groupAct(`groups/${gid}/leader`, 'POST', { user_id: m.id }, `Make ${fullName(m)} the leader? You will lose leader rights.`)),
          mini('Kick', 'text-hib', () => groupAct(`groups/${gid}/members/${m.id}`, 'DELETE', undefined, `Kick ${fullName(m)} from this group?`)));
      }
      list.appendChild(li);
    });
    b.appendChild(list);

    const inGroup = new Set(members.map(m => m.id));
    const candidates = allUsers.filter(u => !inGroup.has(u.id));
    if (iAmLeader && candidates.length) {
      const picked = new Set();
      b.appendChild(el('p', 'lbl', 'Add people'));
      const add = el('div', 'max-h-40 overflow-y-auto border border-line rounded-xl divide-y divide-line mb-2');
      candidates.forEach(u => {
        const row = el('label', 'flex items-center gap-3 px-3 py-2 cursor-pointer');
        const cb = el('input'); cb.type = 'checkbox'; cb.onchange = () => cb.checked ? picked.add(u.id) : picked.delete(u.id);
        row.append(cb, avatar(u, 'w-8 h-8 text-sm'), el('span', 'truncate text-sm', fullName(u)));
        add.appendChild(row);
      });
      const addBtn = el('button', 'btn w-full mb-4', 'Add selected'); addBtn.type = 'button';
      addBtn.onclick = () => picked.size && groupAct(`groups/${gid}/members`, 'POST', { members: [...picked] });
      b.append(add, addBtn);
    }

    const leave = el('button', 'w-full rounded-xl border border-hib text-hib font-semibold py-2.5 mb-2', 'Leave group'); leave.type = 'button';
    leave.onclick = async () => {
      const ask = iAmLeader ? 'You are the leader. Leadership will pass to the longest-standing member. Leave this group?' : 'Leave this group?';
      if (!confirm(ask)) return;
      try { await api(`groups/${gid}/leave`, 'POST'); closeModal(); closeChat(); loadUsers(); } catch (e) { alert(e.message); }
    };
    const close = el('button', 'w-full py-2.5 text-sm text-ink/70', 'Close'); close.type = 'button'; close.onclick = closeModal;
    b.append(leave, close);
  });
}

/* ---------- sidebar ---------- */
function setTab(t) {
  tab = t;
  $('tabPeople').className = 'flex-1 rounded-lg py-1.5 text-sm font-medium ' + (t === 'people' ? 'bg-sun text-ink' : 'text-mist hover:bg-white/10');
  $('tabGroups').className = 'flex-1 rounded-lg py-1.5 text-sm font-medium ' + (t === 'groups' ? 'bg-sun text-ink' : 'text-mist hover:bg-white/10');
  $('newGroupBtn').classList.toggle('hidden', t !== 'groups');
  renderList();
}
$('tabPeople').onclick = () => setTab('people');
$('tabGroups').onclick = () => setTab('groups');

async function loadUsers() {
  [allUsers, allGroups] = await Promise.all([api('users'), api('groups')]);
  if (chat) {
    const o = (chat.type === 'group' ? allGroups : allUsers).find(x => x.id === chat.id);
    if (o) { chat.obj = o; chat.name = chat.type === 'group' ? o.name : fullName(o); refreshHeader(); }
  }
  renderList();
}

function badge(n) { return el('span', 'bg-sun text-ink text-xs font-semibold rounded-full px-2 py-0.5', n); }

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('users'); ul.innerHTML = '';
  const active = o => chat && chat.type === (tab === 'groups' ? 'group' : 'dm') && chat.id === o.id;
  const items = tab === 'groups' ? allGroups.filter(g => g.name.toLowerCase().includes(q)) : allUsers.filter(u => fullName(u).toLowerCase().includes(q));
  if (!items.length) ul.appendChild(el('li', 'px-4 py-6 text-sm text-mist', tab === 'groups' ? 'No groups yet. Tap New group to start one.' : 'No one found.'));
  items.forEach(o => {
    const li = el('li', 'px-4 py-3 cursor-pointer hover:bg-white/10 flex items-center gap-3' + (active(o) ? ' bg-white/10' : ''));
    const name = el('span', 'flex-1 truncate', tab === 'groups' ? o.name : fullName(o));
    li.append(tab === 'groups' ? avatar({ username: o.name }, 'w-10 h-10') : avatar(o, 'w-10 h-10', o.online), name);
    if (o.unread > 0 && !active(o)) li.appendChild(badge(o.unread));
    li.onclick = () => openChat(tab === 'groups' ? 'group' : 'dm', o);
    ul.appendChild(li);
  });
}
$('search').oninput = renderList;

/* ---------- chat window ---------- */
function refreshHeader() {
  $('peerName').textContent = chat.name;
  $('peerStatus').textContent = chat.type === 'group' ? chat.obj.members + ' members' : (chat.obj.online ? 'Online' : 'Offline');
}

function openChat(type, o) {
  chat = { type, id: o.id, obj: o, name: type === 'group' ? o.name : fullName(o) };
  lastSig = ''; openMsg = null; setReply(null);
  refreshHeader();
  const pa = $('peerAvatar'); pa.innerHTML = ''; pa.appendChild(avatar(type === 'group' ? { username: o.name } : o));
  $('empty').style.display = 'none'; $('convo').style.display = 'flex';
  $('sidebar').classList.add('hidden'); $('main').classList.remove('hidden');
  $('messages').innerHTML = '';
  loadMessages().then(loadUsers);
  clearInterval(msgTimer); msgTimer = setInterval(loadMessages, 2500);
  $('typing').textContent = ''; clearInterval(typingTimer); typingTimer = setInterval(pollTyping, 1500);
}

function closeChat() {
  chat = null; clearInterval(msgTimer); clearInterval(typingTimer); $('typing').textContent = ''; setReply(null); setImage(null);
  $('empty').style.display = ''; $('convo').style.display = 'none';
  $('sidebar').classList.remove('hidden'); $('main').classList.add('hidden');
  renderList();
}
$('backBtn').onclick = closeChat;
$('peerBtn').onclick = () => { if (!chat) return; chat.type === 'dm' ? viewProfile(chat.obj) : groupInfo(); };

const msgPath = () => chat.type === 'group' ? `groups/${chat.id}/messages` : `messages/${chat.id}`;

function setReply(r) {
  replyTo = r;
  $('replyBar').classList.toggle('hidden', !r); $('replyBar').classList.toggle('flex', !!r);
  if (r) { $('replyName').textContent = r.name; $('replyText').textContent = r.body; $('msgInput').focus(); }
}
$('replyCancel').onclick = () => setReply(null);

function jump(id) {
  const t = $('messages').querySelector(`[data-id="${id}"]`);
  if (!t) return;
  t.scrollIntoView({ block: 'center', behavior: 'smooth' });
  t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
}

async function react(id, emoji) {
  try { await api(`messages/${id}/react`, 'POST', { emoji }); lastSig = ''; loadMessages(); } catch {}
}

async function loadMessages() {
  if (!chat) return;
  const { type, id } = chat;
  let msgs;
  try { msgs = await api(msgPath()); }
  catch (e) { if (e.message === 'Not in this group') { closeModal(); closeChat(); loadUsers(); } return; }
  if (!chat || chat.type !== type || chat.id !== id) return;
  const sig = JSON.stringify(msgs);
  if (sig === lastSig) return;
  const first = lastSig === '';
  lastSig = sig;
  const box = $('messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 100;
  box.innerHTML = '';
  if (!msgs.length) box.appendChild(el('p', 'm-auto text-sm text-ink/60', 'No messages yet. Say hi.'));
  const lastMine = [...msgs].reverse().find(m => m.sender_id === me.id && !m.system && !m.deleted_at);
  seenId = chat.type === 'dm' && lastMine && lastMine.read_at ? lastMine.id : null;
  msgs.forEach(m => box.appendChild(renderMessage(m)));
  const stick = first || nearBottom;
  if (stick) box.scrollTop = box.scrollHeight;
  box.querySelectorAll('img[data-photo]').forEach(i => { i.onload = () => { if (stick) box.scrollTop = box.scrollHeight; }; });
}

function renderMessage(m) {
  if (m.system) {
    const d = el('div', 'self-center text-xs text-ink/60 bg-ink/5 rounded-full px-3 py-1 text-center max-w-[90%]', m.body);
    d.dataset.id = m.id; return d;
  }
  const mine = m.sender_id === me.id;
  const row = el('div', 'msg max-w-[80%] flex flex-col ' + (mine ? 'mine self-end items-end' : 'theirs self-start items-start') + (openMsg === m.id ? ' open' : ''));
  row.dataset.id = m.id;
  if (chat.type === 'group' && !mine) row.appendChild(el('span', 'text-xs font-medium text-ocean mb-0.5 ml-1', m.sender_name));
  if (m.deleted_at) {
    row.appendChild(el('div', 'px-3.5 py-2 rounded-2xl border border-dashed border-line text-sm italic text-ink/50', mine ? 'You deleted this message' : 'This message was deleted'));
    return row;
  }

  const bubble = el('div', 'px-3.5 py-2 rounded-2xl break-words whitespace-pre-wrap cursor-pointer ' +
    (mine ? 'bg-ocean text-white rounded-br-sm' : 'bg-white border border-line rounded-bl-sm'));
  if (m.reply_to && m.reply_name) {
    const q = el('div', 'mb-1.5 pl-2 pr-2 py-1 border-l-4 rounded-sm text-sm ' + (mine ? 'border-sun bg-white/15' : 'border-ocean bg-ocean/10'));
    q.append(el('p', 'font-semibold text-xs', m.reply_name), el('p', 'truncate max-w-[220px]', m.reply_body));
    q.onclick = e => { e.stopPropagation(); jump(m.reply_to); };
    bubble.appendChild(q);
  }
  if (m.has_image) {
    const img = new Image(); img.src = `/api/messages/${m.id}/image`; img.alt = 'Photo'; img.loading = 'lazy'; img.dataset.photo = '1';
    img.className = 'block rounded-xl max-w-[240px] max-h-[300px] object-cover cursor-zoom-in' + (m.body ? ' mb-1.5' : '');
    img.onclick = e => { e.stopPropagation(); modal(b => { const big = new Image(); big.src = img.src; big.alt = 'Photo'; big.className = 'w-full rounded-xl'; const c = el('button', 'btn w-full mt-3', 'Close'); c.onclick = closeModal; b.append(big, c); }); };
    bubble.appendChild(img);
  }
  if (m.body) bubble.appendChild(el('span', '', m.body));
  bubble.onclick = () => { row.classList.toggle('open'); openMsg = row.classList.contains('open') ? m.id : null; };
  row.appendChild(bubble);

  const counts = {};
  m.reactions.forEach(r => {
    const c = counts[r.emoji] || (counts[r.emoji] = { n: 0, mine: false });
    c.n++; if (r.user_id === me.id) c.mine = true;
  });
  if (m.reactions.length) {
    const chips = el('div', 'flex flex-wrap gap-1 mt-1');
    Object.entries(counts).forEach(([emoji, c]) => {
      const b = el('button', 'px-1.5 py-0.5 rounded-full text-xs border ' + (c.mine ? 'bg-sun/30 border-sun' : 'bg-white border-line'), emoji + (c.n > 1 ? ' ' + c.n : ''));
      b.type = 'button'; b.onclick = () => react(m.id, emoji);
      chips.appendChild(b);
    });
    row.appendChild(chips);
  }
  row.appendChild(el('span', 'text-xs text-ink/50 mt-0.5',
    new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
    (m.edited_at ? ' · edited' : '') + (m.id === seenId ? ' · Seen' : '')));

  const acts = el('div', 'acts');
  const mk = (label, aria, fn, cls = '') => { const b = el('button', cls, label); b.type = 'button'; b.setAttribute('aria-label', aria); b.onclick = e => { e.stopPropagation(); openMsg = null; row.classList.remove('open'); fn(); }; acts.appendChild(b); };
  EMOJIS.forEach(emoji => mk(emoji, 'React ' + emoji, () => react(m.id, emoji)));
  mk('↩', 'Reply', () => setReply({ id: m.id, name: mine ? 'yourself' : m.sender_name, body: m.body || '📷 Photo' }), 'text-ocean font-semibold');
  if (mine) {
    mk('✎', 'Edit', async () => {
      const t = prompt('Edit message', m.body);
      if (t === null || !t.trim() || t.trim() === m.body) return;
      try { await api('messages/' + m.id, 'PUT', { body: t }); lastSig = ''; loadMessages(); } catch (x) { alert(x.message); }
    });
    mk('🗑', 'Delete', async () => {
      if (!confirm('Delete this message for everyone?')) return;
      try { await api('messages/' + m.id, 'DELETE'); lastSig = ''; loadMessages(); } catch (x) { alert(x.message); }
    });
  }
  row.appendChild(acts);
  return row;
}

function shrinkImage(file, max = 1280) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      const out = c.toDataURL('image/jpeg', 0.8);
      out.length > 1400000 ? no(new Error('Image is too large')) : ok(out);
    };
    img.onerror = () => no(new Error('Could not read that image'));
    img.src = URL.createObjectURL(file);
  });
}

function setImage(data) {
  pendingImage = data || null;
  $('imgBar').classList.toggle('hidden', !data); $('imgBar').classList.toggle('flex', !!data);
  if (data) $('imgPrev').src = data;
}
$('attachBtn').onclick = () => $('fileInput').click();
$('imgCancel').onclick = () => setImage(null);
$('fileInput').onchange = async () => {
  const f = $('fileInput').files[0]; $('fileInput').value = '';
  if (!f) return;
  try { setImage(await shrinkImage(f)); } catch (x) { alert(x.message); }
};

$('msgInput').oninput = () => {
  if (!chat || Date.now() - lastTyped < 2000) return;
  lastTyped = Date.now();
  api('typing', 'POST', { type: chat.type, id: chat.id }).catch(() => {});
};

async function pollTyping() {
  if (!chat) return;
  const { type, id } = chat;
  try {
    const n = await api(`typing?type=${type}&id=${id}`);
    if (!chat || chat.type !== type || chat.id !== id) return;
    $('typing').textContent = !n.length ? '' : n.length > 2 ? 'Several people are typing…' : n.join(' and ') + (n.length > 1 ? ' are' : ' is') + ' typing…';
  } catch {}
}

$('composer').onsubmit = async e => {
  e.preventDefault();
  const text = $('msgInput').value.trim();
  if ((!text && !pendingImage) || !chat) return;
  const reply = replyTo && replyTo.id, image = pendingImage;
  $('msgInput').value = ''; setReply(null); setImage(null);
  try { await api(msgPath(), 'POST', { body: text, reply_to: reply, image }); } catch (err) { alert(err.message); }
  lastSig = ''; await loadMessages();
  $('messages').scrollTop = $('messages').scrollHeight;
};

$('logoutBtn').onclick = async () => {
  await api('logout', 'POST');
  clearInterval(msgTimer); clearInterval(userTimer); clearInterval(typingTimer);
  chat = null; setMode('login'); show('auth');
};

(async () => {
  setMode('login');
  try { startChat(await api('me')); } catch { show('auth'); }
})();
