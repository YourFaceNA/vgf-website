/**
 * ONE-TIME SCRIPT — Import player cards from player-profiles.html into Firestore.
 *
 * Prerequisites:
 *   npm install firebase-admin node-html-parser
 *
 * Usage:
 *   1. Ensure serviceAccountKey.json is in the project root (it is in .gitignore — never commit it)
 *   2. Run: node scripts/seed-players.js
 *
 * Safe to run multiple times — uses the player key (real name) as the document ID.
 */

const admin = require('firebase-admin');
const { parse } = require('node-html-parser');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// --- Parse player cards from player-profiles.html ---
const htmlPath = path.join(__dirname, '..', 'player-profiles.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const root = parse(html);

const cards = root.querySelectorAll('.player-card[data-player-key]');
console.log(`Found ${cards.length} player cards`);

const players = cards.map(card => {
  const key      = card.getAttribute('data-player-key') || '';
  const handle   = card.getAttribute('data-player-handle') || key;
  const imgAttr  = card.getAttribute('data-player-img') || '';
  const location = card.getAttribute('data-location') || '';
  const debut    = card.getAttribute('data-debut') || '';
  const bestBeat  = card.getAttribute('data-best-beat') || '';
  const worstBeat = card.getAttribute('data-worst-beat') || '';

  // Parse display name from h3 (handle) and .player-tag (real name)
  const displayName = card.querySelector('h3')?.text?.trim() || handle;
  const realName    = card.querySelector('.player-tag')?.text?.trim() || key;

  // Parse stats
  const statVals    = card.querySelectorAll('.stat-val').map(el => el.text.trim());
  const statLabels  = card.querySelectorAll('.stat-label').map(el => el.text.trim());
  const statsMap = {};
  statLabels.forEach((label, i) => {
    statsMap[label.toLowerCase()] = parseInt(statVals[i], 10) || 0;
  });

  // Parse most played genre
  const faveEl = card.querySelector('.player-fave span');
  const favoriteGenre = faveEl ? faveEl.text.trim() : '';

  return {
    playerKey:    key,
    handle:       displayName,
    realName:     realName,
    photoUrl:     imgAttr,   // local path initially; update after uploading to Firebase Storage
    location:     location,
    debut:        debut,
    bestBeat:     bestBeat,
    worstBeat:    worstBeat,
    events:       statsMap['events']  || 0,
    games:        statsMap['games']   || 0,
    mvps:         statsMap['mvps']    || 0,
    favoriteGenre: favoriteGenre,
  };
});

// --- Write to Firestore ---
async function seedPlayers() {
  const playersRef = db.collection('players');
  let batch = db.batch();
  let count = 0;

  for (const player of players) {
    // Use playerKey as the stable document ID
    const docId = player.playerKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const docRef = playersRef.doc(docId);
    batch.set(docRef, player);
    count++;

    if (count % 500 === 0) {
      await batch.commit();
      console.log(`  Committed ${count} documents...`);
      batch = db.batch();
    }
  }

  if (count % 500 !== 0) {
    await batch.commit();
  }

  console.log(`Done. Wrote ${count} player documents to Firestore.`);
  process.exit(0);
}

seedPlayers().catch(err => {
  console.error('Error seeding players:', err);
  process.exit(1);
});
