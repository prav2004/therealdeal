#!/usr/bin/env node
const { execSync } = require('child_process');

const projectId = process.argv[2] || 'pickr-d4d9b';
const count = Math.max(1, Math.min(500, Number(process.argv[3] || 145)));
const prefix = process.argv[4] || 'active';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function getToken() {
  return sh('gcloud auth print-access-token');
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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

function pick(arr) { return arr[randomInt(0, arr.length - 1)]; }
function slug(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalize(name) { return String(name || '').trim().toLowerCase(); }

function authHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText} :: ${txt.slice(0, 400)}`);
  }
  return res.json();
}

function fsString(v) { return { stringValue: String(v) }; }
function fsInt(v) { return { integerValue: String(Math.floor(v)) }; }
function fsBool(v) { return { booleanValue: Boolean(v) }; }
function fsDouble(v) { return { doubleValue: Number(v) }; }
function fsTimestamp(date) { return { timestampValue: date.toISOString() }; }
function fsMap(obj) {
  const fields = {};
  Object.entries(obj).forEach(([k, val]) => {
    if (typeof val === 'string') fields[k] = fsString(val);
    else if (typeof val === 'boolean') fields[k] = fsBool(val);
    else if (typeof val === 'number' && Number.isInteger(val)) fields[k] = fsInt(val);
    else if (typeof val === 'number') fields[k] = fsDouble(val);
  });
  return { mapValue: { fields } };
}

function toFirestoreUser(u) {
  return {
    fields: {
      uid: fsString(u.uid),
      email: fsString(u.email),
      fullName: fsString(u.fullName),
      screenName: fsString(u.screenName),
      dateOfBirth: fsString(u.dateOfBirth),
      profileComplete: fsBool(true),
      ageVerified: fsBool(true),
      avatarId: fsString(u.avatarId),
      points: fsInt(u.points),
      level: fsString(u.level),
      xp: fsInt(u.xp),
      streakWins: fsInt(u.streakWins),
      tokenBalance: fsInt(u.tokenBalance),
      cash: fsDouble(u.cash),
      stats: fsMap(u.stats),
      createdAt: fsTimestamp(u.createdAt),
      lastLogin: fsTimestamp(u.lastLogin)
    }
  };
}

async function loadExistingSets(baseUrl, headers) {
  const fullNames = new Set();
  const screenNames = new Set();
  const uids = new Set();

  let pageToken = '';
  let scanned = 0;
  do {
    const url = `${baseUrl}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await fetchJson(url, { headers });
    const docs = data.documents || [];
    docs.forEach((d) => {
      const f = d.fields || {};
      const uid = f.uid && f.uid.stringValue ? f.uid.stringValue : (d.name || '').split('/').pop();
      const fullName = f.fullName && f.fullName.stringValue ? f.fullName.stringValue : '';
      const screenName = f.screenName && f.screenName.stringValue ? f.screenName.stringValue : '';
      if (uid) uids.add(normalize(uid));
      if (fullName) fullNames.add(normalize(fullName));
      if (screenName) screenNames.add(normalize(screenName));
    });
    scanned += docs.length;
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return { fullNames, screenNames, uids, scanned };
}

function makeUniqueIdentity(i, sets) {
  let tries = 0;
  while (tries < 10000) {
    tries += 1;
    const first = pick(firstNames);
    const last = pick(lastNames);
    const firstSlug = slug(first);
    const lastSlug = slug(last);
    const fi = firstSlug[0] || 'u';
    const li = lastSlug[0] || 'x';
    const y = randomInt(18, 99);
    const n = randomInt(2, 999);
    const fullName = `${first} ${last}`;

    const patterns = [
      `${firstSlug}${lastSlug}`,
      `${firstSlug}.${lastSlug}`,
      `${firstSlug}_${lastSlug}`,
      `${fi}${lastSlug}`,
      `${firstSlug}${li}`,
      `${firstSlug}${lastSlug}${randomInt(2,99)}`,
      `${firstSlug}.${lastSlug}${y}`,
      `${firstSlug}_${lastSlug}${y}`,
      `${fi}${lastSlug}${n}`,
      `${firstSlug}${li}${n}`
    ];
    const screenName = patterns[randomInt(0, patterns.length - 1)];
    const uid = `${prefix}-${Date.now().toString(36)}-${String(i + 1).padStart(3, '0')}-${randomInt(100,9999)}`;

    const fKey = normalize(fullName);
    const sKey = normalize(screenName);
    const uKey = normalize(uid);
    if (sets.fullNames.has(fKey) || sets.screenNames.has(sKey) || sets.uids.has(uKey)) continue;

    sets.fullNames.add(fKey);
    sets.screenNames.add(sKey);
    sets.uids.add(uKey);
    return { uid, fullName, screenName };
  }
  throw new Error('Could not generate unique identity');
}

function makeUser(i, sets) {
  const id = makeUniqueIdentity(i, sets);
  const points = randomInt(100, 5000);
  const xp = randomInt(100, 5000);
  const wins = randomInt(4, 120);
  const losses = randomInt(2, 95);
  const createdDaysAgo = randomInt(4, 180);
  const loginHoursAgo = randomInt(1, 72);
  const createdAt = new Date(Date.now() - createdDaysAgo * 86400000);
  const lastLogin = new Date(Date.now() - loginHoursAgo * 3600000);
  const avatars = ['vlad.png','logo.png','tablogo.png','too.png','fanduel.jpg','betway.png','iphone.png'];

  return {
    uid: id.uid,
    email: `${id.uid}@pickr-users.test`,
    fullName: id.fullName,
    screenName: id.screenName,
    dateOfBirth: `${randomInt(1980,2003)}-${String(randomInt(1,12)).padStart(2,'0')}-${String(randomInt(1,28)).padStart(2,'0')}`,
    avatarId: avatars[i % avatars.length],
    points,
    level: levels[Math.min(3, Math.floor(points / 1250))],
    xp,
    streakWins: randomInt(0, 14),
    tokenBalance: randomInt(300, 12000),
    cash: Number((Math.random() * 250).toFixed(2)),
    stats: { wins, losses, pending: randomInt(0,4), totalBets: wins + losses + randomInt(0,12) },
    createdAt,
    lastLogin
  };
}

(async function main() {
  try {
    const token = getToken();
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users`;
    const headers = authHeaders(token);

    const existing = await loadExistingSets(baseUrl, headers);
    console.log(`Scanned existing users: ${existing.scanned}`);

    const users = Array.from({ length: count }, (_, i) => makeUser(i, existing));
    for (let i = 0; i < users.length; i += 1) {
      const u = users[i];
      const url = `${baseUrl}/${encodeURIComponent(u.uid)}`;
      await fetchJson(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(toFirestoreUser(u))
      });
      if ((i + 1) % 25 === 0 || i + 1 === users.length) {
        console.log(`Seeded ${i + 1}/${users.length}`);
      }
    }

    const samples = users.slice(0, 15).map((u, idx) => ({ rank: idx + 1, screenName: u.screenName, points: u.points, xp: u.xp }));
    console.log(JSON.stringify({
      ok: true,
      projectId,
      inserted: users.length,
      constraints: { pointsMin: 100, pointsMax: 5000, xpMin: 100, xpMax: 5000 },
      samples
    }, null, 2));
  } catch (err) {
    console.error('Production seeding failed:', err && err.message);
    process.exit(1);
  }
})();
