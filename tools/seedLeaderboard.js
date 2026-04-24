#!/usr/bin/env node
const { execSync } = require('child_process');
const https = require('https');

const PROJECT_ID = 'pickr-d4d9b';

function getAccessToken() {
  try {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
  } catch (e) {
    console.error('Failed to get access token. Run: gcloud auth login');
    process.exit(1);
  }
}

function firestoreRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        } else {
          resolve(JSON.parse(body));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function toFirestoreDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getLevelFromXp(xp) {
  if (xp >= 1500) return 'Platinum';
  if (xp >= 750) return 'Gold';
  if (xp >= 250) return 'Silver';
  return 'Bronze';
}

function computePoints({ xp, stats, streakWins }) {
  return Math.trunc(xp + (stats.wins * 50) + (stats.totalBets * 5) + (streakWins * 20));
}

// 30 simple one-word names — no overlap with existing users:
// AHMED, CHARTED, DON, DRAKE, ERZO, GHIST, HATHAI, IVAN763, JAVOS, JOSH,
// KB99, LILOUKOKOLALA, LUNAR, MATT, NATHAN, NINJA, PRIAN, QUEEN, SAMRAM,
// SARAHTHOMAS, STACKED, STAR, TYLER_XNXX
const SCREEN_NAMES = [
  'BLAZE',    'CLUTCH',   'PHOENIX',  'SHADOW',
  'VIPER',    'STORM',    'ROCKET',   'FLASH',
  'TITAN',    'WOLF',     'HAWK',     'ACE',
  'CHIEF',    'DUKE',     'KING',     'FROST',
  'COBRA',    'ZEUS',     'JINX',     'RAVEN',
  'GHOST',    'SABER',    'KNIGHT',   'APEX',
  'DRIFT',    'FURY',     'LEGEND',   'ONYX',
  'TANK',     'REBEL'
];

function generateUsers() {
  const users = [];
  for (let i = 0; i < SCREEN_NAMES.length; i++) {
    const name = SCREEN_NAMES[i];
    const wins = rand(1, 25);
    const losses = rand(2, 30);
    const totalBets = wins + losses + rand(0, 8);
    const pending = rand(0, 3);
    const totalParlays = rand(0, Math.floor(totalBets * 0.3));
    const streakWins = rand(0, Math.min(5, wins));
    const bestStreak = Math.max(streakWins, rand(streakWins, Math.min(8, wins)));
    const xp = Math.trunc(totalBets * 10 + wins * 25 + losses * 5 + rand(0, 50));
    const level = getLevelFromXp(xp);
    const stats = { wins, losses, pending, totalBets, totalParlays };
    const points = computePoints({ xp, stats, streakWins });
    const tokenBalance = rand(200, 2500);
    const cashBalance = Math.round(rand(0, 50) * 100) / 100;
    const uid = `seed_user_${String(i + 1).padStart(3, '0')}`;

    users.push({
      uid,
      email: `${name.toLowerCase()}@pickr.fake`,
      authProvider: 'seed',
      fullName: name.charAt(0) + name.slice(1).toLowerCase(),
      screenName: name,
      avatarId: `avatar-${rand(1, 6)}`,
      dateOfBirth: `${rand(1985, 2003)}-${String(rand(1, 12)).padStart(2, '0')}-${String(rand(1, 28)).padStart(2, '0')}`,
      ageVerified: true,
      profileComplete: true,
      termsAccepted: true,
      address: {
        street: `${rand(100, 9999)} Main St`,
        city: pick(['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'Dallas', 'Miami', 'Denver', 'Atlanta', 'Boston', 'Seattle']),
        region: pick(['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'FL', 'CO', 'GA', 'MA', 'WA']),
        postalCode: String(rand(10000, 99999)),
        country: 'US'
      },
      tokenBalance,
      cashBalance,
      xp,
      level,
      points,
      stats,
      streakWins,
      bestStreak,
      streakMultiplier: streakWins >= 5 ? 1.5 : streakWins >= 3 ? 1.25 : streakWins >= 2 ? 1.1 : 1,
      firstBetRewarded: true,
      firstParlayRewarded: totalParlays > 0,
      createdAt: new Date(Date.now() - rand(2, 30) * 86400000),
      lastLogin: new Date(Date.now() - rand(0, 3) * 86400000)
    });
  }
  users.sort((a, b) => b.points - a.points);
  return users;
}

async function seed() {
  const users = generateUsers();
  console.log(`\nSeeding ${users.length} leaderboard users...\n`);
  console.log('Rank  Points  Level     Name');
  console.log('----  ------  --------  ------');
  users.forEach((u, i) => {
    console.log(`${String(i + 1).padStart(4)}  ${String(u.points).padStart(6)}  ${u.level.padEnd(8)}  ${u.screenName}`);
  });

  console.log('\nGetting auth token...');
  const token = getAccessToken();
  console.log('Writing to Firestore (parallel)...');

  const results = await Promise.allSettled(
    users.map(user => {
      const doc = toFirestoreDoc(user);
      return firestoreRequest('PATCH', `/users/${user.uid}`, doc, token);
    })
  );

  const success = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected');
  failed.forEach((r) => console.error(`  FAILED: ${r.reason.message.substring(0, 120)}`));

  console.log(`\nDone! ${success} users written, ${failed.length} failed.`);
  console.log('They will appear on the leaderboard immediately.');
}

seed().then(() => process.exit(0)).catch(err => { console.error('Seed failed:', err); process.exit(1); });
