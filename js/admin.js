import { initializeApp }                                                   from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, setDoc, getDocs, addDoc, deleteDoc,
  query, orderBy, limit, serverTimestamp,
}                                                                            from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL }     from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

// ── TODO: Replace with your Firebase project config ──────────────────────
// Firebase console > Project Settings > Your apps > SDK setup and configuration
const firebaseConfig = {
  apiKey: "AIzaSyAivaXUB_eCki-I6H2kgYasRNoiVNzEaZw",
  authDomain: "video-game-festival.firebaseapp.com",
  projectId: "video-game-festival",
  storageBucket: "video-game-festival.firebasestorage.app",
  messagingSenderId: "962832070480",
  appId: "1:962832070480:web:eaea96982709155f561e55",
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const storage  = getStorage(app);
const provider = new GoogleAuthProvider();

// ── UI refs ───────────────────────────────────────────────────────────────
const authScreen     = document.getElementById('authScreen');
const deniedScreen   = document.getElementById('deniedScreen');
const adminContent   = document.getElementById('adminContent');
const adminUserEmail = document.getElementById('adminUserEmail');

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = 'form-status ' + (type || '');
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ── Auth state listener ───────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  hide(authScreen);
  hide(deniedScreen);
  hide(adminContent);

  if (!user) {
    show(authScreen);
    return;
  }

  // Check if this UID has an admin document
  const adminDoc = await getDoc(doc(db, 'admins', user.uid));
  if (!adminDoc.exists()) {
    show(deniedScreen);
    return;
  }

  // Authorized admin
  adminUserEmail.textContent = user.email;
  show(adminContent);
  populateDatalistsFromFirestore();
  loadGamesTable();
  loadPlayersTable();
  loadHistory();
});

// ── Sign in / out ─────────────────────────────────────────────────────────
document.getElementById('signInBtn').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('Sign-in error', e);
  }
});

function handleSignOut() { signOut(auth); }
document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
document.getElementById('deniedSignOutBtn').addEventListener('click', handleSignOut);

// ── Navbar toggle ─────────────────────────────────────────────────────────
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');
navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => navLinks.classList.remove('open'))
);

// ── Sidebar tab switching ───────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll('.admin-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tabName)
  );
  document.querySelectorAll('.admin-tab-panel').forEach(p =>
    p.classList.toggle('hidden', p.id !== `tab-${tabName}`)
  );
}
document.querySelectorAll('.admin-tab-btn').forEach(b =>
  b.addEventListener('click', () => switchTab(b.dataset.tab))
);

// ── Populate datalists from existing Firestore data ───────────────────────
async function populateDatalistsFromFirestore() {
  try {
    const snap = await getDocs(query(collection(db, 'games'), orderBy('num')));
    const games = snap.docs.map(d => d.data());

    const systems = [...new Set(games.map(g => g.system).filter(Boolean))].sort();
    const genres  = [...new Set(games.map(g => g.genre).filter(Boolean))].sort();

    const sysList = document.getElementById('g-system-list');
    sysList.innerHTML = '';
    systems.forEach(s => { const o = document.createElement('option'); o.value = s; sysList.appendChild(o); });

    const genList = document.getElementById('g-genre-list');
    genList.innerHTML = '';
    genres.forEach(g => { const o = document.createElement('option'); o.value = g; genList.appendChild(o); });
  } catch (e) {
    console.error('Could not populate datalists', e);
  }
}

// ── History logging ─────────────────────────────────────────────────────────
async function logHistory(action, entityType, entityId, entityName, detail) {
  try {
    const user = auth.currentUser;
    await addDoc(collection(db, 'history'), {
      action, entityType, entityId, entityName,
      actorUid: user.uid,
      actorEmail: user.email,
      timestamp: serverTimestamp(),
      detail,
    });
  } catch (e) {
    console.error('History log failed', e);
  }
}

function diffFields(before, after) {
  const changed = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    const bVal = before ? before[k] : undefined;
    const aVal = after ? after[k] : undefined;
    const b = JSON.stringify(bVal);
    const a = JSON.stringify(aVal);
    if (b !== a) {
      changed[k] = {
        before: bVal === undefined ? null : bVal,
        after:  aVal === undefined ? null : aVal,
      };
    }
  }
  return { changed };
}

// ── Modal open/close helpers ────────────────────────────────────────────────
const gameModal   = document.getElementById('gameModal');
const playerModal = document.getElementById('playerModal');

function openModal(overlay) { overlay.hidden = false; }
function closeModal(overlay) { overlay.hidden = true; }

[gameModal, playerModal].forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal(overlay);
  });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal(gameModal);
    closeModal(playerModal);
  }
});
document.getElementById('gameModalClose').addEventListener('click', () => closeModal(gameModal));
document.getElementById('playerModalClose').addEventListener('click', () => closeModal(playerModal));

// ══════════════════════════════════════════════════════════════════════════
// GAMES
// ══════════════════════════════════════════════════════════════════════════

const gamesCache = new Map();
let editingGameId = null;
let currentSubs = [];

const gEventInput = document.getElementById('g-event');
const gNumInput    = document.getElementById('g-num');
const gameForm       = document.getElementById('gameForm');
const gameModalTitle = document.getElementById('gameModalTitle');
const gameSubmitBtn  = document.getElementById('gameSubmitBtn');
const gameStatus     = document.getElementById('gameStatus');
const hasSubsToggle   = document.getElementById('g-has-subs');
const subEntriesPanel = document.getElementById('subEntriesPanel');
const subEntriesList  = document.getElementById('subEntriesList');

hasSubsToggle.addEventListener('change', () => {
  subEntriesPanel.hidden = !hasSubsToggle.checked;
});

function renderSubEntries() {
  subEntriesList.innerHTML = '';
  currentSubs.forEach((sub, i) => subEntriesList.appendChild(renderSubEntryRow(sub, i)));
}

function renderSubEntryRow(sub, i) {
  const div = document.createElement('div');
  div.className = 'sub-entry-row';

  const mkField = (labelText, cls, value, listId) => {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = cls;
    input.value = value || '';
    if (listId) input.setAttribute('list', listId);
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  };

  div.appendChild(mkField('Game Title', 'sub-game', sub.game));
  div.appendChild(mkField('System', 'sub-system', sub.system, 'g-system-list'));
  div.appendChild(mkField('Genre', 'sub-genre', sub.genre, 'g-genre-list'));
  div.appendChild(mkField('Players', 'sub-players', sub.players));

  const heroRow = document.createElement('div');
  heroRow.className = 'checkbox-row';
  const heroCheckbox = document.createElement('input');
  heroCheckbox.type = 'checkbox';
  heroCheckbox.className = 'sub-hero';
  heroCheckbox.checked = !!sub.hero_beat;
  const heroLabel = document.createElement('label');
  heroLabel.textContent = 'Hero Beat';
  heroRow.appendChild(heroCheckbox);
  heroRow.appendChild(heroLabel);
  div.appendChild(heroRow);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'admin-row-btn delete sub-entry-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    currentSubs.splice(i, 1);
    renderSubEntries();
  });
  div.appendChild(removeBtn);

  return div;
}

document.getElementById('addSubEntryBtn').addEventListener('click', () => {
  currentSubs.push({ game: '', system: '', genre: '', players: '', hero_beat: false });
  renderSubEntries();
});

function openAddGame() {
  editingGameId = null;
  gameForm.reset();
  setStatus(gameStatus, '', '');
  gEventInput.disabled = false;
  gNumInput.disabled = false;
  currentSubs = [];
  hasSubsToggle.checked = false;
  subEntriesPanel.hidden = true;
  renderSubEntries();
  gameModalTitle.textContent = 'Add a Game';
  gameSubmitBtn.textContent = 'Add Game';
  openModal(gameModal);
}

function openEditGame(id) {
  const data = gamesCache.get(id);
  if (!data) return;
  editingGameId = id;
  setStatus(gameStatus, '', '');
  gEventInput.value = data.event || '';
  gNumInput.value = data.num != null ? data.num : '';
  document.getElementById('g-game').value = data.game || '';
  document.getElementById('g-system').value = data.system || '';
  document.getElementById('g-genre').value = data.genre || '';
  document.getElementById('g-players').value = data.players || '';
  document.getElementById('g-hero').checked = !!data.hero_beat;
  currentSubs = (data.subs || []).map(s => ({ ...s }));
  hasSubsToggle.checked = currentSubs.length > 0;
  subEntriesPanel.hidden = currentSubs.length === 0;
  renderSubEntries();
  gEventInput.disabled = true;
  gNumInput.disabled = true;
  gameModalTitle.textContent = 'Edit Game';
  gameSubmitBtn.textContent = 'Save Changes';
  openModal(gameModal);
}

document.getElementById('openAddGameBtn').addEventListener('click', openAddGame);

async function loadGamesTable() {
  const tbody = document.getElementById('gamesTableBody');
  try {
    const snap = await getDocs(query(collection(db, 'games'), orderBy('num')));
    gamesCache.clear();
    tbody.innerHTML = '';

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="7" class="admin-table-empty">No games yet.</td></tr>';
      return;
    }

    snap.docs.forEach(d => {
      gamesCache.set(d.id, d.data());
      tbody.appendChild(renderGameRow(d.id, d.data()));
    });
  } catch (e) {
    console.error('Could not load games', e);
    tbody.innerHTML = '<tr><td colspan="7" class="admin-table-empty">Error loading games.</td></tr>';
  }
}

function renderGameRow(id, data) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${escHtml(data.event)}</td>
    <td>${escHtml(data.num)}</td>
    <td>${escHtml(data.game)}</td>
    <td>${escHtml(data.system || '')}</td>
    <td>${escHtml(data.genre || '')}</td>
    <td>${escHtml(data.players || '')}</td>
    <td class="admin-row-actions">
      <button class="admin-row-btn edit">Edit</button>
      <button class="admin-row-btn delete">Delete</button>
    </td>
  `;
  tr.querySelector('.edit').addEventListener('click', () => openEditGame(id));
  tr.querySelector('.delete').addEventListener('click', () => confirmDeleteGame(id, data.game));
  return tr;
}

async function confirmDeleteGame(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const before = gamesCache.get(id);
  try {
    await deleteDoc(doc(db, 'games', id));
    await logHistory('delete', 'game', id, name, { deleted: before });
    await loadGamesTable();
    populateDatalistsFromFirestore();
  } catch (e) {
    console.error(e);
    alert('Error deleting game: ' + e.message);
  }
}

gameForm.addEventListener('submit', async e => {
  e.preventDefault();

  const event    = gEventInput.value.trim();
  const num      = parseInt(gNumInput.value, 10);
  const game     = document.getElementById('g-game').value.trim();
  const system   = document.getElementById('g-system').value.trim();
  const genre    = document.getElementById('g-genre').value.trim();
  const players  = document.getElementById('g-players').value.trim();
  const heroBeat = document.getElementById('g-hero').checked;

  if (!event || !game || !num) {
    setStatus(gameStatus, 'Event, Beat #, and Game Title are required.', 'error');
    return;
  }

  gameSubmitBtn.disabled = true;
  setStatus(gameStatus, 'Saving…', '');

  const isEdit = editingGameId !== null;
  const docId  = isEdit ? editingGameId : `${event.replace(/\s+/g, '_')}_${num}`;

  const subRows = document.querySelectorAll('#subEntriesList .sub-entry-row');
  const subs = hasSubsToggle.checked
    ? Array.from(subRows).map(row => ({
        game:      row.querySelector('.sub-game').value.trim(),
        system:    row.querySelector('.sub-system').value.trim(),
        genre:     row.querySelector('.sub-genre').value.trim(),
        players:   row.querySelector('.sub-players').value.trim(),
        hero_beat: row.querySelector('.sub-hero').checked,
      })).filter(s => s.game)
    : [];

  const newData = {
    event, num, game, system, genre, players,
    hero_beat: heroBeat,
    is_sub:    false,
    ref_num:   isEdit ? (gamesCache.get(docId)?.ref_num ?? null) : null,
    subs,
  };

  try {
    if (isEdit) {
      const before = gamesCache.get(docId);
      await setDoc(doc(db, 'games', docId), newData, { merge: true });
      await logHistory('edit', 'game', docId, game, diffFields(before, newData));
      setStatus(gameStatus, `"${game}" updated successfully.`, 'success');
    } else {
      const existing = await getDoc(doc(db, 'games', docId));
      if (existing.exists()) {
        setStatus(gameStatus, `A game already exists for Event "${event}" Beat #${num}. Edit it instead, or use a different Beat #.`, 'error');
        gameSubmitBtn.disabled = false;
        return;
      }
      await setDoc(doc(db, 'games', docId), newData);
      await logHistory('add', 'game', docId, game, { created: newData });
      setStatus(gameStatus, `"${game}" added successfully.`, 'success');
    }
    await loadGamesTable();
    populateDatalistsFromFirestore();
    closeModal(gameModal);
  } catch (err) {
    console.error(err);
    setStatus(gameStatus, 'Error: ' + err.message, 'error');
  } finally {
    gameSubmitBtn.disabled = false;
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PLAYERS
// ══════════════════════════════════════════════════════════════════════════

const playersCache = new Map();
let editingPlayerId = null;

const pKeyInput = document.getElementById('p-key');
const playerForm       = document.getElementById('playerForm');
const playerModalTitle = document.getElementById('playerModalTitle');
const playerSubmitBtn  = document.getElementById('playerSubmitBtn');
const playerStatus     = document.getElementById('playerStatus');

function openAddPlayer() {
  editingPlayerId = null;
  playerForm.reset();
  setStatus(playerStatus, '', '');
  pKeyInput.disabled = false;
  playerModalTitle.textContent = 'Add a Player Profile';
  playerSubmitBtn.textContent = 'Add Player';
  openModal(playerModal);
}

function openEditPlayer(id) {
  const data = playersCache.get(id);
  if (!data) return;
  editingPlayerId = id;
  setStatus(playerStatus, '', '');
  pKeyInput.value = data.playerKey || '';
  document.getElementById('p-handle').value = data.handle || '';
  document.getElementById('p-realname').value = data.realName || '';
  document.getElementById('p-location').value = data.location || '';
  document.getElementById('p-debut').value = data.debut || '';
  document.getElementById('p-best').value = data.bestBeat || '';
  document.getElementById('p-worst').value = data.worstBeat || '';
  document.getElementById('p-genre').value = data.favoriteGenre || '';
  document.getElementById('p-events').value = data.events != null ? data.events : '';
  document.getElementById('p-games').value = data.games != null ? data.games : '';
  document.getElementById('p-mvps').value = data.mvps != null ? data.mvps : '';
  document.getElementById('p-photo').value = '';
  pKeyInput.disabled = true;
  playerModalTitle.textContent = 'Edit Player Profile';
  playerSubmitBtn.textContent = 'Save Changes';
  openModal(playerModal);
}

document.getElementById('openAddPlayerBtn').addEventListener('click', openAddPlayer);

async function loadPlayersTable() {
  const tbody = document.getElementById('playersTableBody');
  try {
    const snap = await getDocs(collection(db, 'players'));
    playersCache.clear();
    const docs = snap.docs.slice().sort((a, b) =>
      (a.data().handle || '').localeCompare(b.data().handle || '')
    );
    tbody.innerHTML = '';

    if (docs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="admin-table-empty">No players yet.</td></tr>';
      return;
    }

    docs.forEach(d => {
      playersCache.set(d.id, d.data());
      tbody.appendChild(renderPlayerRow(d.id, d.data()));
    });
  } catch (e) {
    console.error('Could not load players', e);
    tbody.innerHTML = '<tr><td colspan="6" class="admin-table-empty">Error loading players.</td></tr>';
  }
}

function renderPlayerRow(id, data) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${escHtml(data.handle)}</td>
    <td>${escHtml(data.realName || '')}</td>
    <td>${escHtml(data.location || '')}</td>
    <td>${escHtml(data.events != null ? data.events : 0)}</td>
    <td>${escHtml(data.mvps != null ? data.mvps : 0)}</td>
    <td class="admin-row-actions">
      <button class="admin-row-btn edit">Edit</button>
      <button class="admin-row-btn delete">Delete</button>
    </td>
  `;
  tr.querySelector('.edit').addEventListener('click', () => openEditPlayer(id));
  tr.querySelector('.delete').addEventListener('click', () => confirmDeletePlayer(id, data.handle));
  return tr;
}

async function confirmDeletePlayer(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  const before = playersCache.get(id);
  try {
    await deleteDoc(doc(db, 'players', id));
    await logHistory('delete', 'player', id, name, { deleted: before });
    await loadPlayersTable();
  } catch (e) {
    console.error(e);
    alert('Error deleting player: ' + e.message);
  }
}

playerForm.addEventListener('submit', async e => {
  e.preventDefault();

  const playerKey      = pKeyInput.value.trim();
  const handle         = document.getElementById('p-handle').value.trim();
  const realName       = document.getElementById('p-realname').value.trim();
  const location       = document.getElementById('p-location').value.trim();
  const debut          = document.getElementById('p-debut').value.trim();
  const bestBeat       = document.getElementById('p-best').value.trim();
  const worstBeat      = document.getElementById('p-worst').value.trim();
  const favoriteGenre  = document.getElementById('p-genre').value.trim();
  const events         = parseInt(document.getElementById('p-events').value, 10) || 0;
  const games          = parseInt(document.getElementById('p-games').value, 10) || 0;
  const mvps           = parseInt(document.getElementById('p-mvps').value, 10)  || 0;
  const photoFile      = document.getElementById('p-photo').files[0];

  if (!playerKey || !handle) {
    setStatus(playerStatus, 'Player Key and Display Handle are required.', 'error');
    return;
  }

  playerSubmitBtn.disabled = true;
  setStatus(playerStatus, 'Saving…', '');

  const isEdit = editingPlayerId !== null;
  const docId  = isEdit ? editingPlayerId : playerKey.replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    let photoUrl = isEdit ? (playersCache.get(docId)?.photoUrl || '') : '';
    if (photoFile) {
      setStatus(playerStatus, 'Uploading photo…', '');
      const ext     = photoFile.name.split('.').pop();
      const fileRef = storageRef(storage, `profiles/${playerKey.replace(/\s+/g,'_').toLowerCase()}.${ext}`);
      await uploadBytes(fileRef, photoFile);
      photoUrl = await getDownloadURL(fileRef);
    }

    const newData = {
      playerKey, handle, realName, location, debut,
      bestBeat, worstBeat, favoriteGenre,
      events, games, mvps,
      photoUrl,
    };

    if (isEdit) {
      const before = playersCache.get(docId);
      await setDoc(doc(db, 'players', docId), newData, { merge: true });
      await logHistory('edit', 'player', docId, handle, diffFields(before, newData));
      setStatus(playerStatus, `"${handle}" updated successfully.`, 'success');
    } else {
      await setDoc(doc(db, 'players', docId), newData);
      await logHistory('add', 'player', docId, handle, { created: newData });
      setStatus(playerStatus, `"${handle}" added successfully.`, 'success');
    }

    await loadPlayersTable();
    closeModal(playerModal);
  } catch (err) {
    console.error(err);
    setStatus(playerStatus, 'Error: ' + err.message, 'error');
  } finally {
    playerSubmitBtn.disabled = false;
  }
});

// ══════════════════════════════════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════════════════════════════════

async function loadHistory() {
  const list = document.getElementById('historyList');
  try {
    const snap = await getDocs(query(collection(db, 'history'), orderBy('timestamp', 'desc'), limit(100)));
    list.innerHTML = '';

    if (snap.empty) {
      list.innerHTML = '<li class="admin-table-empty">No history yet.</li>';
      return;
    }

    snap.docs.forEach(d => list.appendChild(renderHistoryItem(d.data())));
  } catch (e) {
    console.error('Could not load history', e);
    list.innerHTML = '<li class="admin-table-empty">Error loading history.</li>';
  }
}

function renderHistoryItem(h) {
  const li = document.createElement('li');
  li.className = 'history-item';
  const when = h.timestamp && typeof h.timestamp.toDate === 'function'
    ? h.timestamp.toDate().toLocaleString()
    : '—';

  li.innerHTML = `
    <span class="history-action ${escHtml(h.action)}">${escHtml((h.action || '').toUpperCase())}</span>
    <span class="history-entity">${escHtml(h.entityType)}: ${escHtml(h.entityName)}</span>
    <span class="history-who">${escHtml(h.actorEmail)}</span>
    <span class="history-when">${escHtml(when)}</span>
    ${renderHistoryDetail(h)}
  `;
  return li;
}

function formatHistoryValue(val) {
  if (val === null || val === undefined || val === '') return '(empty)';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function renderHistoryDetail(h) {
  const detail = h.detail || {};
  if (h.action === 'edit' && detail.changed && Object.keys(detail.changed).length) {
    const lines = Object.entries(detail.changed).map(([field, { before, after }]) =>
      `<div><span class="field-name">${escHtml(field)}</span>: ${escHtml(formatHistoryValue(before))} → ${escHtml(formatHistoryValue(after))}</div>`
    );
    return `<div class="history-detail">${lines.join('')}</div>`;
  }
  if (h.action === 'add') {
    return `<div class="history-detail">Created new ${escHtml(h.entityType)}.</div>`;
  }
  if (h.action === 'delete') {
    return `<div class="history-detail">Deleted ${escHtml(h.entityType)} record.</div>`;
  }
  return '';
}
