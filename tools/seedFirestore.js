#!/usr/bin/env node
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Safety: require explicit consent to seed a non-emulator project.
const safeToRun = Boolean(process.env.FIRESTORE_EMULATOR_HOST) || process.env.SEED_FORCE === '1';
if (!safeToRun) {
  console.error('Refusing to run seed script: FIRESTORE_EMULATOR_HOST not set and SEED_FORCE != 1.');
  console.error('To seed the emulator set FIRESTORE_EMULATOR_HOST=localhost:8085 and run this script.');
  console.error('To seed a real project set SEED_FORCE=1 (be careful!).');
  process.exit(1);
}

function initAdmin() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const sa = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id || process.env.GCLOUD_PROJECT || 'local-project' });
      console.log('Firebase Admin initialized using service account');
      return;
    } catch (e) {
      console.warn('Failed to load service account from GOOGLE_APPLICATION_CREDENTIALS:', e && e.message);
    }
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'local-project' });
    console.log('Firebase Admin initialized for emulator with projectId local-project');
    return;
  }
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log('Firebase Admin initialized using Application Default Credentials');
  } catch (e) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'local-project' });
    console.warn('Initialized Firebase Admin with fallback projectId=local-project');
  }
}

initAdmin();
const firestore = admin.firestore();

async function writeBatchDocs(collection, docs) {
  const BATCH_SIZE = 400; // keep under 500
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = firestore.batch();
    chunk.forEach(doc => {
      const id = String(doc.id || (Math.random().toString(36).slice(2, 10)));
      const ref = firestore.collection(collection).doc(id);
      batch.set(ref, doc, { merge: false });
    });
    await batch.commit();
    console.log(`Wrote ${Math.min(i + BATCH_SIZE, docs.length)} / ${docs.length} to ${collection}`);
  }
}

(async function main() {
  try {
    const root = path.join(__dirname, '..');
    const picksPath = path.join(root, 'picks.json');
    const dailyPath = path.join(root, 'dailyPicks.json');
    const scoreboardPath = path.join(root, 'scoreboard.json');

    // Read files (use disk fallback if missing)
    let picks = [];
    try {
      picks = JSON.parse(fs.readFileSync(picksPath, 'utf8')) || [];
    } catch (e) {
      console.warn('No picks.json found or parse failed, skipping picks seed.');
    }

    let daily = [];
    try {
      daily = JSON.parse(fs.readFileSync(dailyPath, 'utf8')) || [];
    } catch (e) {
      console.warn('No dailyPicks.json found or parse failed, skipping daily picks seed.');
    }

    let scoreboard = { users: [] };
    try {
      scoreboard = JSON.parse(fs.readFileSync(scoreboardPath, 'utf8')) || { users: [] };
    } catch (e) {
      console.warn('No scoreboard.json found or parse failed, skipping scoreboard seed.');
    }

    if (picks.length) {
      console.log('Seeding picks to Firestore...', picks.length);
      await writeBatchDocs('picks', picks);
    } else {
      console.log('No picks to seed.');
    }

    if (daily.length) {
      console.log('Seeding dailyPicks (doc: current) with', daily.length, 'entries');
      await firestore.collection('dailyPicks').doc('current').set({ picks: daily, seededAt: admin.firestore.FieldValue.serverTimestamp() });
    } else {
      console.log('No daily picks to seed.');
    }

    if (scoreboard && (Array.isArray(scoreboard.users) && scoreboard.users.length)) {
      console.log('Seeding scoreboard (doc: main) with', scoreboard.users.length, 'users');
      await firestore.collection('scoreboard').doc('main').set({ payload: scoreboard, seededAt: admin.firestore.FieldValue.serverTimestamp() });
    } else {
      console.log('No scoreboard entries to seed.');
    }

    console.log('Seed complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err && err.message);
    process.exit(2);
  }
})();
