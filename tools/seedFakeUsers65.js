#!/usr/bin/env node
// Seed 65 fake leaderboard users into production Firestore.
// Run: SEED_FORCE=1 node tools/seedFakeUsers65.js
//   or with service account:
//   SEED_FORCE=1 GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json node tools/seedFakeUsers65.js

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

// ── 65 fake users ──────────────────────────────────────────────────────────
// ~32 gamer handles + ~33 normal handles, all unique vs existing DB
// points 1000–6000, fully populated
const USERS = [
  // ── Gamer handles ──
  { screenName: 'NightPicks',   fullName: 'Marcus Webb',       points: 5840, wins: 74, streakWins: 9,  xp: 4100, avatarId: 'avatar-3' },
  { screenName: 'FrostSnipe',   fullName: 'Jaylen Cross',      points: 5620, wins: 68, streakWins: 7,  xp: 3900, avatarId: 'avatar-1' },
  { screenName: 'SlayerX',      fullName: 'Devon Carter',      points: 5490, wins: 65, streakWins: 11, xp: 3750, avatarId: 'avatar-2' },
  { screenName: 'VoidWalker',   fullName: 'Tyler Moss',        points: 5310, wins: 61, streakWins: 6,  xp: 3600, avatarId: 'avatar-4' },
  { screenName: 'BlazeCrest',   fullName: 'Jordan Blake',      points: 5170, wins: 58, streakWins: 8,  xp: 3450, avatarId: 'avatar-3' },
  { screenName: 'ShadowDrop',   fullName: 'Cameron Reed',      points: 5050, wins: 55, streakWins: 5,  xp: 3300, avatarId: 'avatar-2' },
  { screenName: 'PhantomKick',  fullName: 'Isaiah Ford',       points: 4890, wins: 52, streakWins: 7,  xp: 3180, avatarId: 'avatar-1' },
  { screenName: 'GlitchKing',   fullName: 'Elijah Stone',      points: 4740, wins: 49, streakWins: 4,  xp: 3050, avatarId: 'avatar-3' },
  { screenName: 'NeonBlitz',    fullName: 'Nathan Cole',       points: 4600, wins: 47, streakWins: 6,  xp: 2940, avatarId: 'avatar-4' },
  { screenName: 'IceStrike',    fullName: 'Caleb Young',       points: 4460, wins: 44, streakWins: 5,  xp: 2820, avatarId: 'avatar-2' },
  { screenName: 'DarkPulse',    fullName: 'Omar Hassan',       points: 4300, wins: 41, streakWins: 8,  xp: 2700, avatarId: 'avatar-1' },
  { screenName: 'CryptoKing',   fullName: 'Raheem Jackson',    points: 4180, wins: 39, streakWins: 4,  xp: 2600, avatarId: 'avatar-3' },
  { screenName: 'StormRage',    fullName: 'Andre Baptiste',    points: 4050, wins: 37, streakWins: 6,  xp: 2490, avatarId: 'avatar-2' },
  { screenName: 'OmegaRush',    fullName: 'Kwame Asante',      points: 3920, wins: 35, streakWins: 3,  xp: 2380, avatarId: 'avatar-4' },
  { screenName: 'SilentAce',    fullName: 'Tariq Byrd',        points: 3800, wins: 33, streakWins: 5,  xp: 2280, avatarId: 'avatar-1' },
  { screenName: 'CobraFang',    fullName: 'Darius Holt',       points: 3680, wins: 31, streakWins: 4,  xp: 2180, avatarId: 'avatar-3' },
  { screenName: 'GhostMode',    fullName: 'Kendrick Shaw',     points: 3550, wins: 29, streakWins: 7,  xp: 2070, avatarId: 'avatar-2' },
  { screenName: 'TurboSpin',    fullName: 'Malik Turner',      points: 3420, wins: 27, streakWins: 3,  xp: 1970, avatarId: 'avatar-4' },
  { screenName: 'LunarHex',     fullName: 'Zaire Brooks',      points: 3300, wins: 25, streakWins: 5,  xp: 1880, avatarId: 'avatar-1' },
  { screenName: 'ReaperPro',    fullName: 'Sam Okonkwo',       points: 3180, wins: 23, streakWins: 4,  xp: 1790, avatarId: 'avatar-3' },
  { screenName: 'VenomDash',    fullName: 'Reese Harmon',      points: 3070, wins: 22, streakWins: 3,  xp: 1700, avatarId: 'avatar-2' },
  { screenName: 'Zenith',       fullName: 'Riley Ashford',     points: 2960, wins: 20, streakWins: 6,  xp: 1620, avatarId: 'avatar-5' },
  { screenName: 'EclipseOP',    fullName: 'Quinn Donovan',     points: 2840, wins: 19, streakWins: 4,  xp: 1540, avatarId: 'avatar-6' },
  { screenName: 'IronFist',     fullName: 'Dante Rivera',      points: 2720, wins: 18, streakWins: 3,  xp: 1460, avatarId: 'avatar-3' },
  { screenName: 'ViperRush',    fullName: 'Miguel Santos',     points: 2610, wins: 17, streakWins: 5,  xp: 1390, avatarId: 'avatar-2' },
  { screenName: 'NovaDrift',    fullName: 'Tariq Ellison',     points: 2490, wins: 15, streakWins: 3,  xp: 1310, avatarId: 'avatar-1' },
  { screenName: 'ChaosEdge',    fullName: 'Knox Abramowitz',   points: 2380, wins: 14, streakWins: 4,  xp: 1240, avatarId: 'avatar-4' },
  { screenName: 'BlazePickr',   fullName: 'River Nakamura',    points: 2270, wins: 13, streakWins: 3,  xp: 1170, avatarId: 'avatar-3' },
  { screenName: 'PixelGod',     fullName: 'Sawyer Dubois',     points: 2150, wins: 12, streakWins: 5,  xp: 1100, avatarId: 'avatar-2' },
  { screenName: 'WarpZone',     fullName: 'Rowan Kessler',     points: 2040, wins: 11, streakWins: 3,  xp: 1030, avatarId: 'avatar-1' },
  { screenName: 'ObsidianK',    fullName: 'Finn Gallagher',    points: 1930, wins: 10, streakWins: 4,  xp:  970, avatarId: 'avatar-4' },
  { screenName: 'SteelGhost',   fullName: 'Peyton Lamar',      points: 1820, wins:  9, streakWins: 3,  xp:  910, avatarId: 'avatar-3' },
  // ── Normal handles ──
  { screenName: 'MarcusW',      fullName: 'Marcus Webb',       points: 5760, wins: 72, streakWins: 8,  xp: 4050, avatarId: 'avatar-1' },
  { screenName: 'Jaylen',       fullName: 'Jaylen Cross',      points: 5540, wins: 66, streakWins: 6,  xp: 3850, avatarId: 'avatar-2' },
  { screenName: 'DevCarter',    fullName: 'Devon Carter',      points: 5400, wins: 63, streakWins: 9,  xp: 3700, avatarId: 'avatar-1' },
  { screenName: 'TyMoss',       fullName: 'Tyler Moss',        points: 5230, wins: 60, streakWins: 5,  xp: 3550, avatarId: 'avatar-4' },
  { screenName: 'CamReed',      fullName: 'Cameron Reed',      points: 5090, wins: 56, streakWins: 7,  xp: 3400, avatarId: 'avatar-2' },
  { screenName: 'IsaiahF',      fullName: 'Isaiah Ford',       points: 4950, wins: 54, streakWins: 6,  xp: 3260, avatarId: 'avatar-1' },
  { screenName: 'NateCole',     fullName: 'Nathan Cole',       points: 4820, wins: 51, streakWins: 5,  xp: 3140, avatarId: 'avatar-3' },
  { screenName: 'AmaraD',       fullName: 'Amara Diallo',      points: 4680, wins: 48, streakWins: 8,  xp: 3010, avatarId: 'avatar-5' },
  { screenName: 'KenjiW',       fullName: 'Kenji Watanabe',    points: 4530, wins: 45, streakWins: 4,  xp: 2890, avatarId: 'avatar-2' },
  { screenName: 'SofiaR',       fullName: 'Sofia Reyes',       points: 4390, wins: 43, streakWins: 6,  xp: 2770, avatarId: 'avatar-5' },
  { screenName: 'SimoneD',      fullName: 'Simone Dupont',     points: 4250, wins: 40, streakWins: 5,  xp: 2660, avatarId: 'avatar-6' },
  { screenName: 'YasminK',      fullName: 'Yasmin Khalil',     points: 4110, wins: 38, streakWins: 7,  xp: 2550, avatarId: 'avatar-5' },
  { screenName: 'NaomiF',       fullName: 'Naomi Fletcher',    points: 3980, wins: 36, streakWins: 4,  xp: 2440, avatarId: 'avatar-6' },
  { screenName: 'BriannaO',     fullName: 'Brianna Okafor',    points: 3860, wins: 34, streakWins: 5,  xp: 2340, avatarId: 'avatar-5' },
  { screenName: 'LexVega',      fullName: 'Alexis Vega',       points: 3740, wins: 32, streakWins: 3,  xp: 2240, avatarId: 'avatar-6' },
  { screenName: 'MayaT',        fullName: 'Maya Thornton',     points: 3610, wins: 30, streakWins: 6,  xp: 2140, avatarId: 'avatar-5' },
  { screenName: 'NiaC',         fullName: 'Nia Campbell',      points: 3490, wins: 28, streakWins: 4,  xp: 2040, avatarId: 'avatar-6' },
  { screenName: 'RiyaP',        fullName: 'Riya Patel',        points: 3360, wins: 26, streakWins: 3,  xp: 1940, avatarId: 'avatar-5' },
  { screenName: 'HanaY',        fullName: 'Hana Yamamoto',     points: 3240, wins: 24, streakWins: 5,  xp: 1850, avatarId: 'avatar-6' },
  { screenName: 'KevinPark',    fullName: 'Kevin Park',        points: 3120, wins: 22, streakWins: 4,  xp: 1760, avatarId: 'avatar-2' },
  { screenName: 'AlexFer',      fullName: 'Alex Ferreira',     points: 3000, wins: 21, streakWins: 3,  xp: 1670, avatarId: 'avatar-1' },
  { screenName: 'JesseM',       fullName: 'Jesse Montoya',     points: 2880, wins: 19, streakWins: 5,  xp: 1590, avatarId: 'avatar-4' },
  { screenName: 'BlakeS',       fullName: 'Blake Sorensen',    points: 2760, wins: 18, streakWins: 3,  xp: 1510, avatarId: 'avatar-2' },
  { screenName: 'MorganSt',     fullName: 'Morgan Steele',     points: 2650, wins: 17, streakWins: 4,  xp: 1430, avatarId: 'avatar-5' },
  { screenName: 'FinnG',        fullName: 'Finn Gallagher',    points: 2540, wins: 16, streakWins: 3,  xp: 1350, avatarId: 'avatar-4' },
  { screenName: 'RowanK',       fullName: 'Rowan Kessler',     points: 2430, wins: 14, streakWins: 5,  xp: 1280, avatarId: 'avatar-1' },
  { screenName: 'SawyerD',      fullName: 'Sawyer Dubois',     points: 2310, wins: 13, streakWins: 3,  xp: 1200, avatarId: 'avatar-3' },
  { screenName: 'DanteR',       fullName: 'Dante Rivera',      points: 2190, wins: 12, streakWins: 4,  xp: 1130, avatarId: 'avatar-2' },
  { screenName: 'MiguelS',      fullName: 'Miguel Santos',     points: 2080, wins: 11, streakWins: 3,  xp: 1060, avatarId: 'avatar-1' },
  { screenName: 'ReeseH',       fullName: 'Reese Harmon',      points: 1970, wins: 10, streakWins: 5,  xp:  990, avatarId: 'avatar-5' },
  { screenName: 'QuinnD',       fullName: 'Quinn Donovan',     points: 1860, wins:  9, streakWins: 3,  xp:  930, avatarId: 'avatar-6' },
  { screenName: 'LuciaM',       fullName: 'Lucia Moreno',      points: 1740, wins:  8, streakWins: 4,  xp:  870, avatarId: 'avatar-5' },
  { screenName: 'PriyaN',       fullName: 'Priya Nair',        points: 1630, wins:  7, streakWins: 3,  xp:  810, avatarId: 'avatar-6' },
  { screenName: 'IsabelleF',    fullName: 'Isabelle Fontaine', points: 1510, wins:  6, streakWins: 4,  xp:  750, avatarId: 'avatar-5' },
  { screenName: 'AaliyahG',     fullName: 'Aaliyah Grant',     points: 1390, wins:  5, streakWins: 3,  xp:  690, avatarId: 'avatar-6' },
  { screenName: 'LoganP',       fullName: 'Logan Petrov',      points: 1270, wins:  4, streakWins: 2,  xp:  630, avatarId: 'avatar-4' },
  { screenName: 'HaydenC',      fullName: 'Hayden Cruz',       points: 1140, wins:  4, streakWins: 2,  xp:  570, avatarId: 'avatar-1' },
  { screenName: 'DrewCal',      fullName: 'Drew Calloway',     points: 1020, wins:  3, streakWins: 1,  xp:  510, avatarId: 'avatar-2' },
];

function levelFromPoints(pts) {
  if (pts >= 5000) return 'Diamond';
  if (pts >= 3500) return 'Platinum';
  if (pts >= 2500) return 'Gold';
  if (pts >= 1500) return 'Silver';
  return 'Bronze';
}

async function run() {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const BATCH_SIZE = 400;
  console.log(`Seeding ${USERS.length} fake users…`);

  for (let i = 0; i < USERS.length; i += BATCH_SIZE) {
    const chunk = USERS.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((u, idx) => {
      const uid = `fake-player-mokd6lv1-${String(i + idx + 1).padStart(3, '0')}`;
      const ref = db.collection('users').doc(uid);
      batch.set(ref, {
        uid,
        email: `${u.screenName.toLowerCase()}@pickrfake.app`,
        fullName: u.fullName,
        screenName: u.screenName,
        avatarId: u.avatarId,
        points: u.points,
        level: levelFromPoints(u.points),
        xp: u.xp,
        streakWins: u.streakWins,
        stats: {
          wins: u.wins,
          losses: Math.round(u.wins * 0.45),
          pending: 0,
          totalBets: u.wins + Math.round(u.wins * 0.45)
        },
        tokenBalance: u.points * 2,
        cash: parseFloat((u.points * 0.12).toFixed(2)),
        profileComplete: true,
        ageVerified: true,
        dob: '1995-06-15',
        createdAt: now,
        lastLogin: now,
        isFake: true
      }, { merge: false });
    });
    await batch.commit();
    console.log(`  ✓ Wrote ${Math.min(i + BATCH_SIZE, USERS.length)} / ${USERS.length}`);
  }
  console.log('Done! All 65 fake users seeded.');
  process.exit(0);
}

run().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
