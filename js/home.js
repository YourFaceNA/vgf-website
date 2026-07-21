import {
  getFirestore, doc, getDoc, onSnapshot, collection, query, orderBy, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { app } from './firebase-config.js';

const db = getFirestore(app);

// ── Google Calendar setup (fill these in once the calendar is public) ──────
const GOOGLE_CALENDAR_API_KEY = 'AIzaSyDfUQqohcBD9ScGommVjLC7upG6UbixIPU';
const GOOGLE_CALENDAR_ID = '50a5fe82c65ef0de7386005f24fefefd0fc960b5111d84e3b1733aa98cc962c5@group.calendar.google.com';

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ── Live mode ────────────────────────────────────────────────────────────
let isLiveMode = false;
let scheduleViewMode = 'list'; // 'list' | 'grid' | 'timeGrid', admin-configurable

function initLiveMode() {
  onSnapshot(doc(db, 'siteConfig', 'liveEvent'), snap => {
    const data = snap.exists() ? snap.data() : {};
    isLiveMode = !!data.isLive;
    scheduleViewMode = data.scheduleViewMode || 'list';
    renderLiveBanner(data);
    document.body.classList.toggle('is-live', isLiveMode);
    renderSchedule(); // re-render with live styling / view mode toggled
  }, err => console.error('Live mode listener failed', err));
}

function renderLiveBanner(data) {
  const banner = document.getElementById('liveBanner');
  const multistream = document.getElementById('multistream');
  const watchLiveBtn = document.getElementById('watchLiveBtn');
  const hero = document.querySelector('.hero');
  const nextEvent = document.getElementById('next-event');
  if (!banner) return;

  banner.hidden = !isLiveMode;
  if (multistream) multistream.hidden = !isLiveMode;
  if (watchLiveBtn) watchLiveBtn.hidden = !isLiveMode;
  if (hero) hero.hidden = isLiveMode;
  if (nextEvent) nextEvent.hidden = isLiveMode;

  if (isLiveMode) {
    banner.innerHTML = `
      <span class="live-banner-dot"></span>
      <span class="live-banner-text">${escHtml(data.liveTitle || 'VGF is LIVE NOW')}</span>
      <a href="#multistream" class="live-banner-link">Watch Now ↓</a>
    `;
  }
}

// ── Streams (multistream grid) ──────────────────────────────────────────
function getEmbedParent() {
  return window.location.hostname || 'localhost';
}

function buildTwitchEmbedUrl(channelName) {
  const parent = getEmbedParent();
  return `https://player.twitch.tv/?channel=${encodeURIComponent(channelName)}&parent=${encodeURIComponent(parent)}&muted=true`;
}

function buildTwitchChatUrl(channelName) {
  const parent = getEmbedParent();
  return `https://www.twitch.tv/embed/${encodeURIComponent(channelName)}/chat?parent=${encodeURIComponent(parent)}&darkpopout`;
}

function buildYoutubeEmbedUrl(videoId) {
  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=0`;
}

let loadedStreams = [];
let currentLayout = 'focus'; // 'grid' | 'focus' | 'sideBySide'
let primaryStreamIndex = 0;
const tileCache = new Map(); // index -> tile DOM node, reused across renders so iframes don't reload

async function loadStreams() {
  try {
    const snap = await getDocs(query(collection(db, 'streams'), orderBy('order')));
    loadedStreams = snap.docs.map(d => d.data()).filter(s => s.active !== false);
    primaryStreamIndex = 0;
    tileCache.clear();
    renderMultistream();
  } catch (e) {
    console.error('Could not load streams', e);
  }
}

function setPrimaryStream(index) {
  primaryStreamIndex = index;
  if (currentLayout === 'grid') currentLayout = 'focus';
  renderMultistream();
}

function setLayout(layout) {
  currentLayout = layout;
  renderMultistream();
}

function rotateToNextStream() {
  if (loadedStreams.length === 0) return;
  primaryStreamIndex = (primaryStreamIndex + 1) % loadedStreams.length;
  if (currentLayout === 'grid') currentLayout = 'focus';
  renderMultistream();
}

function renderRotateButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rotate-streams-btn';
  btn.innerHTML = `
    <svg class="rotate-streams-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/>
    </svg>
    <span>Rotate</span>
  `;
  btn.addEventListener('click', rotateToNextStream);
  return btn;
}

// Intrinsic pixel size the iframe is always laid out at internally; CSS
// `transform: scale()` shrinks it visually for smaller slots without ever
// changing its actual rendered box, so Twitch/YouTube never see a resize.
const TILE_INTRINSIC_WIDTH = 960;

function rescaleStreamTile(tile) {
  const inner = tile.querySelector('.stream-tile-frame-inner');
  const frame = tile.querySelector('.stream-tile-frame');
  if (!inner || !frame) return;
  const scale = frame.clientWidth / TILE_INTRINSIC_WIDTH;
  inner.style.transform = `scale(${scale})`;
}

function renderStreamTile(stream, index, sizeClass) {
  const cached = tileCache.get(index);
  if (cached) {
    // Reuse the existing node (and its iframe) so the embedded player keeps
    // playing uninterrupted instead of reloading from scratch on every render.
    cached.className = `stream-tile ${sizeClass}`;
    requestAnimationFrame(() => rescaleStreamTile(cached));
    return cached;
  }

  const src = stream.platform === 'youtube'
    ? buildYoutubeEmbedUrl(stream.youtubeEmbedId)
    : buildTwitchEmbedUrl(stream.channelName);
  const tile = document.createElement('div');
  tile.className = `stream-tile ${sizeClass}`;
  tile.innerHTML = `
    <div class="stream-tile-label">${escHtml(stream.label)}</div>
    <div class="stream-tile-frame">
      <div class="stream-tile-frame-inner">
        <iframe
          src="${src}"
          allowfullscreen
          allow="autoplay; fullscreen"
          frameborder="0">
        </iframe>
      </div>
    </div>
  `;
  // Clicking the label switches focus; the video area itself stays fully
  // interactive (play/pause/volume) rather than being swallowed by a focus-switch.
  tile.querySelector('.stream-tile-label').addEventListener('click', () => setPrimaryStream(index));
  tileCache.set(index, tile);
  requestAnimationFrame(() => rescaleStreamTile(tile));
  return tile;
}

function renderThumbnailStrip(indices) {
  const strip = document.createElement('div');
  strip.className = 'stream-thumbnails';
  indices.forEach(i => strip.appendChild(renderStreamTile(loadedStreams[i], i, 'stream-tile--small')));
  return strip;
}

function renderMultistream() {
  const area = document.getElementById('streamArea');
  if (!area) return;

  document.querySelectorAll('.layout-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.layout === currentLayout)
  );

  if (loadedStreams.length === 0) {
    area.innerHTML = '<p class="stream-grid-empty">No streams are active right now.</p>';
    renderChatPanel();
    return;
  }

  if (primaryStreamIndex >= loadedStreams.length) primaryStreamIndex = 0;

  const wrappers = [];

  if (currentLayout === 'grid') {
    const grid = document.createElement('div');
    grid.className = 'stream-grid';
    loadedStreams.forEach((s, i) => grid.appendChild(renderStreamTile(s, i, 'stream-tile--grid')));
    wrappers.push(grid);
  } else if (currentLayout === 'focus') {
    const primaryWrap = document.createElement('div');
    primaryWrap.className = 'stream-focus-primary';
    primaryWrap.appendChild(renderStreamTile(loadedStreams[primaryStreamIndex], primaryStreamIndex, 'stream-tile--large'));
    primaryWrap.appendChild(renderRotateButton());
    wrappers.push(primaryWrap);

    const otherIndices = loadedStreams.map((_, i) => i).filter(i => i !== primaryStreamIndex);
    if (otherIndices.length > 0) wrappers.push(renderThumbnailStrip(otherIndices));
  } else if (currentLayout === 'sideBySide') {
    const secondaryIndex = loadedStreams.length > 1
      ? (primaryStreamIndex + 1) % loadedStreams.length
      : primaryStreamIndex;

    const pairWrap = document.createElement('div');
    pairWrap.className = 'stream-sidebyside-primary';
    pairWrap.appendChild(renderStreamTile(loadedStreams[primaryStreamIndex], primaryStreamIndex, 'stream-tile--large'));
    if (secondaryIndex !== primaryStreamIndex) {
      pairWrap.appendChild(renderStreamTile(loadedStreams[secondaryIndex], secondaryIndex, 'stream-tile--large'));
    }
    wrappers.push(pairWrap);

    const otherIndices = loadedStreams.map((_, i) => i).filter(i => i !== primaryStreamIndex && i !== secondaryIndex);
    if (otherIndices.length > 0) wrappers.push(renderThumbnailStrip(otherIndices));
  }

  // Wrapper divs (.stream-grid/.stream-focus-primary/.stream-thumbnails/etc.)
  // are always freshly built above — only the tiles *inside* them are cached
  // — so `area`'s own children are simply replaced each render; the cached
  // tiles were moved (not detached-then-recreated) into these fresh wrappers
  // via normal appendChild calls in renderStreamTile()/renderThumbnailStrip().
  area.replaceChildren(...wrappers);

  renderChatPanel();
}

function wireMultistreamControls() {
  document.querySelectorAll('.layout-btn[data-layout]').forEach(btn =>
    btn.addEventListener('click', () => setLayout(btn.dataset.layout))
  );

  const chatToggleBtn = document.getElementById('chatToggleBtn');
  if (chatToggleBtn) {
    chatToggleBtn.addEventListener('click', () => {
      document.getElementById('chatPanel').classList.toggle('chat-panel--collapsed');
    });
  }

  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      tileCache.forEach(tile => rescaleStreamTile(tile));
    }, 100);
  });
}

// ── Chat panel (Twitch only) ────────────────────────────────────────────
let renderedChatKey = null; // 'platform:channel' for whatever chat is currently in the DOM

function renderChatPanel() {
  const panel = document.getElementById('chatPanel');
  if (!panel) return;

  const primary = loadedStreams[primaryStreamIndex];
  if (!primary) {
    renderedChatKey = null;
    panel.innerHTML = '<p class="chat-panel-empty">No stream selected.</p>';
    return;
  }

  const key = `${primary.platform}:${primary.channelName || primary.youtubeEmbedId}`;
  if (key === renderedChatKey) return; // same stream already showing — don't reload the chat iframe
  renderedChatKey = key;

  if (primary.platform === 'twitch') {
    panel.innerHTML = `
      <iframe
        src="${buildTwitchChatUrl(primary.channelName)}"
        frameborder="0">
      </iframe>
    `;
  } else {
    panel.innerHTML = '<p class="chat-panel-empty">Chat isn\'t available for this stream.</p>';
  }
}

// ── Schedule ─────────────────────────────────────────────────────────────
let scheduleItems = [];

async function loadFirestoreSchedule() {
  try {
    const snap = await getDocs(query(collection(db, 'schedule'), orderBy('startTime')));
    return snap.docs.map(d => {
      const data = d.data();
      return {
        title: data.title,
        description: data.description || '',
        startTime: data.startTime && data.startTime.toDate ? data.startTime.toDate() : null,
        endTime: data.endTime && data.endTime.toDate ? data.endTime.toDate() : null,
        pinned: !!data.pinned,
        source: 'manual',
      };
    });
  } catch (e) {
    console.error('Could not load schedule', e);
    return [];
  }
}

async function loadGoogleCalendarEvents() {
  if (!GOOGLE_CALENDAR_API_KEY || !GOOGLE_CALENDAR_ID) return [];
  try {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events` +
      `?key=${encodeURIComponent(GOOGLE_CALENDAR_API_KEY)}&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(new Date().toISOString())}&maxResults=20`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Google Calendar API error', res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return (data.items || []).map(ev => ({
      title: ev.summary || '(untitled event)',
      description: ev.description || '',
      startTime: ev.start ? new Date(ev.start.dateTime || ev.start.date) : null,
      endTime: ev.end ? new Date(ev.end.dateTime || ev.end.date) : null,
      pinned: false,
      source: 'calendar',
    }));
  } catch (e) {
    console.error('Google Calendar fetch failed', e);
    return [];
  }
}

function mergeSchedule(manualItems, calendarItems) {
  return [...manualItems, ...calendarItems].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const at = a.startTime ? a.startTime.getTime() : Infinity;
    const bt = b.startTime ? b.startTime.getTime() : Infinity;
    return at - bt;
  });
}

async function loadSchedule() {
  const [manual, calendar] = await Promise.all([loadFirestoreSchedule(), loadGoogleCalendarEvents()]);
  scheduleItems = mergeSchedule(manual, calendar);
  renderSchedule();
}

// Groups a flat array of schedule items into ordered day buckets. Items with
// no startTime (shouldn't normally happen) fall into a trailing "Unscheduled"
// bucket. Shared by all three view-mode renderers.
function groupByDay(items) {
  const dayGroups = new Map(); // dayKey -> { label, date, items[] }
  items.forEach(item => {
    const dayKey = item.startTime ? item.startTime.toDateString() : 'unscheduled';
    if (!dayGroups.has(dayKey)) {
      dayGroups.set(dayKey, {
        label: item.startTime
          ? item.startTime.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
          : 'Unscheduled',
        date: item.startTime || null,
        items: [],
      });
    }
    dayGroups.get(dayKey).items.push(item);
  });
  return Array.from(dayGroups.values());
}

// Narrow/mobile viewports can't usefully show a multi-column calendar grid,
// so Grid and Time Grid modes both fall back to the List layout below this.
const SCHEDULE_GRID_MIN_WIDTH = 800;

function renderSchedule() {
  const section = document.getElementById('schedule');
  const mount = document.getElementById('scheduleList');
  if (!mount || !section) return;

  section.classList.toggle('schedule-section--live', isLiveMode);

  const items = isLiveMode ? scheduleItems : scheduleItems.slice(0, 5);

  if (items.length === 0) {
    mount.innerHTML = '<li class="admin-table-empty">No schedule items yet.</li>';
    return;
  }

  const effectiveMode = window.innerWidth < SCHEDULE_GRID_MIN_WIDTH ? 'list' : scheduleViewMode;

  if (effectiveMode === 'grid') {
    renderScheduleGrid(mount, items);
  } else if (effectiveMode === 'timeGrid') {
    renderScheduleTimeGrid(mount, items);
  } else {
    renderScheduleList(mount, items);
  }
}

function scheduleItemCard(item, now) {
  const isCurrent = isLiveMode && item.startTime && (
    item.startTime <= now && (!item.endTime || item.endTime >= now)
  );
  const timeLabel = item.startTime
    ? item.startTime.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';
  const sourceTag = item.source === 'calendar' ? '<span class="schedule-source-tag">Calendar</span>' : '';
  return { isCurrent, timeLabel, sourceTag };
}

function renderScheduleList(mount, items) {
  const now = new Date();
  mount.className = 'schedule-list';
  mount.innerHTML = groupByDay(items).map(group => {
    const itemsHtml = group.items.map(item => {
      const { isCurrent, timeLabel, sourceTag } = scheduleItemCard(item, now);
      return `
        <li class="schedule-item${isCurrent ? ' schedule-item--current' : ''}">
          <div class="schedule-item-time">${escHtml(timeLabel)}</div>
          <div class="schedule-item-body">
            <div class="schedule-item-title">${escHtml(item.title)}${sourceTag}</div>
            ${item.description ? `<div class="schedule-item-desc">${escHtml(item.description)}</div>` : ''}
          </div>
        </li>
      `;
    }).join('');
    return `
      <li class="schedule-day-group">
        <div class="schedule-day-heading">${escHtml(group.label)}</div>
        <ul class="schedule-day-items">${itemsHtml}</ul>
      </li>
    `;
  }).join('');
}

function renderScheduleGrid(mount, items) {
  const now = new Date();
  mount.className = '';
  const dayGroups = groupByDay(items);
  const columnsHtml = dayGroups.map(group => {
    const cardsHtml = group.items.map(item => {
      const { isCurrent, timeLabel, sourceTag } = scheduleItemCard(item, now);
      return `
        <div class="schedule-grid-card${isCurrent ? ' schedule-item--current' : ''}">
          <div class="schedule-item-time">${escHtml(timeLabel)}</div>
          <div class="schedule-item-title">${escHtml(item.title)}${sourceTag}</div>
          ${item.description ? `<div class="schedule-item-desc">${escHtml(item.description)}</div>` : ''}
        </div>
      `;
    }).join('');
    return `
      <div class="schedule-grid-column">
        <div class="schedule-day-heading">${escHtml(group.label)}</div>
        <div class="schedule-grid-cards">${cardsHtml}</div>
      </div>
    `;
  }).join('');
  mount.innerHTML = `<li class="schedule-grid">${columnsHtml}</li>`;
}

const TIME_GRID_START_HOUR = 8;   // 8am
const TIME_GRID_END_HOUR = 24;    // midnight
const TIME_GRID_PX_PER_HOUR = 60;

// Greedily assigns same-day overlapping items to side-by-side sub-columns so
// they never visually overlap. Returns each item annotated with its column
// index and the total column count for its overlap cluster.
function assignOverlapColumns(items) {
  const sorted = [...items]
    .filter(i => i.startTime)
    .sort((a, b) => a.startTime - b.startTime);
  const columns = []; // array of "last end time" per column
  const placed = sorted.map(item => {
    const start = item.startTime;
    const end = item.endTime && item.endTime > start ? item.endTime : new Date(start.getTime() + 30 * 60000);
    let colIndex = columns.findIndex(endTime => endTime <= start);
    if (colIndex === -1) {
      colIndex = columns.length;
      columns.push(end);
    } else {
      columns[colIndex] = end;
    }
    return { item, start, end, colIndex };
  });
  const totalColumns = Math.max(1, columns.length);
  return placed.map(p => ({ ...p, totalColumns }));
}

function renderScheduleTimeGrid(mount, items) {
  const now = new Date();
  mount.className = '';
  const dayGroups = groupByDay(items.filter(i => i.startTime));

  const hourLabels = [];
  for (let h = TIME_GRID_START_HOUR; h <= TIME_GRID_END_HOUR; h++) {
    const label = new Date(2000, 0, 1, h % 24).toLocaleTimeString(undefined, { hour: 'numeric' });
    hourLabels.push(`<div class="schedule-timegrid-hour">${escHtml(label)}</div>`);
  }
  const totalHeight = (TIME_GRID_END_HOUR - TIME_GRID_START_HOUR) * TIME_GRID_PX_PER_HOUR;

  const columnsHtml = dayGroups.map(group => {
    const placed = assignOverlapColumns(group.items);
    const eventsHtml = placed.map(({ item, start, end, colIndex, totalColumns }) => {
      const startHour = Math.max(TIME_GRID_START_HOUR, Math.min(TIME_GRID_END_HOUR, start.getHours() + start.getMinutes() / 60));
      const endHour = Math.max(startHour + 0.5, Math.min(TIME_GRID_END_HOUR, end.getHours() + end.getMinutes() / 60));
      const top = (startHour - TIME_GRID_START_HOUR) * TIME_GRID_PX_PER_HOUR;
      const height = Math.max(24, (endHour - startHour) * TIME_GRID_PX_PER_HOUR);
      const widthPct = 100 / totalColumns;
      const leftPct = widthPct * colIndex;
      const isCurrent = isLiveMode && item.startTime <= now && (!item.endTime || item.endTime >= now);
      const sourceTag = item.source === 'calendar' ? '<span class="schedule-source-tag">Calendar</span>' : '';
      return `
        <div class="schedule-timegrid-event${isCurrent ? ' schedule-item--current' : ''}"
             style="top:${top}px;height:${height}px;left:${leftPct}%;width:calc(${widthPct}% - 4px);">
          <div class="schedule-item-title">${escHtml(item.title)}${sourceTag}</div>
        </div>
      `;
    }).join('');
    return `
      <div class="schedule-timegrid-column-wrap">
        <div class="schedule-day-heading">${escHtml(group.label)}</div>
        <div class="schedule-timegrid-column" style="height:${totalHeight}px;">${eventsHtml}</div>
      </div>
    `;
  }).join('');

  mount.innerHTML = `
    <li class="schedule-timegrid">
      <div class="schedule-timegrid-axis-wrap">
        <div class="schedule-day-heading">&nbsp;</div>
        <div class="schedule-timegrid-axis" style="height:${totalHeight}px;">${hourLabels.join('')}</div>
      </div>
      ${columnsHtml}
    </li>
  `;
}

// ── Donation ─────────────────────────────────────────────────────────────
async function loadDonation() {
  try {
    const snap = await getDoc(doc(db, 'siteConfig', 'donation'));
    if (!snap.exists()) return;
    renderDonation(snap.data());
  } catch (e) {
    console.error('Could not load donation info', e);
  }
}

function renderDonation(data) {
  const block = document.getElementById('donationBlock');
  if (!block || data.enabled === false) return;

  let progressHtml = '';
  if (data.goalAmount) {
    const pct = Math.min(100, Math.round(((data.raisedAmount || 0) / data.goalAmount) * 100));
    progressHtml = `
      <div class="donation-progress-track">
        <div class="donation-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="donation-progress-label">$${escHtml((data.raisedAmount || 0).toLocaleString())} raised of $${escHtml(data.goalAmount.toLocaleString())} goal</div>
    `;
  }

  const links = [];
  if (data.primaryLinkUrl) {
    links.push(`<a href="${escHtml(data.primaryLinkUrl)}" class="cta-btn" style="background:linear-gradient(135deg,#1a3a8c,#3a6bff);color:#fff;box-shadow:var(--glow-blue);">${escHtml(data.primaryLinkLabel || 'Donate')}</a>`);
  }
  if (data.secondaryLinkUrl) {
    links.push(`<a href="${escHtml(data.secondaryLinkUrl)}" class="cta-btn" style="background:linear-gradient(135deg,#551a8c,#853aff);color:#fff;box-shadow:var(--glow-blue);">${escHtml(data.secondaryLinkLabel || 'Learn More')}</a>`);
  }

  block.innerHTML = `
    ${data.headline ? `<h3 class="donation-headline">${escHtml(data.headline)}</h3>` : ''}
    ${data.blurb ? `<p class="donation-blurb">${escHtml(data.blurb)}</p>` : ''}
    ${progressHtml}
    <div style="display:flex;gap:1rem;flex-wrap:wrap;">${links.join('')}</div>
  `;
}

function wireScheduleResize() {
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(renderSchedule, 150);
  });
}

// ── Bootstrap ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  wireMultistreamControls();
  wireScheduleResize();
  initLiveMode();
  loadStreams();
  loadDonation();
  loadSchedule();
});
