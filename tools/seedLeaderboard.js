#!/usr/bin/env node
const { execSync } = require('child_process');
const https = require('https');

const PROJECT_ID = 'pickr-d4d9b';

// ---- CLI flags ----------------------------------------------------------
// node tools/seedLeaderboard.js              -> add ~40 bots + bump real users
// node tools/seedLeaderboard.js --count 60   -> add ~60 bots
// node tools/seedLeaderboard.js --no-bump    -> don't touch real users
// node tools/seedLeaderboard.js --dry        -> preview only, no writes
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function opt(name, def) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
}
const WANT_COUNT = Math.max(1, Number(opt('--count', '40')));
const MIN_POINTS = Math.max(0, Number(opt('--min', '500')));
const MAX_POINTS = Math.max(MIN_POINTS + 1, Number(opt('--max', '10000')));
const BUMP_REAL = !flag('--no-bump');
const DRY_RUN = flag('--dry');
const FIX_ROUND = flag('--fix-round');

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

function fromFirestoreValue(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const out = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    for (const [k, val] of Object.entries(f)) out[k] = fromFirestoreValue(val);
    return out;
  }
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromFirestoreValue);
  return undefined;
}

// Read every doc in the `users` collection (handles pagination).
async function listAllUsers(token) {
  const users = [];
  let pageToken = '';
  do {
    const path = `/users?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const resp = await firestoreRequest('GET', path, null, token);
    const docs = resp.documents || [];
    for (const d of docs) {
      const id = d.name.split('/').pop();
      const fields = {};
      for (const [k, v] of Object.entries(d.fields || {})) fields[k] = fromFirestoreValue(v);
      users.push({ id, fields });
    }
    pageToken = resp.nextPageToken || '';
  } while (pageToken);
  return users;
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getLevelFromXp(xp) {
  if (xp >= 1500) return 'Platinum';
  if (xp >= 750) return 'Gold';
  if (xp >= 250) return 'Silver';
  return 'Bronze';
}

function computePoints({ xp, stats, streakWins }) {
  return Math.trunc(xp + (stats.wins * 50) + (stats.totalBets * 5) + (streakWins * 20));
}

// Large pool of distinct gamer tags. Names already taken in Firestore (real
// players + earlier seeds) are filtered out at runtime, so we never reuse one.
const NAME_POOL = [
  'BLAZE', 'CLUTCH', 'PHOENIX', 'SHADOW', 'VIPER', 'STORM', 'ROCKET', 'FLASH',
  'TITAN', 'WOLF', 'HAWK', 'ACE', 'CHIEF', 'DUKE', 'KING', 'FROST',
  'COBRA', 'ZEUS', 'JINX', 'RAVEN', 'GHOST', 'SABER', 'KNIGHT', 'APEX',
  'DRIFT', 'FURY', 'LEGEND', 'ONYX', 'TANK', 'REBEL',
  'NOVA', 'BOLT', 'EMBER', 'GRIM', 'HEXX', 'IGNIS', 'JETT', 'KRAKEN',
  'LYNX', 'MAVERICK', 'NITRO', 'OMEN', 'PULSE', 'QUARTZ', 'RIPTIDE', 'SCOUT',
  'TEMPO', 'ULTRA', 'VORTEX', 'WRAITH', 'XENON', 'YETI', 'ZENITH', 'ARROW',
  'BANDIT', 'COMET', 'DAGGER', 'ECLIPSE', 'FALCON', 'GLITCH', 'HUNTER', 'INFERNO',
  'JAGUAR', 'KODIAK', 'LASER', 'MIRAGE', 'NEBULA', 'ORBIT', 'PANTHER', 'QUASAR',
  'ROGUE', 'SPECTRE', 'THUNDER', 'UPROAR', 'VENOM', 'WARDEN', 'BLITZ', 'CINDER',
  'DYNAMO', 'ELECTRO', 'FLARE', 'HAVOC', 'JOLT', 'KARMA', 'LOTUS', 'MAGNUM',
  'NOMAD', 'OZONE', 'PRISM', 'RUMBLE', 'SLATE', 'TALON', 'VANGUARD', 'ZEPHYR',
  'ATLAS', 'BREAKER', 'CYPHER', 'GAMBIT', 'OUTLAW', 'SURGE', 'TEMPEST', 'VOLT'
];

function generateUsers(takenLower, startIndex, count, minPoints, maxPoints) {
  const baseWords = shuffle([...NAME_POOL]);
  const usedThisRun = new Set();
  function nextName() {
    // Prefer a clean unused base word; fall back to word + number for uniqueness.
    for (const w of baseWords) {
      const key = w.toLowerCase();
      if (!takenLower.has(key) && !usedThisRun.has(key)) { usedThisRun.add(key); return w; }
    }
    for (let tries = 0; tries < 100000; tries++) {
      const w = baseWords[Math.floor(Math.random() * baseWords.length)];
      const name = `${w}${rand(2, 999)}`;
      const key = name.toLowerCase();
      if (!takenLower.has(key) && !usedThisRun.has(key)) { usedThisRun.add(key); return name; }
    }
    throw new Error('Could not generate a unique name');
  }

  const users = [];
  for (let i = 0; i < count; i++) {
    const name = nextName();
    const t = count <= 1 ? 0 : i / (count - 1); // 0 (top) .. 1 (bottom)
    const span = maxPoints - minPoints;
    const raw = Math.round(maxPoints - t * span + rand(-180, 180));
    // Keep the very top below a clean round cap so #1 looks organic, not "10000".
    const upper = maxPoints - rand(13, 220);
    let points = Math.max(minPoints + rand(0, 60), Math.min(upper, raw));
    if (points % 100 === 0) points += rand(-37, 37); // avoid round-number scores
    const wins = Math.max(1, Math.round(points / rand(90, 130)));
    const losses = rand(Math.floor(wins * 0.4), wins + rand(0, 15));
    const totalBets = wins + losses + rand(0, 10);
    const pending = rand(0, 3);
    const totalParlays = rand(0, Math.floor(totalBets * 0.35));
    const streakWins = points > 7000 ? rand(6, 11) : points > 4000 ? rand(4, 8) : points > 2000 ? rand(2, 5) : points > 1000 ? rand(1, 4) : rand(0, 2);
    const bestStreak = Math.max(streakWins, streakWins + rand(0, 4));
    const xp = Math.max(40, Math.round(points * (0.45 + Math.random() * 0.25)));
    const level = getLevelFromXp(xp);
    const stats = { wins, losses, pending, totalBets, totalParlays };
    const tokenBalance = rand(200, 4000);
    const cashBalance = Math.round(rand(0, 75) * 100) / 100;
    const uid = `seed_user_${String(startIndex + i + 1).padStart(3, '0')}`;

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
  console.log('Getting auth token...');
  const token = getAccessToken();

  console.log('Reading existing users from Firestore...');
  const existing = await listAllUsers(token);
  console.log(`Found ${existing.length} existing user docs.`);

  // One-shot cleanup: nudge any round-number seed scores so the board looks organic.
  if (FIX_ROUND) {
    const mid = (MIN_POINTS + MAX_POINTS) / 2;
    const fixes = [];
    for (const u of existing) {
      if (!/^seed_user_\d+$/.test(u.id)) continue;
      const pts = Number(u.fields.points || 0);
      if (pts > 0 && pts % 100 === 0) {
        const delta = pts >= mid ? -rand(11, 140) : rand(11, 140);
        const newPoints = Math.max(MIN_POINTS + rand(1, 45), pts + delta);
        fixes.push({ id: u.id, name: u.fields.screenName, from: pts, to: newPoints });
      }
    }
    console.log(`\nRound-number seed users to fix: ${fixes.length}`);
    fixes.forEach(f => console.log(`  ${String(f.from).padStart(6)} -> ${String(f.to).padStart(6)}  ${f.name}`));
    if (DRY_RUN) { console.log('\n[dry run] No writes.'); return; }
    const mask = 'updateMask.fieldPaths=points';
    const res = await Promise.allSettled(
      fixes.map(f => firestoreRequest('PATCH', `/users/${f.id}?${mask}`, toFirestoreDoc({ points: f.to }), token))
    );
    const ok = res.filter(r => r.status === 'fulfilled').length;
    res.filter(r => r.status === 'rejected').forEach(r => console.error(`  FIX FAILED: ${String(r.reason.message).substring(0, 120)}`));
    console.log(`\nFixed ${ok}/${fixes.length}. Refresh the leaderboard.`);
    return;
  }

  // Collect taken names, the highest seed index used, and the real users.
  const takenLower = new Set();
  let maxSeedIndex = 0;
  const realUsers = [];
  for (const u of existing) {
    const sn = String(u.fields.screenName || '').trim();
    if (sn) takenLower.add(sn.toLowerCase());
    const m = /^seed_user_(\d+)$/.exec(u.id);
    if (m) maxSeedIndex = Math.max(maxSeedIndex, Number(m[1]));
    else if (u.fields.authProvider !== 'seed') realUsers.push(u);
  }
  console.log(`Names already taken: ${takenLower.size}. Existing seed bots up to #${maxSeedIndex}.`);

  // Generate new bots with names nobody owns.
  const users = generateUsers(takenLower, maxSeedIndex, WANT_COUNT, MIN_POINTS, MAX_POINTS);
  console.log(`\nNew bots to add: ${users.length} (points ${MIN_POINTS}-${MAX_POINTS})`);
  console.log('Rank  Points  Level     Streak  Name');
  console.log('----  ------  --------  ------  ------');
  users.forEach((u, i) => {
    console.log(`${String(i + 1).padStart(4)}  ${String(u.points).padStart(6)}  ${u.level.padEnd(8)}  ${String(u.streakWins).padStart(6)}  ${u.screenName}`);
  });

  // Build point/XP bumps for real users so the whole board looks active.
  const bumps = [];
  if (BUMP_REAL) {
    for (const u of realUsers) {
      const f = u.fields || {};
      if (f.profileComplete !== true || f.ageVerified !== true) continue;
      if (!String(f.screenName || '').trim()) continue;
      const newXp = Number(f.xp || 0) + rand(200, 1600);
      const newPoints = Number(f.points || 0) + rand(350, 2200);
      bumps.push({ id: u.id, name: f.screenName, patch: { points: newPoints, xp: newXp, level: getLevelFromXp(newXp) } });
    }
    console.log(`\nReal users to bump: ${bumps.length}`);
    bumps.forEach(b => console.log(`  -> ${String(b.patch.points).padStart(6)} pts  ${b.name}`));
  }

  if (DRY_RUN) {
    console.log('\n[dry run] No writes performed.');
    return;
  }

  console.log('\nWriting new bots...');
  const results = await Promise.allSettled(
    users.map(user => firestoreRequest('PATCH', `/users/${user.uid}`, toFirestoreDoc(user), token))
  );
  const success = results.filter(r => r.status === 'fulfilled').length;
  results.filter(r => r.status === 'rejected')
    .forEach(r => console.error(`  BOT FAILED: ${String(r.reason.message).substring(0, 120)}`));
  console.log(`Bots written: ${success}/${users.length}`);

  if (BUMP_REAL && bumps.length) {
    console.log('Bumping real users (points/xp/level only)...');
    const mask = 'updateMask.fieldPaths=points&updateMask.fieldPaths=xp&updateMask.fieldPaths=level';
    const bumpResults = await Promise.allSettled(
      bumps.map(b => firestoreRequest('PATCH', `/users/${b.id}?${mask}`, toFirestoreDoc(b.patch), token))
    );
    const bumpOk = bumpResults.filter(r => r.status === 'fulfilled').length;
    bumpResults.filter(r => r.status === 'rejected')
      .forEach(r => console.error(`  BUMP FAILED: ${String(r.reason.message).substring(0, 120)}`));
    console.log(`Real users bumped: ${bumpOk}/${bumps.length}`);
  }

  console.log('\nDone! Refresh the leaderboard to see the updated board.');
}

seed().then(() => process.exit(0)).catch(err => { console.error('Seed failed:', err); process.exit(1); });
