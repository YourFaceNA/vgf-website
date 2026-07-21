import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, setDoc, getDocs, addDoc, deleteDoc,
  query, orderBy, limit, serverTimestamp, writeBatch, Timestamp,
}                                                                            from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL }     from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { app } from './firebase-config.js';

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
 * Turns a chips-container + text-input pair into a generic tag/chip input,
 * backed by a plain input/hidden input whose `.value` is kept as a
 * "/"-joined string. Used for both Players and Genre (multi-value) fields.
 */
function createChipInput({ chipsEl, textInputEl, valueInputEl, separator = PLAYER_SEPARATOR_REGEX }) {
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
      .split(separator)
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
  loadStreamsTable();
  loadScheduleTable();
  loadLiveConfig();
  loadScheduleViewConfig();
  loadDonationConfig();
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
const gameModal     = document.getElementById('gameModal');
const playerModal   = document.getElementById('playerModal');
const genreModal    = document.getElementById('genreModal');
const streamModal   = document.getElementById('streamModal');
const scheduleModal = document.getElementById('scheduleModal');

function openModal(overlay) { overlay.hidden = false; }
function closeModal(overlay) { overlay.hidden = true; }

const allModals = [gameModal, playerModal, genreModal, streamModal, scheduleModal];
allModals.forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal(overlay);
  });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    allModals.forEach(closeModal);
  }
});
document.getElementById('gameModalClose').addEventListener('click', () => closeModal(gameModal));
document.getElementById('playerModalClose').addEventListener('click', () => closeModal(playerModal));
document.getElementById('genreModalClose').addEventListener('click', () => closeModal(genreModal));
document.getElementById('streamModalClose').addEventListener('click', () => closeModal(streamModal));
document.getElementById('scheduleModalClose').addEventListener('click', () => closeModal(scheduleModal));

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

const gPlayersChip = createChipInput({
  chipsEl: document.getElementById('g-players-chips'),
  textInputEl: document.getElementById('g-players-input'),
  valueInputEl: document.getElementById('g-players'),
});
const gGenreChip = createChipInput({
  chipsEl: document.getElementById('g-genre-chips'),
  textInputEl: document.getElementById('g-genre-input'),
  valueInputEl: document.getElementById('g-genre'),
});
createAutocomplete(document.getElementById('g-system'), () => knownSystems);
createAutocomplete(document.getElementById('g-genre-input'), () => knownGenres);
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

  const mkChipField = (labelText, cls, value, getOptions, placeholder) => {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const chipWrap = document.createElement('div');
    chipWrap.className = cls === 'sub-genre' ? 'chip-input chip-input--genre' : 'chip-input';
    const chipsEl = document.createElement('div');
    chipsEl.className = 'chip-input-chips';
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.setAttribute('autocomplete', 'off');
    textInput.placeholder = placeholder;
    chipWrap.appendChild(chipsEl);
    const acWrap = document.createElement('div');
    acWrap.className = 'autocomplete-wrap';
    acWrap.appendChild(textInput);
    chipWrap.appendChild(acWrap);
    createAutocomplete(textInput, getOptions);
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.className = cls;
    wrap.appendChild(label);
    wrap.appendChild(chipWrap);
    wrap.appendChild(hiddenInput);
    const chipApi = createChipInput({ chipsEl, textInputEl: textInput, valueInputEl: hiddenInput });
    chipApi.setFromString(value || '');
    return wrap;
  };

  div.appendChild(mkField('Game Title', 'sub-game', sub.game));
  div.appendChild(mkField('System', 'sub-system', sub.system, () => knownSystems));
  div.appendChild(mkChipField('Genre', 'sub-genre', sub.genre, () => knownGenres, 'Type a genre and press Enter…'));
  div.appendChild(mkChipField('Players', 'sub-players', sub.players, () => knownPlayerHandles, 'Type a name and press Enter…'));

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
  gGenreChip.setFromString('');
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
  gGenreChip.setFromString(data.genre || '');
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
// STREAMS
// ══════════════════════════════════════════════════════════════════════════

const streamsCache = new Map();
let editingStreamId = null;

const streamForm      = document.getElementById('streamForm');
const streamModalTitle = document.getElementById('streamModalTitle');
const streamSubmitBtn  = document.getElementById('streamSubmitBtn');
const streamStatus     = document.getElementById('streamStatus');
const sPlatformSelect  = document.getElementById('s-platform');
const sTwitchField     = document.getElementById('s-twitch-field');
const sYoutubeField    = document.getElementById('s-youtube-field');

function updateStreamPlatformFields() {
  const isTwitch = sPlatformSelect.value === 'twitch';
  sTwitchField.hidden  = !isTwitch;
  sYoutubeField.hidden = isTwitch;
}
sPlatformSelect.addEventListener('change', updateStreamPlatformFields);

function openAddStream() {
  editingStreamId = null;
  streamForm.reset();
  setStatus(streamStatus, '', '');
  document.getElementById('s-order').value = streamsCache.size;
  document.getElementById('s-active').checked = true;
  updateStreamPlatformFields();
  streamModalTitle.textContent = 'Add a Stream';
  streamSubmitBtn.textContent = 'Add Stream';
  openModal(streamModal);
}

function openEditStream(id) {
  const data = streamsCache.get(id);
  if (!data) return;
  editingStreamId = id;
  setStatus(streamStatus, '', '');
  document.getElementById('s-label').value = data.label || '';
  sPlatformSelect.value = data.platform || 'twitch';
  document.getElementById('s-order').value = data.order != null ? data.order : 0;
  document.getElementById('s-channel').value = data.channelName || '';
  document.getElementById('s-youtube-id').value = data.youtubeEmbedId || '';
  document.getElementById('s-active').checked = data.active !== false;
  updateStreamPlatformFields();
  streamModalTitle.textContent = 'Edit Stream';
  streamSubmitBtn.textContent = 'Save Changes';
  openModal(streamModal);
}

document.getElementById('openAddStreamBtn').addEventListener('click', openAddStream);

async function loadStreamsTable() {
  try {
    const snap = await getDocs(query(collection(db, 'streams'), orderBy('order')));
    streamsCache.clear();
    snap.docs.forEach(d => streamsCache.set(d.id, d.data()));
    renderStreamsTable();
  } catch (e) {
    console.error('Could not load streams', e);
    document.getElementById('streamsTableBody').innerHTML =
      '<tr><td colspan="6" class="admin-table-empty">Error loading streams.</td></tr>';
  }
}

function renderStreamsTable() {
  const tbody = document.getElementById('streamsTableBody');
  tbody.innerHTML = '';

  if (streamsCache.size === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="admin-table-empty">No streams yet.</td></tr>';
    return;
  }

  Array.from(streamsCache.entries()).forEach(([id, data]) => {
    tbody.appendChild(renderStreamRow(id, data));
  });
}

function renderStreamRow(id, data) {
  const tr = document.createElement('tr');
  const channelOrId = data.platform === 'youtube' ? (data.youtubeEmbedId || '') : (data.channelName || '');
  tr.innerHTML = `
    <td>${escHtml(data.order != null ? data.order : 0)}</td>
    <td>${escHtml(data.label)}</td>
    <td>${escHtml(data.platform)}</td>
    <td>${escHtml(channelOrId)}</td>
    <td>${data.active !== false ? 'Yes' : 'No'}</td>
    <td class="admin-row-actions">
      <div class="admin-row-actions-inner">
        <button class="admin-row-btn edit">Edit</button>
        <button class="admin-row-btn delete">Delete</button>
      </div>
    </td>
  `;
  tr.querySelector('.edit').addEventListener('click', () => openEditStream(id));
  tr.querySelector('.delete').addEventListener('click', () => confirmDeleteStream(id, data.label));
  return tr;
}

async function confirmDeleteStream(id, label) {
  if (!confirm(`Delete stream "${label}"? This cannot be undone.`)) return;
  const before = streamsCache.get(id);
  try {
    await deleteDoc(doc(db, 'streams', id));
    await logHistory('delete', 'stream', id, label, { deleted: before });
    await loadStreamsTable();
  } catch (e) {
    console.error(e);
    alert('Error deleting stream: ' + e.message);
  }
}

streamForm.addEventListener('submit', async e => {
  e.preventDefault();

  const label     = document.getElementById('s-label').value.trim();
  const platform  = sPlatformSelect.value;
  const order     = parseInt(document.getElementById('s-order').value, 10) || 0;
  const channelName    = document.getElementById('s-channel').value.trim();
  const youtubeEmbedId = document.getElementById('s-youtube-id').value.trim();
  const active    = document.getElementById('s-active').checked;

  if (!label) {
    setStatus(streamStatus, 'Label is required.', 'error');
    return;
  }
  if (platform === 'twitch' && !channelName) {
    setStatus(streamStatus, 'Twitch Channel Name is required.', 'error');
    return;
  }
  if (platform === 'youtube' && !youtubeEmbedId) {
    setStatus(streamStatus, 'YouTube Live Video ID is required.', 'error');
    return;
  }

  streamSubmitBtn.disabled = true;
  setStatus(streamStatus, 'Saving…', '');

  const isEdit = editingStreamId !== null;
  const newData = {
    label, platform, order, channelName, youtubeEmbedId, active,
    updatedAt: serverTimestamp(),
  };

  try {
    if (isEdit) {
      const before = streamsCache.get(editingStreamId);
      await setDoc(doc(db, 'streams', editingStreamId), newData, { merge: true });
      await logHistory('edit', 'stream', editingStreamId, label, diffFields(before, newData));
      setStatus(streamStatus, `"${label}" updated successfully.`, 'success');
    } else {
      newData.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'streams'), newData);
      await logHistory('add', 'stream', ref.id, label, { created: newData });
      setStatus(streamStatus, `"${label}" added successfully.`, 'success');
    }
    await loadStreamsTable();
    closeModal(streamModal);
  } catch (err) {
    console.error(err);
    setStatus(streamStatus, 'Error: ' + err.message, 'error');
  } finally {
    streamSubmitBtn.disabled = false;
  }
});

// ══════════════════════════════════════════════════════════════════════════
// SCHEDULE
// ══════════════════════════════════════════════════════════════════════════

const scheduleCache = new Map();
let editingScheduleId = null;

const scheduleForm      = document.getElementById('scheduleForm');
const scheduleModalTitle = document.getElementById('scheduleModalTitle');
const scheduleSubmitBtn  = document.getElementById('scheduleSubmitBtn');
const scheduleStatus     = document.getElementById('scheduleStatus');

function toDatetimeLocalValue(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openAddSchedule() {
  editingScheduleId = null;
  scheduleForm.reset();
  setStatus(scheduleStatus, '', '');
  scheduleModalTitle.textContent = 'Add a Schedule Item';
  scheduleSubmitBtn.textContent = 'Add Schedule Item';
  openModal(scheduleModal);
}

function openEditSchedule(id) {
  const data = scheduleCache.get(id);
  if (!data) return;
  editingScheduleId = id;
  setStatus(scheduleStatus, '', '');
  document.getElementById('sch-title').value = data.title || '';
  document.getElementById('sch-description').value = data.description || '';
  document.getElementById('sch-start').value = toDatetimeLocalValue(data.startTime);
  document.getElementById('sch-end').value = toDatetimeLocalValue(data.endTime);
  document.getElementById('sch-pinned').checked = !!data.pinned;
  scheduleModalTitle.textContent = 'Edit Schedule Item';
  scheduleSubmitBtn.textContent = 'Save Changes';
  openModal(scheduleModal);
}

document.getElementById('openAddScheduleBtn').addEventListener('click', openAddSchedule);

async function loadScheduleTable() {
  try {
    const snap = await getDocs(query(collection(db, 'schedule'), orderBy('startTime')));
    scheduleCache.clear();
    snap.docs.forEach(d => scheduleCache.set(d.id, d.data()));
    renderScheduleTable();
  } catch (e) {
    console.error('Could not load schedule', e);
    document.getElementById('scheduleTableBody').innerHTML =
      '<tr><td colspan="5" class="admin-table-empty">Error loading schedule.</td></tr>';
  }
}

function renderScheduleTable() {
  const tbody = document.getElementById('scheduleTableBody');
  tbody.innerHTML = '';

  if (scheduleCache.size === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="admin-table-empty">No schedule items yet.</td></tr>';
    return;
  }

  Array.from(scheduleCache.entries()).forEach(([id, data]) => {
    tbody.appendChild(renderScheduleRow(id, data));
  });
}

function renderScheduleRow(id, data) {
  const tr = document.createElement('tr');
  const start = data.startTime && data.startTime.toDate ? data.startTime.toDate().toLocaleString() : '';
  const end   = data.endTime && data.endTime.toDate ? data.endTime.toDate().toLocaleString() : '';
  tr.innerHTML = `
    <td>${escHtml(start)}</td>
    <td>${escHtml(end)}</td>
    <td>${escHtml(data.title)}</td>
    <td>${data.pinned ? 'Yes' : 'No'}</td>
    <td class="admin-row-actions">
      <div class="admin-row-actions-inner">
        <button class="admin-row-btn edit">Edit</button>
        <button class="admin-row-btn delete">Delete</button>
      </div>
    </td>
  `;
  tr.querySelector('.edit').addEventListener('click', () => openEditSchedule(id));
  tr.querySelector('.delete').addEventListener('click', () => confirmDeleteSchedule(id, data.title));
  return tr;
}

async function confirmDeleteSchedule(id, title) {
  if (!confirm(`Delete schedule item "${title}"? This cannot be undone.`)) return;
  const before = scheduleCache.get(id);
  try {
    await deleteDoc(doc(db, 'schedule', id));
    await logHistory('delete', 'schedule', id, title, { deleted: before });
    await loadScheduleTable();
  } catch (e) {
    console.error(e);
    alert('Error deleting schedule item: ' + e.message);
  }
}

scheduleForm.addEventListener('submit', async e => {
  e.preventDefault();

  const title       = document.getElementById('sch-title').value.trim();
  const description = document.getElementById('sch-description').value.trim();
  const startVal    = document.getElementById('sch-start').value;
  const endVal      = document.getElementById('sch-end').value;
  const pinned      = document.getElementById('sch-pinned').checked;

  if (!title || !startVal) {
    setStatus(scheduleStatus, 'Title and Start Time are required.', 'error');
    return;
  }

  scheduleSubmitBtn.disabled = true;
  setStatus(scheduleStatus, 'Saving…', '');

  const isEdit = editingScheduleId !== null;
  const newData = {
    title, description,
    startTime: Timestamp.fromDate(new Date(startVal)),
    endTime: endVal ? Timestamp.fromDate(new Date(endVal)) : null,
    pinned,
    updatedAt: serverTimestamp(),
  };

  try {
    if (isEdit) {
      const before = scheduleCache.get(editingScheduleId);
      await setDoc(doc(db, 'schedule', editingScheduleId), newData, { merge: true });
      await logHistory('edit', 'schedule', editingScheduleId, title, diffFields(before, newData));
      setStatus(scheduleStatus, `"${title}" updated successfully.`, 'success');
    } else {
      newData.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'schedule'), newData);
      await logHistory('add', 'schedule', ref.id, title, { created: newData });
      setStatus(scheduleStatus, `"${title}" added successfully.`, 'success');
    }
    await loadScheduleTable();
    closeModal(scheduleModal);
  } catch (err) {
    console.error(err);
    setStatus(scheduleStatus, 'Error: ' + err.message, 'error');
  } finally {
    scheduleSubmitBtn.disabled = false;
  }
});

// ══════════════════════════════════════════════════════════════════════════
// LIVE EVENT (isLive toggle + donation settings — singleton siteConfig docs)
// ══════════════════════════════════════════════════════════════════════════

const liveForm = document.getElementById('liveForm');
const liveStatus = document.getElementById('liveStatus');
const liveStatusBadge = document.getElementById('liveStatusBadge');

function updateLiveStatusBadge(isLive) {
  liveStatusBadge.textContent = isLive ? 'LIVE' : 'OFFLINE';
  liveStatusBadge.className = 'history-action ' + (isLive ? 'add' : 'delete');
}

async function loadLiveConfig() {
  try {
    const snap = await getDoc(doc(db, 'siteConfig', 'liveEvent'));
    const data = snap.exists() ? snap.data() : {};
    document.getElementById('live-isLive').checked = !!data.isLive;
    document.getElementById('live-title').value = data.liveTitle || '';
    updateLiveStatusBadge(!!data.isLive);
  } catch (e) {
    console.error('Could not load live config', e);
  }
}

liveForm.addEventListener('submit', async e => {
  e.preventDefault();
  const isLive = document.getElementById('live-isLive').checked;
  const liveTitle = document.getElementById('live-title').value.trim();
  const submitBtn = document.getElementById('liveSubmitBtn');

  submitBtn.disabled = true;
  setStatus(liveStatus, 'Saving…', '');
  try {
    const user = auth.currentUser;
    await setDoc(doc(db, 'siteConfig', 'liveEvent'), {
      isLive, liveTitle,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }, { merge: true });
    await logHistory('edit', 'siteConfig', 'liveEvent', 'Live Mode', { isLive, liveTitle });
    updateLiveStatusBadge(isLive);
    setStatus(liveStatus, 'Live settings saved.', 'success');
  } catch (err) {
    console.error(err);
    setStatus(liveStatus, 'Error: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

const scheduleViewForm = document.getElementById('scheduleViewForm');
const scheduleViewStatus = document.getElementById('scheduleViewStatus');

async function loadScheduleViewConfig() {
  try {
    const snap = await getDoc(doc(db, 'siteConfig', 'liveEvent'));
    const data = snap.exists() ? snap.data() : {};
    document.getElementById('schedule-view-mode').value = data.scheduleViewMode || 'list';
  } catch (e) {
    console.error('Could not load schedule view config', e);
  }
}

scheduleViewForm.addEventListener('submit', async e => {
  e.preventDefault();
  const scheduleViewMode = document.getElementById('schedule-view-mode').value;
  const submitBtn = document.getElementById('scheduleViewSubmitBtn');

  submitBtn.disabled = true;
  setStatus(scheduleViewStatus, 'Saving…', '');
  try {
    const user = auth.currentUser;
    await setDoc(doc(db, 'siteConfig', 'liveEvent'), {
      scheduleViewMode,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }, { merge: true });
    await logHistory('edit', 'siteConfig', 'liveEvent', 'Schedule Display', { scheduleViewMode });
    setStatus(scheduleViewStatus, 'Schedule display saved.', 'success');
  } catch (err) {
    console.error(err);
    setStatus(scheduleViewStatus, 'Error: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

const donationForm = document.getElementById('donationForm');
const donationStatus = document.getElementById('donationStatus');

async function loadDonationConfig() {
  try {
    const snap = await getDoc(doc(db, 'siteConfig', 'donation'));
    const data = snap.exists() ? snap.data() : {};
    document.getElementById('don-enabled').checked = data.enabled !== false;
    document.getElementById('don-headline').value = data.headline || '';
    document.getElementById('don-blurb').value = data.blurb || '';
    document.getElementById('don-primary-label').value = data.primaryLinkLabel || '';
    document.getElementById('don-primary-url').value = data.primaryLinkUrl || '';
    document.getElementById('don-secondary-label').value = data.secondaryLinkLabel || '';
    document.getElementById('don-secondary-url').value = data.secondaryLinkUrl || '';
    document.getElementById('don-goal').value = data.goalAmount != null ? data.goalAmount : '';
    document.getElementById('don-raised').value = data.raisedAmount != null ? data.raisedAmount : '';
  } catch (e) {
    console.error('Could not load donation config', e);
  }
}

donationForm.addEventListener('submit', async e => {
  e.preventDefault();
  const submitBtn = document.getElementById('donationSubmitBtn');
  const goalVal = document.getElementById('don-goal').value;
  const raisedVal = document.getElementById('don-raised').value;

  const newData = {
    enabled: document.getElementById('don-enabled').checked,
    headline: document.getElementById('don-headline').value.trim(),
    blurb: document.getElementById('don-blurb').value.trim(),
    primaryLinkLabel: document.getElementById('don-primary-label').value.trim(),
    primaryLinkUrl: document.getElementById('don-primary-url').value.trim(),
    secondaryLinkLabel: document.getElementById('don-secondary-label').value.trim(),
    secondaryLinkUrl: document.getElementById('don-secondary-url').value.trim(),
    goalAmount: goalVal ? Number(goalVal) : null,
    raisedAmount: raisedVal ? Number(raisedVal) : null,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser.uid,
  };

  submitBtn.disabled = true;
  setStatus(donationStatus, 'Saving…', '');
  try {
    await setDoc(doc(db, 'siteConfig', 'donation'), newData, { merge: true });
    await logHistory('edit', 'siteConfig', 'donation', 'Donation Settings', newData);
    setStatus(donationStatus, 'Donation settings saved.', 'success');
  } catch (err) {
    console.error(err);
    setStatus(donationStatus, 'Error: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// ══════════════════════════════════════════════════════════════════════════
// MANAGE GENRES
// ══════════════════════════════════════════════════════════════════════════

const genreListView       = document.getElementById('genreListView');
const genreRenameView     = document.getElementById('genreRenameView');
const genreSearchInput    = document.getElementById('genreSearchInput');
const genreListResults    = document.getElementById('genreListResults');
const genreRenameFromLabel = document.getElementById('genreRenameFromLabel');
const genreRenameToInput  = document.getElementById('genreRenameToInput');
const genreAffectedList   = document.getElementById('genreAffectedList');
const genreRenameStatus   = document.getElementById('genreRenameStatus');
const genreRenameConfirmBtn = document.getElementById('genreRenameConfirmBtn');

let genreRenameTarget = null; // { genre, count, gameIds } for the genre currently being renamed

function getGenreUsage() {
  const usage = new Map(); // genreValue -> { count, gameIds: Set<string> }
  function record(genreStr, docId) {
    (genreStr || '').split(PLAYER_SEPARATOR_REGEX).map(g => g.trim()).filter(Boolean).forEach(g => {
      if (!usage.has(g)) usage.set(g, { count: 0, gameIds: new Set() });
      const entry = usage.get(g);
      entry.count++;
      entry.gameIds.add(docId);
    });
  }
  gamesCache.forEach((data, id) => {
    record(data.genre, id);
    (data.subs || []).forEach(s => record(s.genre, id));
  });
  return usage;
}

function renderGenreList(term) {
  const usage = getGenreUsage();
  const entries = [...usage.entries()]
    .filter(([g]) => !term || g.toLowerCase().includes(term.toLowerCase()))
    .sort((a, b) => a[0].localeCompare(b[0]));

  genreListResults.innerHTML = '';
  if (entries.length === 0) {
    genreListResults.innerHTML = '<li class="admin-table-empty">No matching genres found.</li>';
    return;
  }
  entries.forEach(([genre, { count, gameIds }]) => {
    const li = document.createElement('li');
    li.textContent = `${genre} (${count} beat${count === 1 ? '' : 's'} in ${gameIds.size} game${gameIds.size === 1 ? '' : 's'})`;
    li.addEventListener('click', () => openGenreRenameView(genre, { count, gameIds }));
    genreListResults.appendChild(li);
  });
}

function openGenreRenameView(genre, { count, gameIds }) {
  genreRenameTarget = { genre, count, gameIds };
  genreRenameFromLabel.textContent = `"${genre}" — used by ${gameIds.size} game${gameIds.size === 1 ? '' : 's'}`;

  const names = [...gameIds].map(id => gamesCache.get(id)?.game).filter(Boolean);
  const shown = names.slice(0, 10);
  genreAffectedList.innerHTML = shown.map(n => `<div>${escHtml(n)}</div>`).join('')
    + (names.length > 10 ? `<div>…and ${names.length - 10} more</div>` : '');

  genreRenameToInput.value = genre;
  setStatus(genreRenameStatus, '', '');
  genreListView.hidden = true;
  genreRenameView.hidden = false;
  genreRenameToInput.focus();
  genreRenameToInput.select();
}

async function applyGenreRename(fromGenre, toGenre) {
  const usage = getGenreUsage();
  const entry = usage.get(fromGenre);
  if (!entry) return;

  const renameToken = (str) => (str || '')
    .split(PLAYER_SEPARATOR_REGEX).map(g => g.trim()).filter(Boolean)
    .map(g => g === fromGenre ? toGenre : g)
    .filter((g, i, arr) => arr.indexOf(g) === i)
    .join(' / ');

  const batch = writeBatch(db);
  const historyEntries = [];

  entry.gameIds.forEach(docId => {
    const before = gamesCache.get(docId);
    if (!before) return;
    const after = {
      ...before,
      genre: renameToken(before.genre),
      subs: (before.subs || []).map(s => ({ ...s, genre: renameToken(s.genre) })),
    };
    batch.set(doc(db, 'games', docId), after, { merge: true });
    historyEntries.push({ docId, gameName: before.game, before, after });
  });

  await batch.commit();
  for (const h of historyEntries) {
    await logHistory('edit', 'game', h.docId, h.gameName, diffFields(h.before, h.after));
  }
  await loadGamesTable();
  populateDatalistsFromFirestore();
}

document.getElementById('manageGenresBtn').addEventListener('click', () => {
  genreListView.hidden = false;
  genreRenameView.hidden = true;
  genreSearchInput.value = '';
  renderGenreList('');
  openModal(genreModal);
});

genreSearchInput.addEventListener('input', () => renderGenreList(genreSearchInput.value.trim()));

document.getElementById('genreRenameBackBtn').addEventListener('click', () => {
  genreRenameView.hidden = true;
  genreListView.hidden = false;
  renderGenreList(genreSearchInput.value.trim());
});

genreRenameConfirmBtn.addEventListener('click', async () => {
  if (!genreRenameTarget) return;
  const fromGenre = genreRenameTarget.genre;
  const toGenre = genreRenameToInput.value.trim();

  if (!toGenre) {
    setStatus(genreRenameStatus, 'Enter a name to rename this genre to.', 'error');
    return;
  }
  if (toGenre === fromGenre) {
    setStatus(genreRenameStatus, 'That is already the current name.', 'error');
    return;
  }

  const count = genreRenameTarget.gameIds.size;
  if (!confirm(`Rename "${fromGenre}" to "${toGenre}" across ${count} game${count === 1 ? '' : 's'}? This cannot be undone.`)) {
    return;
  }

  genreRenameConfirmBtn.disabled = true;
  setStatus(genreRenameStatus, 'Renaming…', '');
  try {
    await applyGenreRename(fromGenre, toGenre);
    setStatus(genreRenameStatus, `Renamed "${fromGenre}" to "${toGenre}" across ${count} game${count === 1 ? '' : 's'}.`, 'success');
    genreRenameTarget = null;
    genreRenameView.hidden = true;
    genreListView.hidden = false;
    renderGenreList(genreSearchInput.value.trim());
  } catch (err) {
    console.error(err);
    setStatus(genreRenameStatus, 'Error: ' + err.message, 'error');
  } finally {
    genreRenameConfirmBtn.disabled = false;
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

  const { directRecords } = computePlayerStatsFromGames(data.playerKey || '');
  populateBeatSelect('p-best', directRecords, data.bestBeat);
  populateBeatSelect('p-worst', directRecords, data.worstBeat);

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
  populateBeatSelect('p-best', []);
  populateBeatSelect('p-worst', []);
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
  if (!playerKey) return false;
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

function populateBeatSelect(selectId, directRecords, selectedValue) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="">— Select a beat —</option>';
  const seen = new Set();
  directRecords.forEach(r => {
    if (!r.game || seen.has(r.game)) return;
    seen.add(r.game);
    const opt = document.createElement('option');
    opt.value = r.game;
    opt.textContent = r.event ? `${r.game} (${r.event})` : r.game;
    select.appendChild(opt);
  });

  if (selectedValue) {
    if (!seen.has(selectedValue)) {
      const opt = document.createElement('option');
      opt.value = selectedValue;
      opt.textContent = `${selectedValue} (not in matched beats)`;
      select.appendChild(opt);
    }
    select.value = selectedValue;
  }
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
  populateBeatSelect('pc-best', stats.directRecords);
  populateBeatSelect('pc-worst', stats.directRecords);
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
  populateBeatSelect('p-best', stats.directRecords, document.getElementById('pc-best').value);
  populateBeatSelect('p-worst', stats.directRecords, document.getElementById('pc-worst').value);
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
