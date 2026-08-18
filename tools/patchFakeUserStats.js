#!/usr/bin/env node
// Patches all fake users so wins/losses/streaks are internally consistent.
//   - Top-tier players have better win rates (Diamond ~76%, Bronze ~54%)
//   - streakWins is capped at wins
//   - totalBets = wins + losses
//   - tokenBalance and cash re-derived from points
// Run: SEED_FORCE=1 node tools/patchFakeUserStats.js

const safeToRun = process.env.SEED_FORCE === '1' || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!safeToRun) {
  console.error('Set SEED_FORCE=1 to run against production Firestore.');
  process.exit(1);
}

const admin = require('firebase-admin');

function initAdmin() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const sa = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id || 'pickr-d4d9b' });
      console.log('Initialized with service account');
      return;
    } catch (e) { console.warn('Service account load failed:', e.message); }
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'local-project' });
    return;
  }
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'pickr-d4d9b' });
  console.log('Initialized with Application Default Credentials');
}

initAdmin();
const db = admin.firestore();

// Loss multiplier by tier — higher rank = better win rate
// Diamond (5000+):  ~76% win rate → losses = wins * 0.32
// Platinum (3500+): ~72% win rate → losses = wins * 0.39
// Gold (2500+):     ~67% win rate → losses = wins * 0.50
// Silver (1500+):   ~61% win rate → losses = wins * 0.65
// Bronze (<1500):   ~54% win rate → losses = wins * 0.85
function lossMultiplier(points) {
  if (points >= 5000) return 0.32;
  if (points >= 3500) return 0.39;
  if (points >= 2500) return 0.50;
  if (points >= 1500) return 0.65;
  return 0.85;
}

async function run() {
  // Query all fake users
  const snap = await db.collection('users').where('isFake', '==', true).get();
  if (snap.empty) {
    console.log('No fake users found.');
    process.exit(0);
  }

  console.log(`Found ${snap.size} fake users. Patching stats…`);

  const BATCH_SIZE = 400;
  const docs = snap.docs;
  let patched = 0;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    chunk.forEach((doc) => {
      const d = doc.data();
      const points   = d.points   || 0;
      const wins     = (d.stats && d.stats.wins != null) ? d.stats.wins : (d.wins || 0);
      const streak   = d.streakWins || 0;

      // Losses — tier-based win rate
      const losses = Math.round(wins * lossMultiplier(points));

      // Streak can't exceed total wins, and shouldn't be implausibly high
      // Also cap at 15 as a realistic max hot streak
      const safeStreak = Math.min(streak, wins, 15);

      // Re-derive economy fields from points
      const tokenBalance = points * 2;
      const cash = parseFloat((points * 0.12).toFixed(2));

      batch.update(doc.ref, {
        streakWins: safeStreak,
        tokenBalance,
        cash,
        'stats.wins':       wins,
        'stats.losses':     losses,
        'stats.totalBets':  wins + losses,
        'stats.pending':    0,
      });

      patched++;
    });

    await batch.commit();
    console.log(`  ✓ Patched ${Math.min(i + BATCH_SIZE, docs.length)} / ${docs.length}`);
  }

  console.log(`Done! Patched ${patched} fake users.`);
  process.exit(0);
}

run().catch(err => {
  console.error('Patch failed:', err.message);
  process.exit(1);
});
