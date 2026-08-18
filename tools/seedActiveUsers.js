#!/usr/bin/env node
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const countArg = Number(args[0] || 50);
const count = Number.isFinite(countArg) ? Math.max(1, Math.min(300, Math.floor(countArg))) : 50;
const prefix = String(args[1] || 'player').trim() || 'player';
const sampleCountArg = Number(args[2] || 20);
const sampleCount = Number.isFinite(sampleCountArg) ? Math.max(5, Math.min(40, Math.floor(sampleCountArg))) : 20;

const LEDGER_PATH = path.join(__dirname, 'usedUserNames.json');

const safeToRun = Boolean(process.env.FIRESTORE_EMULATOR_HOST) || process.env.SEED_FORCE === '1';
if (!safeToRun) {
  console.error('Refusing to seed users: FIRESTORE_EMULATOR_HOST not set and SEED_FORCE != 1');
  console.error('Use emulator: set FIRESTORE_EMULATOR_HOST=localhost:8085');
  console.error('Use real project intentionally: set SEED_FORCE=1');
  process.exit(1);
}

function initAdmin() {
  if (admin.apps.length) return;

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'local-project' });
    console.log('Initialized Firebase Admin for Firestore emulator');
    return;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const sa = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
      admin.initializeApp({
        credential: admin.credential.cert(sa),
        projectId: sa.project_id || process.env.GCLOUD_PROJECT || 'local-project'
      });
      console.log('Initialized Firebase Admin with service account');
      return;
    } catch (err) {
      console.warn('Service account load failed, trying fallback:', err && err.message);
    }
  }

  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log('Initialized Firebase Admin with ADC');
  } catch (err) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'local-project' });
    console.log('Initialized Firebase Admin with fallback projectId');
  }
}

const firstNames = [
  'Alex','Jordan','Taylor','Sam','Casey','Drew','Cameron','Riley','Avery','Parker',
  'Quinn','Morgan','Blake','Rowan','Skyler','Reese','Kendall','Harper','Finley','Sage',
  'Noah','Liam','Mason','Ethan','Lucas','Aiden','Logan','Elijah','James','Benjamin',
  'Emma','Olivia','Sophia','Ava','Mia','Isabella','Amelia','Charlotte','Evelyn','Grace'
];

const lastNames = [
  'Carter','Reed','Mitchell','Parker','Hayes','Morgan','Bennett','Brooks','Cooper','Diaz',
  'Foster','Graham','Hayden','Jenkins','Keller','Lane','Morris','Owens','Powell','Ramirez',
  'Sullivan','Turner','Vasquez','Walker','Young','Adams','Baker','Coleman','Dixon','Evans'
];

const levels = ['Bronze', 'Silver', 'Gold', 'Platinum'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function avatarId(i) {
  const ids = ['vlad.png', 'logo.png', 'tablogo.png', 'too.png', 'fanduel.jpg', 'betway.png', 'iphone.png'];
  return ids[i % ids.length];
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeScreen(name) {
  return String(name || '').trim().toLowerCase();
}

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) {
    return { fullNames: [], screenNames: [], uids: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) || {};
    return {
      fullNames: Array.isArray(parsed.fullNames) ? parsed.fullNames : [],
      screenNames: Array.isArray(parsed.screenNames) ? parsed.screenNames : [],
      uids: Array.isArray(parsed.uids) ? parsed.uids : []
    };
  } catch {
    return { fullNames: [], screenNames: [], uids: [] };
  }
}

function saveLedger(state) {
  const payload = {
    fullNames: Array.from(state.fullNames).sort(),
    screenNames: Array.from(state.screenNames).sort(),
    uids: Array.from(state.uids).sort(),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

async function loadExistingUsersUniqueness(firestore) {
  const existing = {
    fullNames: new Set(),
    screenNames: new Set(),
    uids: new Set()
  };

  const pageSize = 400;
  let query = firestore.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
  let total = 0;

  while (true) {
    const snap = await query.get();
    if (snap.empty) break;

    snap.docs.forEach((doc) => {
      const u = doc.data() || {};
      const uid = String(u.uid || doc.id || '').trim();
      const fullName = normalizeName(u.fullName);
      const screenName = normalizeScreen(u.screenName);
      if (uid) existing.uids.add(uid);
      if (fullName) existing.fullNames.add(fullName);
      if (screenName) existing.screenNames.add(screenName);
    });

    total += snap.size;
    if (snap.size < pageSize) break;
    query = firestore
      .collection('users')
      .orderBy(admin.firestore.FieldPath.documentId())
      .startAfter(snap.docs[snap.docs.length - 1].id)
      .limit(pageSize);
  }

  console.log(`Loaded uniqueness baseline from ${total} existing users`);
  return existing;
}

function generateUniqueIdentity(i, uniquenessState) {
  let attempts = 0;
  while (attempts < 8000) {
    attempts += 1;
    const first = pick(firstNames);
    const last = pick(lastNames);
    const yearHint = randomInt(18, 99);
    const shortNum = randomInt(2, 99);
    const suffix3 = randomInt(101, 999);

    const firstSlug = slug(first);
    const lastSlug = slug(last);
    const firstInitial = firstSlug[0] || 'u';
    const lastInitial = lastSlug[0] || 'x';

    const fullName = `${first} ${last}`;

    const handlePatterns = [
      `${firstSlug}${lastSlug}`,
      `${firstSlug}.${lastSlug}`,
      `${firstSlug}_${lastSlug}`,
      `${firstSlug}${lastInitial}`,
      `${firstInitial}${lastSlug}`,
      `${firstSlug}${lastSlug}${shortNum}`,
      `${firstSlug}.${lastSlug}${shortNum}`,
      `${firstSlug}_${lastSlug}${yearHint}`,
      `${firstSlug}${lastInitial}${suffix3}`,
      `${firstInitial}${lastSlug}${suffix3}`
    ];
    const screenName = handlePatterns[randomInt(0, handlePatterns.length - 1)];

    const uid = `${prefix}-${Date.now().toString(36)}-${String(i + 1).padStart(3, '0')}-${suffix3}`;

    const fullKey = normalizeName(fullName);
    const screenKey = normalizeScreen(screenName);

    if (uniquenessState.fullNames.has(fullKey)) continue;
    if (uniquenessState.screenNames.has(screenKey)) continue;
    if (uniquenessState.uids.has(uid)) continue;

    uniquenessState.fullNames.add(fullKey);
    uniquenessState.screenNames.add(screenKey);
    uniquenessState.uids.add(uid);

    return { uid, fullName, screenName };
  }

  throw new Error('Unable to generate a unique identity after many attempts');
}

function makeUser(i, uniquenessState) {
  const identity = generateUniqueIdentity(i, uniquenessState);
  const uid = identity.uid;

  const points = randomInt(100, 5000);
  const xp = randomInt(100, 5000);
  const wins = randomInt(4, 120);
  const losses = randomInt(2, 95);
  const totalBets = wins + losses + randomInt(0, 12);

  const createdDaysAgo = randomInt(4, 180);
  const lastLoginHoursAgo = randomInt(1, 72);
  const createdAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() - createdDaysAgo * 86400000));
  const lastLogin = admin.firestore.Timestamp.fromDate(new Date(Date.now() - lastLoginHoursAgo * 3600000));

  return {
    uid,
    email: `${uid}@pickr-users.test`,
    fullName: identity.fullName,
    screenName: identity.screenName,
    dateOfBirth: `${randomInt(1980, 2003)}-${String(randomInt(1, 12)).padStart(2, '0')}-${String(randomInt(1, 28)).padStart(2, '0')}`,
    profileComplete: true,
    ageVerified: true,
    avatarId: avatarId(i),
    points,
    level: levels[Math.min(3, Math.floor(points / 1250))],
    xp,
    streakWins: randomInt(0, 14),
    tokenBalance: randomInt(300, 12000),
    cash: Number((Math.random() * 250).toFixed(2)),
    stats: { wins, losses, pending: randomInt(0, 4), totalBets },
    createdAt,
    lastLogin
  };
}

async function writeUsers(firestore, users) {
  const BATCH = 350;
  for (let i = 0; i < users.length; i += BATCH) {
    const chunk = users.slice(i, i + BATCH);
    const batch = firestore.batch();
    chunk.forEach((u) => {
      const ref = firestore.collection('users').doc(u.uid);
      batch.set(ref, u, { merge: true });
    });
    await batch.commit();
    console.log(`Seeded ${Math.min(i + BATCH, users.length)} / ${users.length} users`);
  }
}

function printSampleNames(users, maxSamples) {
  const samples = users.slice(0, maxSamples).map((u, idx) => `${idx + 1}. ${u.fullName} (@${u.screenName})`);
  console.log('--- Sample Seeded Names ---');
  samples.forEach((line) => console.log(line));
}

(async function main() {
  try {
    initAdmin();
    const firestore = admin.firestore();

    const existing = await loadExistingUsersUniqueness(firestore);
    const ledger = loadLedger();

    const uniquenessState = {
      fullNames: new Set([...existing.fullNames, ...ledger.fullNames.map(normalizeName)]),
      screenNames: new Set([...existing.screenNames, ...ledger.screenNames.map(normalizeScreen)]),
      uids: new Set([...existing.uids, ...ledger.uids])
    };

    const users = Array.from({ length: count }, (_, i) => makeUser(i, uniquenessState));
    const beforeWriteState = {
      fullNames: new Set(uniquenessState.fullNames),
      screenNames: new Set(uniquenessState.screenNames),
      uids: new Set(uniquenessState.uids)
    };

    await writeUsers(firestore, users);

    saveLedger(beforeWriteState);

    const mode = process.env.FIRESTORE_EMULATOR_HOST ? 'emulator' : 'real-project';
    console.log(`Done. Added/updated ${users.length} users in ${mode}. Prefix: ${prefix}`);
    printSampleNames(users, sampleCount);
    process.exit(0);
  } catch (err) {
    console.error('Seeding active users failed:', err && err.message);
    process.exit(2);
  }
})();
