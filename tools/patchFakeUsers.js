#!/usr/bin/env node
// One-off patch: fix 3 screenNames in production Firestore
// Run: SEED_FORCE=1 node tools/patchFakeUsers.js
const safeToRun = process.env.SEED_FORCE === '1' || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!safeToRun) { console.error('Set SEED_FORCE=1'); process.exit(1); }

const admin = require('firebase-admin');
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const sa = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id || 'pickr-d4d9b' });
  } else if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'local-project' });
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'pickr-d4d9b' });
  }
} catch(e) { console.warn(e.message); }

const db = admin.firestore();

const PATCHES = [
  { uid: 'fake-player-mokd6lv1-001', screenName: 'NightPicks' },
  { uid: 'fake-player-mokd6lv1-022', screenName: 'Zenith'     },
  { uid: 'fake-player-mokd6lv1-034', screenName: 'Jaylen'     },
];

(async () => {
  for (const p of PATCHES) {
    await db.collection('users').doc(p.uid).update({ screenName: p.screenName });
    console.log(`✓ ${p.uid} → screenName: "${p.screenName}"`);
  }
  console.log('Patch complete.');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
