/**
 * ONE-TIME SCRIPT — Import ALL_DATA from beats-list.html into Firestore.
 *
 * Prerequisites:
 *   npm install firebase-admin
 *
 * Usage:
 *   1. Download a service account key from Firebase console > Project Settings > Service Accounts
 *   2. Save it as serviceAccountKey.json in the project root (it is in .gitignore — never commit it)
 *   3. Run: node scripts/seed-games.js
 *
 * Safe to run multiple times — uses the game's sequential `num` as the document ID,
 * so re-running will overwrite, not duplicate.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// --- Extract ALL_DATA from beats-list.html ---
const htmlPath = path.join(__dirname, '..', 'beats-list.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const startIdx = html.indexOf('const ALL_DATA =');
if (startIdx === -1) {
  console.error('Could not find ALL_DATA in beats-list.html');
  process.exit(1);
}
const arrStart = html.indexOf('[', startIdx);
let depth = 0, i = arrStart, arrEnd = -1;
for (; i < html.length; i++) {
  if (html[i] === '[') depth++;
  else if (html[i] === ']') {
    depth--;
    if (depth === 0) { arrEnd = i; break; }
  }
}
if (arrEnd === -1) {
  console.error('Could not parse ALL_DATA array');
  process.exit(1);
}

const allData = JSON.parse(html.slice(arrStart, arrEnd + 1));
console.log(`Parsed ${allData.length} game records from beats-list.html`);

// --- Write to Firestore in batches of 500 ---
async function seedGames() {
  const gamesRef = db.collection('games');
  let batch = db.batch();
  let count = 0;

  for (const game of allData) {
    // Use event + num as a stable document ID to avoid duplicates on re-run
    const docId = `${game.event.replace(/\s+/g, '_')}_${game.num}`;
    const docRef = gamesRef.doc(docId);

    batch.set(docRef, {
      is_sub:    game.is_sub   ?? false,
      ref_num:   game.ref_num  ?? null,
      event:     game.event    || '',
      num:       game.num      ?? 0,
      game:      game.game     || '',
      system:    game.system   || '',
      genre:     game.genre    || '',
      players:   game.players  || '',
      hero_beat: game.hero_beat ?? false,
      subs:      game.subs     || [],
    });

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

  console.log(`Done. Wrote ${count} game documents to Firestore.`);
  process.exit(0);
}

seedGames().catch(err => {
  console.error('Error seeding games:', err);
  process.exit(1);
});
