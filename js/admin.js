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

const PLAYER_SEPARATOR_REGEX = /\s*\/\s*|\s*&\s*|\s*,\s*/;

/**
 * Turns a chips-container + text-input pair into a tag/chip input for player
 * names, backed by a plain input/hidden input whose `.value` is kept as the
 * "/"-joined string the rest of the codebase (and beats-list.html) expects.
 */
function createPlayerChipInput({ chipsEl, textInputEl, valueInputEl }) {
  let chips = [];

  function sync() {
    valueInputEl.value = chips.join(' / ');
  }

  function render() {
    chipsEl.innerHTML = '';
    chips.forEach((name, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const label = document.createElement('span');
      label.textContent = name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'chip-remove';
      removeBtn.setAttribute('aria-label', `Remove ${name}`);
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        chips.splice(i, 1);
        render();
        sync();
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      chipsEl.appendChild(chip);
    });
  }

  function addChip(raw) {
    const name = raw.trim();
    if (!name) return;
    if (!chips.some(c => c.toLowerCase() === name.toLowerCase())) {
      chips.push(name);
      render();
      sync();
    }
    textInputEl.value = '';
  }

  function setFromString(str) {
    chips = (str || '')
      .split(PLAYER_SEPARATOR_REGEX)
      .map(s => s.trim())
      .filter(Boolean);
    render();
    sync();
  }

  textInputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addChip(textInputEl.value);
    } else if (e.key === 'Backspace' && textInputEl.value === '' && chips.length > 0) {
      chips.pop();
      render();
      sync();
    }
  });
  textInputEl.addEventListener('blur', () => {
    if (textInputEl.value.trim()) addChip(textInputEl.value);
  });

  return { setFromString, getValue: () => chips.join(' / ') };
}

/**
 * Custom-styled, width-constrained autocomplete dropdown to replace native
 * <datalist> popups (which can't be styled and render full-viewport-width in
 * some browsers). `getOptions()` is called lazily on each keystroke so the
 * suggestion list can be refreshed after Firestore data loads.
 */
function createAutocomplete(inputEl, getOptions, { onSelect } = {}) {
  const wrap = inputEl.closest('.autocomplete-wrap') || inputEl.parentElement;
  const list = document.createElement('ul');
  list.className = 'autocomplete-list';
  list.hidden = true;
  wrap.appendChild(list);

  let items = [];
  let activeIndex = -1;

  function close() {
    list.hidden = true;
    activeIndex = -1;
  }

  function renderItems() {
    list.innerHTML = '';
    items.forEach((text, i) => {
      const li = document.createElement('li');
      li.textContent = text;
      li.className = i === activeIndex ? 'active' : '';
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        select(text);
      });
      list.appendChild(li);
    });
    if (activeIndex >= 0) {
      const activeLi = list.children[activeIndex];
      if (activeLi) activeLi.scrollIntoView({ block: 'nearest' });
    }
  }

  function select(text) {
    inputEl.value = text;
    close();
    if (onSelect) onSelect(text);
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open() {
    const term = inputEl.value.trim().toLowerCase();
    const all = getOptions();
    items = term ? all.filter(o => o.toLowerCase().includes(term)) : all;
    activeIndex = -1;
    if (items.length === 0) {
      close();
      return;
    }
    renderItems();
    list.hidden = false;
  }

  inputEl.addEventListener('input', open);
  inputEl.addEventListener('focus', open);
  inputEl.addEventListener('blur', () => setTimeout(close, 150));
  inputEl.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      renderItems();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      renderItems();
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      select(items[activeIndex]);
    } else if (e.key === 'Escape') {
      close();
    }
  });
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

// ── Autocomplete suggestion sources, refreshed from Firestore data ────────
let knownSystems = [];
let knownGenres  = [];
let knownPlayerHandles = [];

async function populateDatalistsFromFirestore() {
  try {
    const snap = await getDocs(query(collection(db, 'games'), orderBy('num')));
    const games = snap.docs.map(d => d.data());
    knownSystems = [...new Set(games.map(g => g.system).filter(Boolean))].sort();
    knownGenres  = [...new Set(games.map(g => g.genre).filter(Boolean))].sort();
  } catch (e) {
    console.error('Could not load system/genre suggestions', e);
  }
}

function populatePlayerHandleDatalist() {
  knownPlayerHandles = [...new Set(Array.from(playersCache.values()).map(p => p.handle).filter(Boolean))].sort();
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

const gPlayersChip = createPlayerChipInput({
  chipsEl: document.getElementById('g-players-chips'),
  textInputEl: document.getElementById('g-players-input'),
  valueInputEl: document.getElementById('g-players'),
});
createAutocomplete(document.getElementById('g-system'), () => knownSystems);
createAutocomplete(document.getElementById('g-genre'), () => knownGenres);
createAutocomplete(document.getElementById('g-players-input'), () => knownPlayerHandles);

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

  const mkField = (labelText, cls, value, getOptions) => {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = cls;
    input.value = value || '';
    input.setAttribute('autocomplete', 'off');
    wrap.appendChild(label);
    if (getOptions) {
      const acWrap = document.createElement('div');
      acWrap.className = 'autocomplete-wrap';
      acWrap.appendChild(input);
      wrap.appendChild(acWrap);
      createAutocomplete(input, getOptions);
    } else {
      wrap.appendChild(input);
    }
    return wrap;
  };

  const mkPlayersField = (labelText, cls, value) => {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const chipWrap = document.createElement('div');
    chipWrap.className = 'chip-input';
    const chipsEl = document.createElement('div');
    chipsEl.className = 'chip-input-chips';
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.setAttribute('autocomplete', 'off');
    textInput.placeholder = 'Type a name and press Enter…';
    chipWrap.appendChild(chipsEl);
    const acWrap = document.createElement('div');
    acWrap.className = 'autocomplete-wrap';
    acWrap.appendChild(textInput);
    chipWrap.appendChild(acWrap);
    createAutocomplete(textInput, () => knownPlayerHandles);
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.className = cls;
    wrap.appendChild(label);
    wrap.appendChild(chipWrap);
    wrap.appendChild(hiddenInput);
    const chipApi = createPlayerChipInput({ chipsEl, textInputEl: textInput, valueInputEl: hiddenInput });
    chipApi.setFromString(value || '');
    return wrap;
  };

  div.appendChild(mkField('Game Title', 'sub-game', sub.game));
  div.appendChild(mkField('System', 'sub-system', sub.system, () => knownSystems));
  div.appendChild(mkField('Genre', 'sub-genre', sub.genre, () => knownGenres));
  div.appendChild(mkPlayersField('Players', 'sub-players', sub.players));

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

function nextGameNum() {
  let max = 0;
  gamesCache.forEach(data => {
    if (typeof data.num === 'number' && data.num > max) max = data.num;
  });
  return max + 1;
}

function openAddGame() {
  editingGameId = null;
  gameForm.reset();
  setStatus(gameStatus, '', '');
  gEventInput.disabled = false;
  gNumInput.disabled = false;
  gNumInput.value = nextGameNum();
  gPlayersChip.setFromString('');
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
  gPlayersChip.setFromString(data.players || '');
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

let gamesSearchTerm = '';
document.getElementById('gamesSearch').addEventListener('input', e => {
  gamesSearchTerm = e.target.value;
  renderGamesTable();
});

async function loadGamesTable() {
  try {
    const snap = await getDocs(query(collection(db, 'games'), orderBy('num')));
    gamesCache.clear();
    snap.docs.forEach(d => gamesCache.set(d.id, d.data()));
    renderGamesTable();
  } catch (e) {
    console.error('Could not load games', e);
    document.getElementById('gamesTableBody').innerHTML =
      '<tr><td colspan="8" class="admin-table-empty">Error loading games.</td></tr>';
  }
}

function gameMatchesSearch(data, term) {
  if (!term) return true;
  const haystack = [
    data.event, data.game, data.system, data.genre, data.players,
    ...(data.subs || []).flatMap(s => [s.game, s.system, s.genre, s.players]),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(term);
}

function renderGamesTable() {
  const tbody = document.getElementById('gamesTableBody');
  tbody.innerHTML = '';

  const term = gamesSearchTerm.trim().toLowerCase();
  const entries = Array.from(gamesCache.entries()).filter(([, data]) => gameMatchesSearch(data, term));

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="admin-table-empty">${gamesCache.size === 0 ? 'No games yet.' : 'No games match your search.'}</td></tr>`;
    return;
  }

  entries.forEach(([id, data]) => {
    const { row, subRow } = renderGameRow(id, data);
    tbody.appendChild(row);
    if (subRow) tbody.appendChild(subRow);
  });
}

function renderGameRow(id, data) {
  const subs = data.subs || [];
  const hasSubs = subs.length > 0;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${hasSubs ? '<button type="button" class="row-expand-btn" aria-label="Toggle sub entries">▶</button>' : '<span class="row-expand-spacer"></span>'}</td>
    <td>${escHtml(data.num)}</td>
    <td>${escHtml(data.event)}</td>
    <td>${escHtml(data.game)}</td>
    <td>${escHtml(data.system || '')}</td>
    <td>${escHtml(data.genre || '')}</td>
    <td>${escHtml(data.players || '')}</td>
    <td class="admin-row-actions">
      <div class="admin-row-actions-inner">
        <button class="admin-row-btn edit">Edit</button>
        <button class="admin-row-btn delete">Delete</button>
      </div>
    </td>
  `;
  tr.querySelector('.edit').addEventListener('click', () => openEditGame(id));
  tr.querySelector('.delete').addEventListener('click', () => confirmDeleteGame(id, data.game));

  let subRow = null;
  if (hasSubs) {
    subRow = document.createElement('tr');
    subRow.className = 'sub-entry-display-row';
    const lines = subs.map(s => {
      const heroTag = s.hero_beat ? '<span class="hero-tag">Hero Beat</span>' : '';
      const bits = [escHtml(s.game)];
      if (s.system) bits.push(escHtml(s.system));
      if (s.genre) bits.push(escHtml(s.genre));
      if (s.players) bits.push(escHtml(s.players));
      return `<div class="sub-entry-display-name">↳ ${bits.join(' — ')}${heroTag}</div>`;
    }).join('');
    subRow.innerHTML = `<td colspan="8">${lines}</td>`;

    const expandBtn = tr.querySelector('.row-expand-btn');
    expandBtn.addEventListener('click', () => {
      const isOpen = subRow.classList.toggle('open');
      expandBtn.classList.toggle('open', isOpen);
      expandBtn.textContent = isOpen ? '▼' : '▶';
    });
  }

  return { row: tr, subRow };
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
const searchPlayerDataBtn = document.getElementById('searchPlayerDataBtn');
const playerSearchView    = document.getElementById('playerSearchView');
const playerConfirmView   = document.getElementById('playerConfirmView');
const playerSearchInput   = document.getElementById('playerSearchInput');
const playerSearchResults = document.getElementById('playerSearchResults');

function fillPlayerForm(data) {
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
}

function showPlayerFormView() {
  playerForm.hidden = false;
  playerSearchView.hidden = true;
  playerConfirmView.hidden = true;
}

function openAddPlayer() {
  editingPlayerId = null;
  playerForm.reset();
  setStatus(playerStatus, '', '');
  pKeyInput.disabled = false;
  showPlayerFormView();
  searchPlayerDataBtn.hidden = false;
  playerModalTitle.textContent = 'Add a Player Profile';
  playerSubmitBtn.textContent = 'Add Player';
  openModal(playerModal);
}

function openEditPlayer(id) {
  const data = playersCache.get(id);
  if (!data) return;
  editingPlayerId = id;
  setStatus(playerStatus, '', '');
  fillPlayerForm(data);
  pKeyInput.disabled = true;
  showPlayerFormView();
  searchPlayerDataBtn.hidden = true;
  playerModalTitle.textContent = 'Edit Player Profile';
  playerSubmitBtn.textContent = 'Save Changes';
  openModal(playerModal);
}

document.getElementById('openAddPlayerBtn').addEventListener('click', openAddPlayer);

// ── Search Player Data: pull stats from the beats list (games collection) ──
function playerInGame(playersStr, playerKey) {
  return (playersStr || '').split(PLAYER_SEPARATOR_REGEX).map(p => p.trim()).some(p => p === playerKey);
}

function topValue(arr) {
  if (!arr.length) return null;
  const freq = {};
  arr.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

function getKnownGamePlayerNames() {
  const names = new Set();
  gamesCache.forEach(data => {
    (data.players || '').split(PLAYER_SEPARATOR_REGEX).forEach(n => { if (n.trim()) names.add(n.trim()); });
    (data.subs || []).forEach(s => (s.players || '').split(PLAYER_SEPARATOR_REGEX).forEach(n => { if (n.trim()) names.add(n.trim()); }));
  });
  return [...names].sort();
}

function computePlayerStatsFromGames(playerKey) {
  const directRecords = [];
  gamesCache.forEach(r => {
    if (r.is_sub) return;
    if (playerInGame(r.players, playerKey)) directRecords.push(r);
    (r.subs || []).forEach(s => {
      if (playerInGame(s.players, playerKey)) directRecords.push({ ...s, event: r.event });
    });
  });
  const events    = new Set(directRecords.map(r => r.event)).size;
  const heroBeats = directRecords.filter(r => r.hero_beat).length;
  const topGenre  = topValue(directRecords.map(r => r.genre).filter(Boolean));
  const topSystem = topValue(directRecords.map(r => r.system).filter(Boolean));
  return { directRecords, games: directRecords.length, events, heroBeats, topGenre, topSystem };
}

let pendingPulledPlayer = null; // { name, stats } selected from search, awaiting confirmation

function renderPlayerSearchResults(term) {
  const names = getKnownGamePlayerNames();
  const filtered = term ? names.filter(n => n.toLowerCase().includes(term.toLowerCase())) : names;

  playerSearchResults.innerHTML = '';
  if (filtered.length === 0) {
    playerSearchResults.innerHTML = '<li class="admin-table-empty">No matching names found.</li>';
    return;
  }
  filtered.forEach(name => {
    const li = document.createElement('li');
    li.textContent = name;
    li.addEventListener('click', () => selectSearchedPlayer(name));
    playerSearchResults.appendChild(li);
  });
}

function selectSearchedPlayer(name) {
  const stats = computePlayerStatsFromGames(name);
  pendingPulledPlayer = { name, stats };

  const summary = document.getElementById('playerConfirmSummary');
  const gamesListHtml = stats.directRecords
    .slice(0, 20)
    .map(r => `<div>${escHtml(r.game)} — ${escHtml(r.event)}${r.hero_beat ? ' ★' : ''}</div>`)
    .join('') || '<div>No matched beats found.</div>';

  summary.innerHTML = `
    <div class="confirm-stats">
      <div><div class="confirm-stat-val">${stats.games}</div><div class="confirm-stat-label">Games Beaten</div></div>
      <div><div class="confirm-stat-val">${stats.events}</div><div class="confirm-stat-label">Events Attended</div></div>
      <div><div class="confirm-stat-val">${stats.heroBeats}</div><div class="confirm-stat-label">Hero Beats</div></div>
      <div><div class="confirm-stat-val" style="font-size:0.55rem;">${escHtml(stats.topGenre || '—')}</div><div class="confirm-stat-label">Top Genre</div></div>
      <div><div class="confirm-stat-val" style="font-size:0.55rem;">${escHtml(stats.topSystem || '—')}</div><div class="confirm-stat-label">Top System</div></div>
    </div>
    <div class="confirm-games-list">${gamesListHtml}${stats.directRecords.length > 20 ? `<div>…and ${stats.directRecords.length - 20} more</div>` : ''}</div>
  `;

  document.getElementById('pc-realname').value = '';
  document.getElementById('pc-location').value = '';
  document.getElementById('pc-debut').value = '';
  document.getElementById('pc-best').value = '';
  document.getElementById('pc-worst').value = '';
  document.getElementById('pc-mvps').value = '';

  playerSearchView.hidden = true;
  playerConfirmView.hidden = false;
}

searchPlayerDataBtn.addEventListener('click', () => {
  playerForm.hidden = true;
  playerConfirmView.hidden = true;
  playerSearchView.hidden = false;
  playerSearchInput.value = '';
  renderPlayerSearchResults('');
  playerSearchInput.focus();
});

playerSearchInput.addEventListener('input', () => renderPlayerSearchResults(playerSearchInput.value.trim()));

document.getElementById('playerSearchCancelBtn').addEventListener('click', () => {
  showPlayerFormView();
});

document.getElementById('playerConfirmBackBtn').addEventListener('click', () => {
  playerConfirmView.hidden = true;
  playerSearchView.hidden = false;
});

document.getElementById('playerConfirmUseBtn').addEventListener('click', () => {
  if (!pendingPulledPlayer) return;
  const { name, stats } = pendingPulledPlayer;

  pKeyInput.value = name;
  document.getElementById('p-handle').value = name;
  document.getElementById('p-realname').value = document.getElementById('pc-realname').value.trim();
  document.getElementById('p-location').value = document.getElementById('pc-location').value.trim();
  document.getElementById('p-debut').value = document.getElementById('pc-debut').value.trim();
  document.getElementById('p-best').value = document.getElementById('pc-best').value.trim();
  document.getElementById('p-worst').value = document.getElementById('pc-worst').value.trim();
  document.getElementById('p-genre').value = stats.topGenre || '';
  document.getElementById('p-events').value = stats.events;
  document.getElementById('p-games').value = stats.games;
  document.getElementById('p-mvps').value = document.getElementById('pc-mvps').value.trim();

  pendingPulledPlayer = null;
  setStatus(playerStatus, `Pulled data for "${name}" from the beats list — review before saving.`, '');
  showPlayerFormView();
});

let playersSearchTerm = '';
document.getElementById('playersSearch').addEventListener('input', e => {
  playersSearchTerm = e.target.value;
  renderPlayersTable();
});

async function loadPlayersTable() {
  try {
    const snap = await getDocs(collection(db, 'players'));
    playersCache.clear();
    snap.docs.forEach(d => playersCache.set(d.id, d.data()));
    renderPlayersTable();
    populatePlayerHandleDatalist();
  } catch (e) {
    console.error('Could not load players', e);
    document.getElementById('playersTableBody').innerHTML =
      '<tr><td colspan="6" class="admin-table-empty">Error loading players.</td></tr>';
  }
}


function playerMatchesSearch(data, term) {
  if (!term) return true;
  const haystack = [data.handle, data.realName, data.location, data.favoriteGenre]
    .filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(term);
}

function renderPlayersTable() {
  const tbody = document.getElementById('playersTableBody');
  tbody.innerHTML = '';

  const term = playersSearchTerm.trim().toLowerCase();
  const entries = Array.from(playersCache.entries())
    .filter(([, data]) => playerMatchesSearch(data, term))
    .sort((a, b) => (a[1].handle || '').localeCompare(b[1].handle || ''));

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-table-empty">${playersCache.size === 0 ? 'No players yet.' : 'No players match your search.'}</td></tr>`;
    return;
  }

  entries.forEach(([id, data]) => tbody.appendChild(renderPlayerRow(id, data)));
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
      <div class="admin-row-actions-inner">
        <button class="admin-row-btn edit">Edit</button>
        <button class="admin-row-btn delete">Delete</button>
      </div>
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
    if (!isEdit) {
      const existing = await getDoc(doc(db, 'players', docId));
      if (existing.exists()) {
        setStatus(playerStatus, `A player already exists for Player Key "${playerKey}". Edit it instead, or use a different key.`, 'error');
        playerSubmitBtn.disabled = false;
        return;
      }
    }

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
