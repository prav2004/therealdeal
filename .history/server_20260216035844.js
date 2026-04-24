const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const multer = require('multer');
const app = express();
// NOTE: Do NOT auto-default to the Firestore emulator. Rely on an explicit
// environment variable (FIRESTORE_EMULATOR_HOST) so the server and client
// cannot end up pointed at different Firebase projects and produce invalid
// ID token audience errors. If you want to use the emulator locally, set
// FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST explicitly before
// starting the server.

// Sanitize FIRESTORE_EMULATOR_HOST so various shell formats (with protocol,
// trailing slashes or accidental quotes) don't cause the Firestore client to
// reject the value. Accepts values like "http://localhost:8085", "localhost:8085/",
// or "localhost:8085" and normalizes them to "host:port".
if (process.env.FIRESTORE_EMULATOR_HOST) {
  try {
    let raw = String(process.env.FIRESTORE_EMULATOR_HOST).trim();
    // strip protocol if present
    raw = raw.replace(/^https?:\/\//i, '');
    // remove any trailing path or slash
    raw = raw.split('/')[0];
    // remove surrounding quotes if present
    raw = raw.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    raw = raw.trim();
    process.env.FIRESTORE_EMULATOR_HOST = raw;
    console.log('Using FIRESTORE_EMULATOR_HOST =', process.env.FIRESTORE_EMULATOR_HOST);
  } catch (e) {
    console.warn('Failed to sanitize FIRESTORE_EMULATOR_HOST, leaving original value.');
  }
}

// Safety: disallow using the Firestore emulator in production. If the
// environment is production but FIRESTORE_EMULATOR_HOST is set, fail fast.
if (process.env.NODE_ENV === 'production' && process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FATAL: FIRESTORE_EMULATOR_HOST must not be set in production. Unset this variable and restart the server.');
  process.exit(1);
}
app.set('trust proxy', 1);
const SCOREBOARD_PATH = path.join(__dirname, 'scoreboard.json');
const PICKS_PATH = path.join(__dirname, 'picks.json');
// Path for storing the daily algorithmic picks.  The daily picks file
// contains at most 50 entries selected by our value algorithm and is
// regenerated on a schedule (weekdays at 17:00 and weekends at 10:00
// and again at 16:00).  The data persisted here is used by the
// frontend "Pickr Picks" page to display curated selections each day.
const DAILY_PICKS_PATH = path.join(__dirname, 'dailyPicks.json');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

const WITHDRAW_EMAIL_TO = process.env.WITHDRAW_EMAIL_TO || 'pickrbets@gmail.com';
const SUPPORT_EMAIL_TO = process.env.SUPPORT_EMAIL_TO || 'pickrbets@gmail.com';
const CAREERS_EMAIL_TO = process.env.CAREERS_EMAIL_TO || 'pickrbets@gmail.com';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@pickr.app';

const MAX_WITHDRAW_AMOUNT = Number(process.env.MAX_WITHDRAW_AMOUNT || 5000);
const LOCK_BOOST_COST = Number(process.env.LOCK_BOOST_COST || 50);
const MAX_MESSAGE_LENGTH = 2000;
const MAX_SUBJECT_LENGTH = 120;
const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 120;
const MAX_PHONE_LENGTH = 40;
const MAX_LINKEDIN_LENGTH = 200;
const MAX_ABOUT_LENGTH = 2000;
const RATE_LIMITS = {
  support: { windowMs: 10 * 60 * 1000, max: 5 },
  careers: { windowMs: 60 * 60 * 1000, max: 3 },
  withdraw: { windowMs: 30 * 60 * 1000, max: 3 },
  lockBoost: { windowMs: 24 * 60 * 60 * 1000, max: 1 }
};


let smtpMailer = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  smtpMailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const rateBuckets = new Map();
function checkRateLimit(key, windowMs, max) {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || (now - existing.start) > windowMs) {
    rateBuckets.set(key, { start: now, count: 1 });
    return true;
  }
  existing.count += 1;
  return existing.count <= max;
}

function getClientIp(req) {
  return (req.ip || req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || 'unknown';
}

function getUtcDateKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function sendWithdrawEmails(payload) {
  if (!smtpMailer) return { sent: false };
  const { amount, email, uid, requestId } = payload;
  const subject = `Withdrawal request ${requestId}`;
  const body = `New withdrawal request\n\nRequest ID: ${requestId}\nUser ID: ${uid}\nAmount: $${Number(amount).toFixed(2)}\nEmail: ${email}\n\nFollow up with the user via email.`;
  try {
    await smtpMailer.sendMail({
      from: SMTP_FROM,
      to: WITHDRAW_EMAIL_TO,
      subject,
      text: body
    });
    if (email) {
      await smtpMailer.sendMail({
        from: SMTP_FROM,
        to: email,
        subject: 'Pickr withdrawal request received',
        text: 'We received your withdrawal request. Check your email for next steps.'
      });
    }
    return { sent: true };
  } catch (err) {
    console.error('Withdraw email failed:', err && err.message);
    return { sent: false, error: err && err.message };
  }
}

async function getOptionalUid(req) {
  const auth = req.headers.authorization || '';
  const idToken = (auth.startsWith('Bearer ') && auth.split(' ')[1]) || req.body && req.body.idToken;
  if (!idToken) return null;
  if (!VERIFY_TOKENS) {
    const devUid = process.env.DEV_AUTH_UID || null;
    return devUid ? String(devUid) : null;
  }
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded && decoded.uid ? decoded.uid : null;
}

async function sendSupportEmail(payload) {
  if (!smtpMailer) return { sent: false };
  const { ticketId, name, email, subject, message, uid } = payload;
  const body = `New support ticket\n\nTicket ID: ${ticketId}\nUser ID: ${uid || 'N/A'}\nName: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`;
  try {
    await smtpMailer.sendMail({
      from: SMTP_FROM,
      to: SUPPORT_EMAIL_TO,
      subject: `Support ticket ${ticketId}: ${subject}`,
      text: body
    });
    if (email) {
      await smtpMailer.sendMail({
        from: SMTP_FROM,
        to: email,
        subject: 'Pickr support ticket received',
        text: `Thanks for reaching out. Your support ticket ${ticketId} is in our queue. We will reply soon.`
      });
    }
    return { sent: true };
  } catch (err) {
    console.error('Support email failed:', err && err.message);
    return { sent: false, error: err && err.message };
  }
}

async function sendCareerEmail(payload) {
  if (!smtpMailer) return { sent: false };
  const { applicationId, name, email, phone, position, linkedin, about, uid, resume } = payload;
  const body = `New career application\n\nApplication ID: ${applicationId}\nUser ID: ${uid || 'N/A'}\nName: ${name}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\nPosition: ${position}\nLinkedIn: ${linkedin || 'N/A'}\n\nAbout:\n${about}`;
  const attachments = [];
  if (resume && resume.buffer) {
    attachments.push({
      filename: resume.originalname || 'resume',
      content: resume.buffer,
      contentType: resume.mimetype || 'application/octet-stream'
    });
  }
  try {
    await smtpMailer.sendMail({
      from: SMTP_FROM,
      to: CAREERS_EMAIL_TO,
      subject: `Career application ${applicationId}: ${position}`,
      text: body,
      attachments
    });
    if (email) {
      await smtpMailer.sendMail({
        from: SMTP_FROM,
        to: email,
        subject: 'Pickr application received',
        text: `Thanks for applying for ${position}. We received your application and will be in touch.`
      });
    }
    return { sent: true };
  } catch (err) {
    console.error('Career email failed:', err && err.message);
    return { sent: false, error: err && err.message };
  }
}

const SPORTSDATA_KEY = process.env.SPORTSDATAIO_KEY || '';
const SPORTSDATA_BASE = 'https://api.sportsdata.io/v3';
const SUPPORTED_SPORTS = ['nba', 'nfl', 'nhl', 'mlb', 'soccer'];
const NBA_SERVICE_BASE = process.env.NBA_API_SERVICE_URL || 'http://localhost:8001';

const sportsDataCache = new Map();

function formatSportsDataDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getSportsDataSport(sport) {
  const key = String(sport || '').trim().toLowerCase();
  return SUPPORTED_SPORTS.includes(key) ? key : 'nba';
}

function cacheGet(key) {
  const entry = sportsDataCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sportsDataCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  sportsDataCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchSportsData(sport, path, params = {}) {
  if (!SPORTSDATA_KEY) throw new Error('SPORTSDATAIO_KEY not configured');
  const safeSport = getSportsDataSport(sport);
  const url = `${SPORTSDATA_BASE}/${safeSport}${path}`;
  return axios.get(url, { params: Object.assign({ key: SPORTSDATA_KEY }, params), timeout: 12000 });
}

function pickFirst(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function readStat(obj, keys) {
  for (const key of keys) {
    if (obj && typeof obj[key] !== 'undefined' && obj[key] !== null) return obj[key];
  }
  return null;
}

function normalizeSportsDataStats(payload, playerName, season) {
  const entry = pickFirst(payload) || {};
  const gp = Number(readStat(entry, ['Games', 'GamesPlayed', 'Played', 'GP']) || 0);
  const ptsTotal = Number(readStat(entry, ['Points', 'Pts', 'TotalPoints']) || 0);
  const rebTotal = Number(readStat(entry, ['Rebounds', 'Reb', 'TotalRebounds']) || 0);
  const astTotal = Number(readStat(entry, ['Assists', 'Ast', 'TotalAssists']) || 0);

  const ptsAvg = Number(readStat(entry, ['PointsPerGame', 'PtsPerGame', 'PPG']) || 0);
  const rebAvg = Number(readStat(entry, ['ReboundsPerGame', 'RebPerGame', 'RPG']) || 0);
  const astAvg = Number(readStat(entry, ['AssistsPerGame', 'AstPerGame', 'APG']) || 0);

  const fgPct = readStat(entry, ['FieldGoalsPercentage', 'FGPercentage', 'FGP']);
  const fg3Pct = readStat(entry, ['ThreePointersPercentage', 'ThreePointPercentage', '3PPercentage', 'FG3P']);

  const perGame = {
    pts: ptsAvg || (gp ? Number((ptsTotal / gp).toFixed(1)) : 0),
    reb: rebAvg || (gp ? Number((rebTotal / gp).toFixed(1)) : 0),
    ast: astAvg || (gp ? Number((astTotal / gp).toFixed(1)) : 0),
    fg_pct: typeof fgPct === 'number' ? fgPct : null,
    fg3_pct: typeof fg3Pct === 'number' ? fg3Pct : null
  };

  return {
    player: { name: playerName || entry.Name || entry.PlayerName || 'Player' },
    season,
    seasonTotals: { gp: gp || null, pts: ptsTotal || null, reb: rebTotal || null, ast: astTotal || null },
    perGame,
    last5: []
  };
}

function normalizeOddsValue(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num) >= 100 || num <= -100) {
    return num > 0 ? Number((1 + num / 100).toFixed(2)) : Number((1 + 100 / Math.abs(num)).toFixed(2));
  }
  if (num > 1) return Number(num.toFixed(2));
  return null;
}

function readMoneyline(obj, keys) {
  for (const key of keys) {
    if (obj && typeof obj[key] !== 'undefined' && obj[key] !== null) return obj[key];
  }
  return null;
}

function pickBestDecimalOdds(game, side) {
  const sideKeys = side === 'home'
    ? ['HomeMoneyLine', 'HomeTeamMoneyLine', 'HomeMoneyline', 'HomeTeamMoneyline']
    : side === 'away'
      ? ['AwayMoneyLine', 'AwayTeamMoneyLine', 'AwayMoneyline', 'AwayTeamMoneyline']
      : ['DrawMoneyLine', 'TieMoneyLine', 'DrawMoneyline', 'TieMoneyline'];

  const direct = readMoneyline(game, sideKeys);
  const directVal = normalizeOddsValue(direct);
  if (directVal) return directVal;

  const arrays = ['PregameOdds', 'Odds', 'GameOdds', 'Books', 'Bookmakers', 'BookmakerOdds'];
  let best = null;
  arrays.forEach((field) => {
    const list = game && game[field];
    if (!Array.isArray(list)) return;
    list.forEach((entry) => {
      const val = normalizeOddsValue(readMoneyline(entry, sideKeys));
      if (val && (!best || val > best)) best = val;
    });
  });
  return best;
}

function buildSportsDataEvent(game, sport) {
  if (!game) return null;
  const homeName = readStat(game, ['HomeTeamName', 'HomeTeam', 'HomeTeamKey', 'HomeTeamAbbreviation']);
  const awayName = readStat(game, ['AwayTeamName', 'AwayTeam', 'AwayTeamKey', 'AwayTeamAbbreviation']);
  if (!homeName || !awayName) return null;

  const startRaw = readStat(game, ['DateTime', 'DateTimeUTC', 'Day', 'GameDate', 'DateTimeLocal']);
  const startDate = startRaw ? new Date(startRaw) : null;
  const startIso = startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null;

  const displayOdds = {
    home: pickBestDecimalOdds(game, 'home'),
    away: pickBestDecimalOdds(game, 'away')
  };
  const drawOdd = pickBestDecimalOdds(game, 'draw');
  if (drawOdd) displayOdds.draw = drawOdd;
  if (!displayOdds.home && !displayOdds.away && !displayOdds.draw) return null;

  const id = String(readStat(game, ['GameID', 'GameId', 'GameKey']) || `${sport}-${homeName}-${awayName}-${startIso || ''}`);

  return {
    id,
    match_id: id,
    commence_time: startIso,
    start_time: startIso,
    home_team: String(homeName),
    away_team: String(awayName),
    sport_key: sport,
    displayOdds
  };
}

async function getSportsDataTeams(sport) {
  const safeSport = getSportsDataSport(sport);
  const cacheKey = `teams:${safeSport}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const resp = await fetchSportsData(safeSport, '/scores/json/Teams');
  const teams = Array.isArray(resp.data) ? resp.data : [];
  cacheSet(cacheKey, teams, 6 * 60 * 60 * 1000);
  return teams;
}

async function getSportsDataPlayers(sport) {
  const safeSport = getSportsDataSport(sport);
  const cacheKey = `players:${safeSport}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const resp = await fetchSportsData(safeSport, '/stats/json/Players');
  const players = Array.isArray(resp.data) ? resp.data : [];
  cacheSet(cacheKey, players, 60 * 60 * 1000);
  return players;
}

// CORS configuration - allow requests from Firebase Hosting, Netlify and localhost
const cors = require('cors');
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5000', 
  'http://127.0.0.1:3000',
  'https://pickrpicks.com',
  'https://www.pickrpicks.com',
  'https://pickr-d4d9b.web.app',
  'https://pickr-d4d9b.firebaseapp.com'
];
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.netlify.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Basic security headers to harden the app for broader use.
// Keep these conservative to avoid breaking client CDN usage.
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Enable HSTS only in production to avoid issues in dev with localhost
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

async function fetchNbaService(path, params = {}) {
  const base = NBA_SERVICE_BASE.replace(/\/$/, '');
  const url = `${base}${path}`;
  return axios.get(url, { params, timeout: 10000 });
}

// --------------------------------------------------------------------------
// Public Routes
// --------------------------------------------------------------------------

// Health check endpoint for Cloud Run
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'pickr-backend', timestamp: new Date().toISOString() });
});

// --------------------------------------------------------------------------
// Firebase Admin initialization
// --------------------------------------------------------------------------
// Initialize the Firebase Admin SDK.
// Production: require application default credentials and verify they exist.
// Development: support a service account JSON via GOOGLE_APPLICATION_CREDENTIALS
// or connect to the Firestore emulator when FIRESTORE_EMULATOR_HOST is set.
try {
  if (process.env.NODE_ENV === 'production') {
    // In production we must use Application Default Credentials. This will
    // throw if ADC are not available which is the right behavior so the
    // deployment fails fast and the operator can fix credentials.
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log('Firebase Admin initialized (production) using Application Default Credentials.');
  } else {
    // Development / local: prefer explicit service account if provided
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        const sa = require(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id || process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID || 'local-project' });
        console.log('Firebase Admin initialized using GOOGLE_APPLICATION_CREDENTIALS');
      } catch (e) {
        console.warn('Failed to load service account from GOOGLE_APPLICATION_CREDENTIALS:', e && e.message);
        // fall back to emulator/default below
      }
    }

    if (!admin.apps.length) {
      if (process.env.FIRESTORE_EMULATOR_HOST) {
        admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID || 'local-project' });
        console.log('Firebase Admin initialized for emulator with projectId local-project');
      } else {
        // As a last resort in development, attempt ADC (useful when running
        // on developer machines with gcloud auth application-default login).
        try {
          admin.initializeApp({ credential: admin.credential.applicationDefault() });
          console.log('Firebase Admin initialized using Application Default Credentials (dev)');
        } catch (e) {
          // If ADC are not available, initialize with a minimal projectId so
          // the app can still run in a limited local mode.
          admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'local-project' });
          console.warn('Initialized Firebase Admin with fallback projectId=local-project');
        }
      }
    }
  }
} catch (err) {
  console.error('Failed to initialize Firebase Admin SDK:', err && err.message);
  console.error('Server will start but Firebase features will not work');
  // Don't exit - let server start anyway
}

let firestore = null;
try {
  firestore = admin.firestore();
  console.log('Firestore initialized successfully');
} catch (err) {
  console.error('Failed to initialize Firestore:', err && err.message);
}

// Determine whether authentication functionality is available in this runtime.
// Auth verification is enabled only when either a service account is provided
// (GOOGLE_APPLICATION_CREDENTIALS) OR when the Firebase Auth emulator is
// explicitly in use (FIREBASE_AUTH_EMULATOR_HOST). If only the Firestore
// emulator is configured (FIRESTORE_EMULATOR_HOST) but not the Auth emulator,
// we intentionally *do not* verify ID tokens because tokens issued by your
// production Firebase project will not validate against the local-project
// audience and will cause the "incorrect aud" errors the server logged.
// Determine whether token verification should be performed. In production we
// must always verify ID tokens. In development we verify tokens only when a
// service account or the Auth emulator is available.
const VERIFY_TOKENS = (process.env.NODE_ENV === 'production') || Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_AUTH_EMULATOR_HOST);
if (process.env.NODE_ENV === 'production') {
  console.log('Authentication: enforcing Firebase ID token verification (production).');
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.log('Authentication: service account available - ID tokens will be verified.');
} else if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.log('Authentication: Auth emulator detected - ID tokens will be verified against emulator.');
} else if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('Firestore emulator detected but no Auth emulator; token verification will be skipped in development unless DEV_AUTH_UID is set.');
} else {
  console.warn('Authentication not fully configured: running in limited dev mode. Consider setting GOOGLE_APPLICATION_CREDENTIALS or using the emulator.');
}

// Betting logic (pure, no I/O) - clean copy module
const betting = require('./server/betting');
// Firestore-backed persistence helpers (transactional)
const firestoreBets = require('./server/firestore_bets');

// Simple auth middleware: accepts Bearer <idToken> in Authorization header
// or idToken in the request body. Attaches uid to req.uid on success.
async function authMiddleware(req, res, next) {
  try {
    // If token verification is required/available, verify the provided ID token.
    if (VERIFY_TOKENS) {
      const auth = req.headers.authorization || '';
      const idToken = (auth.startsWith('Bearer ') && auth.split(' ')[1]) || req.body && req.body.idToken;
      if (!idToken) return res.status(401).json({ error: 'Missing id token' });

      // First, attempt to verify the token normally using the Admin SDK.
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.uid = decoded.uid;
      } catch (verifyErr) {
        // In development only: provide a safe fallback for emulator vs prod
        // audience mismatches by decoding the token payload without
        // verification and extracting the `sub` claim as the uid. This
        // keeps developers from being blocked when the browser uses a
        // different Firebase project than the local admin instance.
        console.warn('verifyIdToken failed:', verifyErr && verifyErr.message);
        if (process.env.NODE_ENV !== 'production') {
          try {
            const parts = String(idToken).split('.');
            if (parts.length >= 2) {
              const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
              const fallbackUid = payload && (payload.sub || payload.user_id || payload.uid);
              if (fallbackUid) {
                console.warn('Using decoded UID from token payload as development fallback:', fallbackUid);
                req.uid = String(fallbackUid);
              } else {
                return res.status(401).json({ error: 'Invalid id token', details: String(verifyErr && verifyErr.message) });
              }
            } else {
              return res.status(401).json({ error: 'Invalid id token', details: String(verifyErr && verifyErr.message) });
            }
          } catch (decodeErr) {
            console.error('Failed to decode id token fallback:', decodeErr && decodeErr.message);
            return res.status(401).json({ error: 'Invalid id token', details: String(verifyErr && verifyErr.message) });
          }
        } else {
          return res.status(401).json({ error: 'Invalid id token' });
        }
      }

      // Update lastLogin timestamp for this user so profiles reflect recent activity
      try {
        await firestoreBets.updateLastLogin(req.uid);
      } catch (e) {
        // Do not block authentication on logging lastLogin; just warn.
        console.warn('updateLastLogin failed for uid', req.uid, e && e.message);
      }
      return next();
    }

    // Token verification is not enabled. Allow developer bypass only in
    // development (NODE_ENV === 'development'). Do NOT allow dev headers in
    // production.
    if (process.env.NODE_ENV === 'development') {
      const devUidFromEnv = process.env.DEV_AUTH_UID;
      const devUidFromHeader = req.headers['x-dev-uid'];
      const devUid = devUidFromHeader || devUidFromEnv || (req.body && req.body.devUid);
      if (devUid) {
        req.uid = String(devUid);
        console.log('Dev auth active for uid=', req.uid);
        try {
          await firestoreBets.updateLastLogin(req.uid);
        } catch (e) {
          console.warn('updateLastLogin (dev) failed for uid', req.uid, e && e.message);
        }
        return next();
      }
      return res.status(503).json({ error: 'Authentication unavailable: set DEV_AUTH_UID or start the Auth emulator for local testing.' });
    }

    // In any other environment (e.g., production without proper config) block.
    return res.status(503).json({ error: 'Authentication unavailable: server not configured. Set GOOGLE_APPLICATION_CREDENTIALS or run the Auth emulator.' });
  } catch (err) {
    console.error('Authentication failed:', err && err.message);
    // In development, return the underlying error message to help debugging
    if (process.env.NODE_ENV !== 'production') {
      return res.status(401).json({ error: 'Invalid id token', details: String(err && err.message) });
    }
    return res.status(401).json({ error: 'Invalid id token' });
  }
}

// Ensure the authenticated user's Firestore profile is marked complete.
// If not, reject with 403 and a helpful message. This is used to block
// sensitive actions (placing bets, viewing wallet/picks) until onboarding
// is finished.
async function ensureProfileComplete(req, res, next) {
  try {
    if (!req.uid) return res.status(401).json({ error: 'Missing uid' });
    const profile = await firestoreBets.getUserProfile(req.uid);
    if (!profile) return res.status(404).json({ error: 'User profile not found' });
    if (!profile.profileComplete) return res.status(403).json({ error: 'Profile incomplete: complete onboarding at /onboarding.html' });
    return next();
  } catch (err) {
    console.error('ensureProfileComplete failed:', err && err.message);
    return res.status(500).json({ error: 'Failed to check profile status' });
  }
}

/**
 * Reads the current pick data from disk. If the file doesn't exist
 * or can't be parsed, an empty array is returned. Each entry in the
 * returned array corresponds to an event from the SportsDataIO odds feed and
 * includes at least the fields `id`, `commence_time`, `home_team`,
 * `away_team` and `bookmakers`.
 */
// Prefer Firestore for picks storage but keep a disk fallback for
// local debugging. These helpers are async because Firestore calls
// are async; callers are updated to await them.
async function readPicks() {
  try {
    // Try Firestore first
    const snap = await firestore.collection('picks').orderBy('commence_time').limit(1000).get();
    if (!snap.empty) {
      const out = [];
      snap.forEach(doc => {
        out.push(doc.data());
      });
      return out;
    }
  } catch (e) {
    console.warn('readPicks: Firestore read failed, falling back to disk:', e && e.message);
  }
  // Disk fallback
  try {
    const data = fs.readFileSync(PICKS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

/**
 * Writes the provided pick data to disk. Data is formatted with
 * indentation for easier debugging. This overwrites any existing file.
 * @param {Array} picks
 */
async function writePicks(picks) {
  // Persist to Firestore (batch) and also write a disk copy for debugging
  try {
    const batch = firestore.batch();
    const col = firestore.collection('picks');
    // Overwrite existing documents with the same ids
    picks.forEach(p => {
      const id = p.id || (Math.random().toString(36).slice(2, 10));
      const ref = col.doc(String(id));
      batch.set(ref, p, { merge: true });
    });
    await batch.commit();
  } catch (e) {
    console.warn('writePicks: Firestore write failed:', e && e.message);
  }
}
  
/**
 * Read the current daily picks from disk. If the file doesn't exist or
 * cannot be parsed, return an empty array.  Each entry in the
 * returned array contains a subset of the event fields along with
 * algorithmic metadata (pickTeam, pickTeamValue and valueScore).
 *
 * @returns {Array} Array of daily pick objects
 */
async function readDailyPicks() {
  try {
    const doc = await firestore.collection('dailyPicks').doc('current').get();
    if (doc.exists) return doc.data().picks || [];
  } catch (e) {
    console.warn('readDailyPicks: Firestore read failed, falling back to disk:', e && e.message);
  }
  try {
    const data = fs.readFileSync(DAILY_PICKS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

/**
 * Persist the provided daily picks list to disk.  Entries are
 * formatted with indentation for easier debugging.  This will
 * overwrite any existing daily picks file.
 *
 * @param {Array} picks List of daily pick objects
 */
async function writeDailyPicks(picks) {
  try {
    await firestore.collection('dailyPicks').doc('current').set({ picks, seededAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    console.warn('writeDailyPicks: Firestore write failed:', e && e.message);
  }
  try {
    fs.writeFileSync(DAILY_PICKS_PATH, JSON.stringify(picks, null, 2));
  } catch (e) {
    console.warn('writeDailyPicks: disk write failed:', e && e.message);
  }
}

/**
 * Compute a value score for each available event and select the top
 * picks.  The algorithm works as follows:
 *
 * 1. Ensure the latest picks data is populated by calling
 *    `fetchLatestPicks()`.  This fetches upcoming events from
 *    SportsDataIO (or generates filler games) and computes
 *    `displayOdds` for each outcome.
 * 2. Read the updated picks from disk.
 * 3. For each event, determine which side (home, away, draw) has
 *    the highest decimal odds.  The difference between that decimal
 *    value and 1.0 is treated as the value score (e.g. odds of 2.0
 *    produce a value of 1.0).  The pickTeam is set based on which
 *    outcome had the highest odds and pickTeamValue is set to that
 *    decimal odd.
 * 4. Sort all events by descending valueScore and take the top 50
 *    entries.  The selected picks are simplified to only include
 *    fields required by the frontend.
 * 5. Persist the resulting list to disk so the frontend can
 *    efficiently load the daily picks.
 *
 * @returns {Promise<void>} A promise that resolves once the picks
 * have been computed and saved.
 */
async function computeDailyPicks() {
  // Ensure we have the latest set of upcoming games.  This may
  // involve reaching out to SportsDataIO and will update the
  // picks stored in Firestore and disk.
  await fetchLatestPicks();
  const picks = await readPicks();
  const scored = [];
  picks.forEach((event) => {
    // Determine the best decimal odds among home, away and draw.
    const odds = event.displayOdds || {};
    let bestOutcome = null;
    let bestOdd = 0;
    if (odds.home && odds.home > bestOdd) {
      bestOdd = odds.home;
      bestOutcome = 'home';
    }
    if (odds.away && odds.away > bestOdd) {
      bestOdd = odds.away;
      bestOutcome = 'away';
    }
    if (odds.draw && odds.draw > bestOdd) {
      bestOdd = odds.draw;
      bestOutcome = 'draw';
    }
    // Skip events with no odds information
    if (!bestOutcome || bestOdd <= 1) return;
    const valueScore = bestOdd - 1;
    let pickTeamName = '';
    if (bestOutcome === 'home') pickTeamName = event.home_team;
    else if (bestOutcome === 'away') pickTeamName = event.away_team;
    else pickTeamName = 'Draw';
    scored.push({
      id: event.id,
      commence_time: event.commence_time,
      home_team: event.home_team,
      away_team: event.away_team,
      sport_key: event.sport_key,
      pickTeam: pickTeamName,
      pickTeamValue: Number(bestOdd.toFixed(2)),
      valueScore: Number(valueScore.toFixed(2))
    });
  });
  // Sort picks by descending valueScore and then by earliest start
  scored.sort((a, b) => {
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    return new Date(a.commence_time) - new Date(b.commence_time);
  });
  const top = scored.slice(0, 50);
  await writeDailyPicks(top);
}

/**
 * Generate a list of synthetic betting events. These filler picks are used
 * when the real odds feed is unavailable or insufficient. Each event has
 * random teams drawn from a handful of sports, a start time within the
 * next 24 hours and satisfies the minimum 1.4x odds requirement. The
 * returned objects conform to the same shape as events returned by the
 * SportsDataIO odds feed so that the frontend can handle them transparently. Price
 * fields are omitted since the client does not currently display odds.
 *
 * @param {number} count - The number of synthetic picks to generate
 * @returns {Array} An array of synthetic event objects
 */
function generateFillerPicks(count, forceSportKey = null) {
  /**
   * Generates synthetic pick objects to fill the betting board when
   * there are insufficient real events available. Each generated pick
   * conforms to the shape expected by the frontend: it includes a
   * unique identifier for the pick (`id`), a unique match identifier
   * (`match_id`), the names of the competing teams (`home_team` and
   * `away_team`), a start time (`start_time`), the team on which the
   * pick is made (`team`), and a decimal multiplier (`multiplier`).
   *
   * The teams are drawn from a small, hard‑coded pool of popular
   * franchises across several sports. The multiplier is randomly
   * selected between 1.4x and 2.0x to satisfy the minimum return
   * requirement.
   */
  const sportsTeams = {
    nba: ['Lakers', 'Warriors', 'Celtics', 'Raptors', 'Bulls'],
    nfl: ['Cowboys', 'Eagles', 'Packers', 'Patriots', '49ers'],
    mlb: ['Yankees', 'Red Sox', 'Dodgers', 'Astros', 'Cubs'],
    nhl: ['Rangers', 'Bruins', 'Maple Leafs', 'Canadiens', 'Blackhawks'],
    soccer: ['Barcelona', 'Real Madrid', 'Manchester City', 'Liverpool', 'PSG']
  };
  const sportKeys = forceSportKey ? [forceSportKey] : Object.keys(sportsTeams);
  const picks = [];
  for (let i = 0; i < count; i++) {
    const sportKey = sportKeys[Math.floor(Math.random() * sportKeys.length)];
    const teams = sportsTeams[sportKey];
    const now = Date.now();
    const startTime = new Date(now + Math.random() * 3 * 24 * 60 * 60 * 1000).toISOString();
    const matchId = `gen-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`;

    let homeIndex = Math.floor(Math.random() * teams.length);
    let awayIndex = homeIndex;
    while (awayIndex === homeIndex) awayIndex = Math.floor(Math.random() * teams.length);
    const homeTeam = teams[homeIndex];
    const awayTeam = teams[awayIndex];
    const homeOdd = Number((1.3 + Math.random() * 1.4).toFixed(2));
    const awayOdd = Number((1.3 + Math.random() * 1.4).toFixed(2));
    const pickTeam = Math.random() < 0.5 ? homeTeam : awayTeam;
    const id = `${matchId}_${pickTeam.replace(/\s+/g, '')}`;
    picks.push({
      id,
      match_id: matchId,
      home_team: homeTeam,
      away_team: awayTeam,
      commence_time: startTime,
      sport_key: sportKey,
      displayOdds: { home: homeOdd, away: awayOdd },
      team: pickTeam,
      multiplier: pickTeam === homeTeam ? homeOdd : awayOdd
    });
  }
  return picks;
}

function limitPicksBySport(picks, maxPerSport = 10) {
  const bySport = new Map();
  const sorted = picks.slice().sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
  for (const event of sorted) {
    const sportKey = event.sport_key || 'unknown';
    if (!bySport.has(sportKey)) bySport.set(sportKey, []);
    const list = bySport.get(sportKey);
    if (list.length < maxPerSport) list.push(event);
  }
  return Array.from(bySport.values()).flat();
}

function computeDisplayOdds(event) {
  const toDecimal = (price, oddsFormat) => {
    if (oddsFormat === 'decimal' || typeof price === 'number') {
      return price;
    }
    if (price < 0) return (100 - price) / -price;
    return (price + 100) / 100;
  };
  let oddsFormat = 'american';
  if (event.bookmakers && event.bookmakers.length) {
    const market = event.bookmakers[0].markets.find(m => m.key === 'h2h');
    if (market && market.outcomes.length && typeof market.outcomes[0].price === 'number') {
      oddsFormat = 'decimal';
    }
  }
  let bestHome = null;
  let bestAway = null;
  let bestDraw = null;
  (event.bookmakers || []).forEach(book => {
    const m = book.markets.find(mk => mk.key === 'h2h');
    if (!m) return;
    (m.outcomes || []).forEach(outcome => {
      const dec = toDecimal(outcome.price, oddsFormat);
      if (!dec) return;
      if (outcome.name === event.home_team) {
        if (!bestHome || dec > bestHome) bestHome = dec;
      } else if (outcome.name === event.away_team) {
        if (!bestAway || dec > bestAway) bestAway = dec;
      } else if (outcome.name.toLowerCase().includes('draw') || outcome.name.toLowerCase().includes('tie')) {
        if (!bestDraw || dec > bestDraw) bestDraw = dec;
      }
    });
  });
  event.displayOdds = event.displayOdds || {};
  if (bestHome) event.displayOdds.home = Number(bestHome.toFixed(2));
  if (bestAway) event.displayOdds.away = Number(bestAway.toFixed(2));
  if (bestDraw) event.displayOdds.draw = Number(bestDraw.toFixed(2));
  return event;
}

function filterPicksForResponse(picks, sport = null) {
  const desiredSports = SUPPORTED_SPORTS.slice();
  const isAllowedSport = (event) => desiredSports.some(s => (event.sport_key || '').toLowerCase().includes(s));
  const isPlayerProp = (event) => {
    const away = String(event.away_team || '').toLowerCase();
    const sportKey = String(event.sport_key || '').toLowerCase();
    const title = String(event.sport_title || '').toLowerCase();
    return away.includes('player prop')
      || title.includes('player prop')
      || sportKey.includes('player_prop')
      || sportKey.includes('player_props')
      || sportKey.includes('props')
      || String(event.id || '').includes('_prop_');
  };
  const nowMs = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const fallbackWindowMs = 48 * 60 * 60 * 1000;
  const filterByWindow = (list, ms) => list.filter((event) => {
    const start = new Date(event.commence_time || event.start_time).getTime();
    return Number.isFinite(start) && start > nowMs && start <= nowMs + ms;
  });

  let filtered = picks.filter(e => !isPlayerProp(e));
  if (sport) {
    const search = String(sport).toLowerCase();
    filtered = filtered.filter(event => (event.sport_key || '').toLowerCase().includes(search));
  } else {
    filtered = filtered.filter(isAllowedSport);
  }

  let windowed = filterByWindow(filtered, windowMs);
  if (windowed.length === 0) {
    windowed = filterByWindow(filtered, fallbackWindowMs);
  }

  const withOdds = windowed.map(event => computeDisplayOdds(event))
    .filter(event => event.displayOdds && (event.displayOdds.home || event.displayOdds.away));

  if (sport) return withOdds.slice(0, 10);
  return limitPicksBySport(withOdds, 10);
}

/**
 * Fetches upcoming sporting events and their head‑to‑head odds from the
 * SportsDataIO odds feed. New events are merged with any existing picks still in play
 * (i.e. those whose start time is in the future). Once merged, the
 * combined list is truncated to at most 50 entries. The resulting
 * collection is persisted to disk and cached in memory.
 */
async function fetchLatestPicks() {
  // Read the existing picks and retain only those games that haven't
  // started yet. Once the start time has passed the event will no
  // longer be available to bet on and should be removed.
  const nowMs = Date.now();
  let existing = (await readPicks()).filter((event) => {
    try {
      const start = new Date(event.commence_time || event.start_time).getTime();
      return start > nowMs;
    } catch (e) {
      return false;
    }
  });

  // Attempt to fetch new events from SportsDataIO. If the key is missing
  // or requests fail, we'll gracefully fall back to synthetic picks.
  const apiKey = getSportsDataKey();
  let events = [];
  if (apiKey) {
    const dates = [];
    const base = new Date();
    for (let i = 0; i < 2; i++) {
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + i));
      const dateStr = formatSportsDataDate(d);
      if (dateStr) dates.push(dateStr);
    }

    const seen = new Set();
    for (const sport of SUPPORTED_SPORTS) {
      for (const dateStr of dates) {
        try {
          const response = await fetchSportsData(sport, `/odds/json/GameOddsByDate/${dateStr}`);
          const list = Array.isArray(response.data) ? response.data : [];
          list.forEach((game) => {
            const event = buildSportsDataEvent(game, sport);
            if (!event || !event.id || seen.has(event.id)) return;
            seen.add(event.id);
            events.push(event);
          });
        } catch (err) {
          console.warn('Warning: failed to fetch SportsDataIO odds for', sport, dateStr, err && err.message);
        }
      }
    }
  } else {
    console.warn('SPORTSDATAIO_KEY not configured; using synthetic picks.');
  }
  // Merge the newly fetched events into the existing list, avoiding duplicates.
  const existingIds = new Set(existing.map(e => e.id));
  const upcomingEvents = events.filter((event) => {
    try {
      return new Date(event.commence_time || event.start_time).getTime() > nowMs;
    } catch (e) {
      return false;
    }
  });
  // Keep upcoming events only. Previously we filtered by a strict set of
  // sport keys and a narrow time window; for testing we remove those
  // filters so the board shows a wide selection of available games.
  const desiredSports = SUPPORTED_SPORTS.slice();
  const isAllowedSport = (event) => desiredSports.some(s => (event.sport_key || '').toLowerCase().includes(s));
  const isPlayerProp = (event) => {
    const away = String(event.away_team || '').toLowerCase();
    const sportKey = String(event.sport_key || '').toLowerCase();
    const title = String(event.sport_title || '').toLowerCase();
    return away.includes('player prop')
      || title.includes('player prop')
      || sportKey.includes('player_prop')
      || sportKey.includes('player_props')
      || sportKey.includes('props')
      || String(event.id || '').includes('_prop_');
  };
  const windowMs = 24 * 60 * 60 * 1000;
  const fallbackWindowMs = 48 * 60 * 60 * 1000;
  const filterByWindow = (list, ms) => list.filter((event) => {
    const start = new Date(event.commence_time || event.start_time).getTime();
    return Number.isFinite(start) && start > nowMs && start <= nowMs + ms;
  });

  existing = existing.filter(isAllowedSport).filter(e => !isPlayerProp(e));
  let filteredExisting = filterByWindow(existing, windowMs);
  if (filteredExisting.length === 0) {
    filteredExisting = filterByWindow(existing, fallbackWindowMs);
  }

  let filteredNewEvents = upcomingEvents.filter(isAllowedSport).filter(e => !isPlayerProp(e));
  filteredNewEvents = filterByWindow(filteredNewEvents, windowMs);
  if (filteredNewEvents.length === 0) {
    filteredNewEvents = filterByWindow(upcomingEvents.filter(isAllowedSport).filter(e => !isPlayerProp(e)), fallbackWindowMs);
  }

  const newEvents = filteredNewEvents.filter(event => !existingIds.has(event.id));
  const bySport = new Map();
  const addToSport = (event) => {
    const sportKey = event.sport_key || 'unknown';
    if (!bySport.has(sportKey)) bySport.set(sportKey, []);
    bySport.get(sportKey).push(event);
  };
  filteredExisting.forEach(addToSport);
  // Only add new events to fill gaps when a game starts (keep stable list).
  for (const event of newEvents) {
    const sportKey = event.sport_key || 'unknown';
    const list = bySport.get(sportKey) || [];
    if (list.length >= 10) continue;
    list.push(event);
    bySport.set(sportKey, list);
  }
  for (const sportKey of desiredSports) {
    const list = bySport.get(sportKey) || [];
    const needed = Math.max(0, 10 - list.length);
    if (needed > 0) {
      list.push(...generateFillerPicks(needed, sportKey));
      bySport.set(sportKey, list);
    }
  }
  existing = Array.from(bySport.values()).flat();

  // If we have too few real picks for testing, generate synthetic filler
  // picks to ensure the board has at least 10 items. This helps during
  // development and manual QA where the sports data feed may be empty or limited.
  const MIN_PICKS = 10;
  if (existing.length < MIN_PICKS) {
    const needed = MIN_PICKS - existing.length;
    const filler = generateFillerPicks(needed);
    existing = existing.concat(filler);
  }

  // Sort the picks chronologically by start time so the board shows today and tomorrow in order
  existing.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

  // Cap at 10 picks per sport so the board stays consistent per section
  existing = limitPicksBySport(existing, 10);

  existing = existing.map(event => computeDisplayOdds(event));

  // Persist the picks to Firestore (and disk). This keeps the
  // server-authoritative store in Firestore while also maintaining a
  // local copy for debugging.
  await writePicks(existing);
}

function getSportsDataKey() {
  return SPORTSDATA_KEY;
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function extractScores(result) {
  if (!result) return null;
  const home = result.home_team || result.homeTeam || result.HomeTeam || result.HomeTeamName || result.HomeTeamKey || result.Home;
  const away = result.away_team || result.awayTeam || result.AwayTeam || result.AwayTeamName || result.AwayTeamKey || result.Away;
  if (!home || !away) return null;
  let homeScore = null;
  let awayScore = null;

  if (typeof result.HomeTeamScore !== 'undefined') homeScore = Number(result.HomeTeamScore);
  if (typeof result.AwayTeamScore !== 'undefined') awayScore = Number(result.AwayTeamScore);
  if (!Number.isFinite(homeScore) && typeof result.HomeScore !== 'undefined') homeScore = Number(result.HomeScore);
  if (!Number.isFinite(awayScore) && typeof result.AwayScore !== 'undefined') awayScore = Number(result.AwayScore);

  const scores = result.scores || result.score || null;
  if (Array.isArray(scores)) {
    for (const s of scores) {
      const name = normalizeName(s && s.name);
      if (!name) continue;
      if (name === normalizeName(home)) homeScore = Number(s.score);
      if (name === normalizeName(away)) awayScore = Number(s.score);
    }
  } else if (scores && typeof scores === 'object') {
    if (!Number.isFinite(homeScore) && typeof scores.home !== 'undefined') homeScore = Number(scores.home);
    if (!Number.isFinite(awayScore) && typeof scores.away !== 'undefined') awayScore = Number(scores.away);
  }
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  return { home, away, homeScore, awayScore };
}

async function fetchScoresForSport(sportKey, apiKey) {
  if (!sportKey || !apiKey) return [];
  const safeSport = getSportsDataSport(sportKey);
  const results = [];
  for (const offset of [0, 1, 2]) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - offset);
    const dateStr = formatSportsDataDate(d);
    if (!dateStr) continue;
    try {
      const resp = await fetchSportsData(safeSport, `/scores/json/GamesByDate/${dateStr}`);
      const list = Array.isArray(resp.data) ? resp.data : [];
      results.push(...list);
    } catch (err) {
      console.warn('Failed to fetch SportsDataIO scores for', safeSport, dateStr, err && err.message);
    }
  }
  return results;
}

function determineOutcome(selection, result) {
  if (!selection || !result) return 'pending';
  const status = String(result.Status || result.status || '').toLowerCase();
  const completed = typeof result.completed !== 'undefined'
    ? result.completed
    : (result.IsOver === true || status.includes('final') || status.includes('completed') || status.includes('closed'));
  if (!completed) return 'pending';
  const scores = extractScores(result);
  if (!scores) return 'pending';
  const pick = normalizeName(selection.pick);
  if (scores.homeScore === scores.awayScore) {
    return pick === 'draw' ? 'win' : 'lose';
  }
  const winner = scores.homeScore > scores.awayScore ? scores.home : scores.away;
  return normalizeName(winner) === pick ? 'win' : 'lose';
}

async function settlePendingBets() {
  if (!firestore) return;
  const apiKey = getSportsDataKey();
  if (!apiKey) {
    console.warn('settlePendingBets skipped: SPORTSDATAIO_KEY not configured');
    return;
  }
  try {
    const snap = await firestore.collection('bets').where('status', '==', 'pending').get();
    if (snap.empty) return;
    const pendingBets = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    const eventIdToSport = new Map();
    const missingEventIds = new Set();

    pendingBets.forEach(bet => {
      (bet.selections || []).forEach(sel => {
        const eventId = sel && sel.eventId;
        if (!eventId) return;
        const sportKey = sel.sportKey || sel.sport_key || null;
        if (sportKey) eventIdToSport.set(eventId, sportKey);
        else missingEventIds.add(eventId);
      });
    });

    if (missingEventIds.size) {
      const refs = Array.from(missingEventIds).map(id => firestore.collection('picks').doc(id));
      const docs = await firestore.getAll(...refs);
      docs.forEach(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        if (data && data.sport_key) eventIdToSport.set(doc.id, data.sport_key);
      });
    }

    const sportToEventIds = new Map();
    eventIdToSport.forEach((sportKey, eventId) => {
      if (!sportKey) return;
      const set = sportToEventIds.get(sportKey) || new Set();
      set.add(eventId);
      sportToEventIds.set(sportKey, set);
    });

    const resultsByEvent = new Map();
    for (const [sportKey, ids] of sportToEventIds.entries()) {
      const scores = await fetchScoresForSport(sportKey, apiKey);
      scores.forEach(ev => {
        if (ev && ev.id) resultsByEvent.set(ev.id, ev);
      });
    }

    let settledCount = 0;
    for (const bet of pendingBets) {
      const selections = Array.isArray(bet.selections) ? bet.selections : [];
      if (selections.length === 0) continue;
      const outcomes = selections.map(sel => determineOutcome(sel, resultsByEvent.get(sel.eventId)));
      let status = null;
      if (outcomes.some(o => o === 'lose')) status = 'lost';
      else if (outcomes.every(o => o === 'win')) status = 'won';
      if (!status) continue;
      try {
        await firestoreBets.settleBet(bet.betId || bet.id, { status });
        settledCount += 1;
      } catch (e) {
        console.warn('Failed to settle bet', bet.betId || bet.id, e && e.message);
      }
    }
    if (settledCount) console.log('Settled bets:', settledCount);
  } catch (err) {
    console.error('settlePendingBets failed:', err && err.message);
  }
}

// Perform an initial fetch of picks when the server starts up.
fetchLatestPicks();

// Compute the initial daily picks on startup.  This ensures that
// visiting the Pickr Picks page immediately after server boot will
// display a list of curated games without waiting for the next
// scheduled job to fire.
computeDailyPicks().catch((err) => {
  console.error('Failed to compute daily picks on startup:', err);
});

// Attempt to settle any pending bets on startup.
settlePendingBets().catch((err) => {
  console.error('Failed to settle bets on startup:', err && err.message);
});

/**
 * POST /api/wallet/buy-tokens
 * Body: { amount?: number }
 * Auth: Bearer <idToken>
 * Credits the authenticated user with tokens (transactional) and returns updated balance.
 */
app.post('/api/wallet/buy-tokens', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    const uid = req.uid;
    const amount = req.body && Number(req.body.amount) ? Math.trunc(Number(req.body.amount)) : 2500;
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const updated = await firestoreBets.creditTokens(uid, amount);
    return res.json({ ok: true, tokenBalance: Number(updated.tokenBalance || 0) });
  } catch (err) {
    console.error('Buy tokens failed:', err && err.message);
    return res.status(500).json({ error: String(err && err.message) });
  }
});

/**
 * POST /api/wallet/deposit-cash
 * Body: { amount?: number }
 * Auth: Bearer <idToken>
 * Credits the authenticated user with cash and returns updated balance.
 */
app.post('/api/wallet/deposit-cash', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    const uid = req.uid;
    const amount = req.body && Number(req.body.amount) ? Number(req.body.amount) : 25;
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const updated = await firestoreBets.creditCash(uid, amount);
    return res.json({ ok: true, cashBalance: Number(updated.cashBalance || 0) });
  } catch (err) {
    console.error('Deposit cash failed:', err && err.message);
    return res.status(500).json({ error: String(err && err.message) });
  }
});

/**
 * POST /api/wallet/withdraw-request
 * Body: { amount: number, email: string }
 * Auth: Bearer <idToken>
 * Creates a withdrawal request and emails support + user confirmation.
 */
app.post('/api/wallet/withdraw-request', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    const uid = req.uid;
    const amount = Number(req.body && req.body.amount);
    const emailRaw = req.body && req.body.email ? String(req.body.email).trim() : '';
    if (!Number.isFinite(amount) || amount < 1) return res.status(400).json({ error: 'Invalid amount' });
    if (amount > MAX_WITHDRAW_AMOUNT) return res.status(400).json({ error: `Amount exceeds max $${MAX_WITHDRAW_AMOUNT}` });
    if (!emailRaw || emailRaw.length > MAX_EMAIL_LENGTH || !/^\S+@\S+\.\S+$/.test(emailRaw)) return res.status(400).json({ error: 'Invalid email' });

    const ip = getClientIp(req);
    const ipAllowed = checkRateLimit(`withdraw:ip:${ip}`, RATE_LIMITS.withdraw.windowMs, RATE_LIMITS.withdraw.max);
    const uidAllowed = checkRateLimit(`withdraw:uid:${uid}`, RATE_LIMITS.withdraw.windowMs, RATE_LIMITS.withdraw.max);
    if (!ipAllowed || !uidAllowed) return res.status(429).json({ error: 'Too many withdrawal requests. Please wait and try again.' });

    const userSnap = await firestore.collection('users').doc(uid).get();
    const user = userSnap.exists ? userSnap.data() : {};
    const currentCash = Number(user.cashBalance || 0);
    if (Number.isFinite(currentCash) && amount > currentCash) {
      return res.status(400).json({ error: 'Amount exceeds available cash balance' });
    }
    const requestRef = firestore.collection('withdrawalRequests').doc();
    const requestDoc = {
      requestId: requestRef.id,
      userId: uid,
      email: emailRaw,
      amount: Math.round(amount * 100) / 100,
      status: 'requested',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      cashBalance: Number(user.cashBalance || 0),
      tokenBalance: Number(user.tokenBalance || 0),
      ip,
      userAgent: String(req.headers['user-agent'] || '')
    };
    await requestRef.set(requestDoc);

    await sendWithdrawEmails({
      amount: requestDoc.amount,
      email: requestDoc.email,
      uid,
      requestId: requestRef.id
    });

    return res.json({ ok: true, requestId: requestRef.id });
  } catch (err) {
    console.error('Withdraw request failed:', err && err.message);
    return res.status(500).json({ error: String(err && err.message) });
  }
});

/**
 * POST /api/lock/boost
 * Auth: Bearer <idToken>
 * Spends tokens to boost the Lock of the Day once per day.
 */
app.post('/api/lock/boost', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    const uid = req.uid;
    const ip = getClientIp(req);
    const ipAllowed = checkRateLimit(`lock:ip:${ip}`, RATE_LIMITS.lockBoost.windowMs, RATE_LIMITS.lockBoost.max);
    const uidAllowed = checkRateLimit(`lock:uid:${uid}`, RATE_LIMITS.lockBoost.windowMs, RATE_LIMITS.lockBoost.max);
    if (!ipAllowed || !uidAllowed) return res.status(429).json({ error: 'Lock boost already used today.' });

    const todayKey = getUtcDateKey(new Date());
    const userRef = firestore.collection('users').doc(uid);
    const result = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new Error('User not found');
      const user = snap.data() || {};
      const lastBoost = String(user.lockBoostDate || '');
      if (lastBoost === todayKey) {
        return { ok: false, reason: 'already-boosted' };
      }
      const currentTokens = Number(user.tokenBalance || 0);
      if (currentTokens < LOCK_BOOST_COST) {
        return { ok: false, reason: 'insufficient-tokens' };
      }
      const nextTokens = Math.trunc(currentTokens - LOCK_BOOST_COST);
      tx.update(userRef, {
        tokenBalance: nextTokens,
        lockBoostDate: todayKey,
        lockBoostCost: LOCK_BOOST_COST
      });
      return { ok: true, tokenBalance: nextTokens };
    });

    if (!result.ok) {
      if (result.reason === 'already-boosted') return res.status(429).json({ error: 'Lock boost already used today.' });
      if (result.reason === 'insufficient-tokens') return res.status(400).json({ error: 'Not enough tokens to boost.' });
      return res.status(400).json({ error: 'Unable to boost.' });
    }

    return res.json({ ok: true, tokenBalance: result.tokenBalance, cost: LOCK_BOOST_COST });
  } catch (err) {
    console.error('Lock boost failed:', err && err.message);
    return res.status(500).json({ error: String(err && err.message) });
  }
});

/**
 * POST /api/support/ticket
 * Body: { name: string, email: string, subject: string, message: string }
 * Auth: optional Bearer <idToken>
 * Creates a support ticket and emails support + user confirmation.
 */
app.post('/api/support/ticket', async (req, res) => {
  try {
    let uid = null;
    try {
      uid = await getOptionalUid(req);
    } catch (authErr) {
      return res.status(401).json({ error: 'Invalid id token' });
    }

    const name = req.body && req.body.name ? String(req.body.name).trim() : '';
    const email = req.body && req.body.email ? String(req.body.email).trim() : '';
    const subject = req.body && req.body.subject ? String(req.body.subject).trim() : '';
    const message = req.body && req.body.message ? String(req.body.message).trim() : '';

    if (!name || name.length < 2 || name.length > MAX_NAME_LENGTH) return res.status(400).json({ error: 'Invalid name' });
    if (!email || email.length > MAX_EMAIL_LENGTH || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (!subject || subject.length < 3 || subject.length > MAX_SUBJECT_LENGTH) return res.status(400).json({ error: 'Invalid subject' });
    if (!message || message.length < 10 || message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: 'Invalid message' });

    const ip = getClientIp(req);
    const key = `support:${uid || ip}`;
    const ok = checkRateLimit(key, RATE_LIMITS.support.windowMs, RATE_LIMITS.support.max);
    if (!ok) return res.status(429).json({ error: 'Too many support requests. Please wait and try again.' });

    const ticketRef = firestore.collection('supportTickets').doc();
    const ticketDoc = {
      ticketId: ticketRef.id,
      userId: uid,
      name,
      email,
      subject,
      message,
      status: 'new',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ip,
      userAgent: String(req.headers['user-agent'] || '')
    };
    await ticketRef.set(ticketDoc);

    await sendSupportEmail({
      ticketId: ticketRef.id,
      name,
      email,
      subject,
      message,
      uid
    });

    return res.json({ ok: true, ticketId: ticketRef.id });
  } catch (err) {
    console.error('Support ticket failed:', err && err.message);
    return res.status(500).json({ error: String(err && err.message) });
  }
});

/**
 * POST /api/careers/apply
 * FormData: { name, email, phone?, position, linkedin?, about, resume? }
 * Auth: optional Bearer <idToken>
 * Creates a careers application and emails support + user confirmation.
 */
app.post('/api/careers/apply', (req, res) => {
  upload.single('resume')(req, res, async (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Resume file too large (max 5MB).' });
    }
    if (err) {
      console.error('Resume upload failed:', err && err.message);
      return res.status(400).json({ error: 'Invalid upload' });
    }

    try {
      let uid = null;
      try {
        uid = await getOptionalUid(req);
      } catch (authErr) {
        return res.status(401).json({ error: 'Invalid id token' });
      }

      const name = req.body && req.body.name ? String(req.body.name).trim() : '';
      const email = req.body && req.body.email ? String(req.body.email).trim() : '';
      const phone = req.body && req.body.phone ? String(req.body.phone).trim() : '';
      const position = req.body && req.body.position ? String(req.body.position).trim() : '';
      const linkedin = req.body && req.body.linkedin ? String(req.body.linkedin).trim() : '';
      const about = req.body && req.body.about ? String(req.body.about).trim() : '';

      const allowedPositions = ['Business Associate', 'Developer'];
      if (!name || name.length < 2 || name.length > MAX_NAME_LENGTH) return res.status(400).json({ error: 'Invalid name' });
      if (!email || email.length > MAX_EMAIL_LENGTH || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
      if (phone && phone.length > MAX_PHONE_LENGTH) return res.status(400).json({ error: 'Invalid phone' });
      if (linkedin && linkedin.length > MAX_LINKEDIN_LENGTH) return res.status(400).json({ error: 'Invalid LinkedIn URL' });
      if (!allowedPositions.includes(position)) return res.status(400).json({ error: 'Invalid position' });
      if (!about || about.length < 20 || about.length > MAX_ABOUT_LENGTH) return res.status(400).json({ error: 'Tell us more about yourself' });

      const resume = req.file || null;
      if (resume) {
        const allowedTypes = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        const allowedExt = ['.pdf', '.doc', '.docx'];
        const ext = path.extname(String(resume.originalname || '')).toLowerCase();
        if (!allowedTypes.includes(resume.mimetype) || !allowedExt.includes(ext)) {
          return res.status(400).json({ error: 'Resume must be a PDF, DOC, or DOCX.' });
        }
      }

      const ip = getClientIp(req);
      const key = `careers:${uid || ip}`;
      const ok = checkRateLimit(key, RATE_LIMITS.careers.windowMs, RATE_LIMITS.careers.max);
      if (!ok) return res.status(429).json({ error: 'Too many applications. Please wait and try again.' });

      const applicationRef = firestore.collection('careerApplications').doc();
      const applicationDoc = {
        applicationId: applicationRef.id,
        userId: uid,
        name,
        email,
        phone,
        position,
        linkedin,
        about,
        resume: resume ? {
          fileName: resume.originalname || 'resume',
          contentType: resume.mimetype || null,
          size: resume.size || null
        } : null,
        status: 'new',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ip,
        userAgent: String(req.headers['user-agent'] || '')
      };
      await applicationRef.set(applicationDoc);

      await sendCareerEmail({
        applicationId: applicationRef.id,
        name,
        email,
        phone,
        position,
        linkedin,
        about,
        uid,
        resume
      });

      return res.json({ ok: true, applicationId: applicationRef.id });
    } catch (innerErr) {
      console.error('Career apply failed:', innerErr && innerErr.message);
      return res.status(500).json({ error: String(innerErr && innerErr.message) });
    }
  });
});

/**
 * POST /api/spin/claim
 * Auth: Bearer <idToken>
 * Claims the daily spin reward (once per day after 12:00 PM).
 */
app.post('/api/spin/claim', authMiddleware, async (req, res) => {
  try {
    const uid = req.uid;
    const result = await firestoreBets.claimDailySpin(uid);
    return res.json({ ok: true, reward: Number(result.reward || 0), tokenBalance: Number(result.tokenBalance || 0), spinDate: result.spinDate });
  } catch (err) {
    if (err && err.code === 'SPIN_NOT_READY') {
      return res.status(403).json({ error: 'Spin not available until 12:00 PM', nextAvailableAt: err.nextAvailableAt || null });
    }
    if (err && err.code === 'SPIN_ALREADY_CLAIMED') {
      return res.status(429).json({ error: 'Spin already claimed', nextAvailableAt: err.nextAvailableAt || null });
    }
    console.error('Daily spin claim failed:', err && err.message);
    return res.status(500).json({ error: String(err && err.message) });
  }
});

// Schedule a fetch every 30 minutes so picks refresh frequently.
cron.schedule('*/30 * * * *', () => {
  fetchLatestPicks();
});

// Settle pending bets every hour using SportsDataIO scores.
cron.schedule('5 * * * *', () => {
  settlePendingBets();
});

// Schedule computation of the daily picks according to the user's
// requirements.  On weekdays (Monday through Friday) the picks are
// generated once daily at 17:00.  On weekends (Saturday and Sunday)
// they are generated at 10:00 and then refreshed at 16:00.  Each
// scheduled job calls computeDailyPicks() which itself calls
// fetchLatestPicks() to ensure the underlying event list is up to
// date.
cron.schedule('0 17 * * 1-5', () => {
  computeDailyPicks();
});
cron.schedule('0 10 * * 6,0', () => {
  computeDailyPicks();
});
cron.schedule('0 16 * * 6,0', () => {
  computeDailyPicks();
});

// Read scoreboard
async function readScoreboard() {
  try {
    const doc = await firestore.collection('scoreboard').doc('main').get();
    if (doc.exists) return doc.data().payload || { users: [] };
  } catch (e) {
    console.warn('readScoreboard: Firestore read failed, falling back to disk:', e && e.message);
  }
  try {
    const data = fs.readFileSync(SCOREBOARD_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { users: [] };
  }
}

// --------------------------------------------------------------------------
// Authentication: verify Google ID token and create user on first login
// --------------------------------------------------------------------------
/**
 * POST /verifyToken
 *
 * Accepts a Google ID token from the client, verifies it using Firebase Admin,
 * and creates a user document in Firestore on first login. Returns
 * `{ ok: true }` on success or an error message on failure. This route is
 * invoked by the login page after the user signs in with Google.
 */
app.post('/verifyToken', async (req, res) => {
  const { idToken } = req.body || {};

  // Development convenience: accept an explicit dev UID via POST (devUid)
  // or the x-dev-uid header even when token verification is enabled. This
  // allows quick local testing without relying on the Auth emulator.
  if (process.env.NODE_ENV !== 'production') {
    const devUid = (req.body && req.body.devUid) || req.headers['x-dev-uid'] || process.env.DEV_AUTH_UID;
    const email = (req.body && req.body.email) || '';
    if (devUid && !idToken) {
      try {
        const created = await firestoreBets.createUserProfile(String(devUid), email, { fullName: '', dateOfBirth: null, ageVerified: false, authProvider: 'dev' });
        const data = created.data || {};
        console.log('Dev verifyToken: created/fetched profile for', devUid);
        return res.json({ ok: true, user: Object.assign({ uid: devUid }, data) });
      } catch (err) {
        console.error('Failed to create or fetch dev user profile:', err && err.message);
        return res.status(500).json({ error: 'Failed to ensure user profile (dev)' });
      }
    }
  }

  if (!idToken) {
    return res.status(400).json({ error: 'Missing idToken' });
  }

  try {
    // Verify the authenticity of the provided Google ID token. This throws
    // if the token is expired, revoked, or otherwise invalid.
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    // Use the Firestore helper to create or return existing profile.
    // NOTE: do not auto-populate the full name from the ID token so the
    // onboarding/profile completion flow will collect the rest of the data.
    // Determine auth provider from token claims when available.
    const providerRaw = (decoded.firebase && decoded.firebase.sign_in_provider) || decoded.sign_in_provider || '';
    let authProvider = 'password';
    if (typeof providerRaw === 'string' && providerRaw.toLowerCase().includes('google')) authProvider = 'google';
    try {
      const created = await firestoreBets.createUserProfile(uid, decoded.email || '', { fullName: '', dateOfBirth: null, ageVerified: false, authProvider });
      const data = created.data || {};
      return res.json({ ok: true, user: Object.assign({ uid }, data) });
    } catch (err) {
      console.error('Failed to create or fetch user profile:', err && err.message);
      return res.status(500).json({ error: 'Failed to ensure user profile' });
    }
  } catch (err) {
    console.error('Failed to verify ID token:', err);
    return res.status(401).json({ error: 'Invalid ID token' });
  }
});

// New endpoint matching the requested API: POST /api/auth/google
// Verifies a Firebase ID token, creates a Firestore user doc if missing,
// and returns whether onboarding is required. This mirrors /verifyToken
// but exposes the expected API name for clients.
app.post('/api/auth/google', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'Missing idToken' });
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || '';
    const displayName = decoded.name || decoded['firebase'] && decoded['firebase'].identities && decoded['firebase'].identities.email || '';
    // Ensure a user profile exists
    try {
      const created = await firestoreBets.createUserProfile(uid, email, { fullName: '', dateOfBirth: null, ageVerified: false, authProvider: 'google' });
      // If newly created, onboarding is required
      if (created && created.created) {
        return res.json({ onboardingRequired: true, uid });
      }
      // Existing user -- check profileComplete
      const existing = created && created.data ? created.data : await firestoreBets.getUserProfile(uid);
      if (!existing) return res.status(500).json({ error: 'Failed to load user profile after creation' });
      // Update lastLogin timestamp
      try { await firestoreBets.updateLastLogin(uid); } catch (e) { /* non-fatal */ }
      if (existing.profileComplete) {
        return res.json({ onboardingRequired: false, profile: existing });
      }
      return res.json({ onboardingRequired: true, uid });
    } catch (err) {
      console.error('Failed to ensure user profile:', err && err.message);
      return res.status(500).json({ error: 'Failed to ensure user profile' });
    }
  } catch (err) {
    console.error('Failed to verify ID token (api/auth/google):', err && err.message);
    return res.status(401).json({ error: 'Invalid ID token' });
  }
});

  // --------------------------------------------------------------------------
  // Authenticated user profile endpoint
  // --------------------------------------------------------------------------
  app.get('/api/me', authMiddleware, async (req, res) => {
    try {
      const uid = req.uid;
      const profile = await firestoreBets.getUserProfile(uid);
      if (!profile) return res.status(404).json({ error: 'User not found' });
      // Return an authoritative, read-only view of the user's profile
      // Return both the canonical `dateOfBirth` and a backward-compatible
      // `dob` property because several older client pages expect `dob`.
      return res.json({
        uid,
        email: profile.email || '',
        authProvider: profile.authProvider || 'password',
        fullName: profile.fullName || '',
        screenName: profile.screenName || null,
        dateOfBirth: profile.dateOfBirth || null,
        // Backwards compat: some client pages (wallet/profile JS) reference `dob`
        dob: profile.dateOfBirth || profile.dob || null,
        ageVerified: !!profile.ageVerified,
        address: profile.address || null,
        termsAccepted: !!profile.termsAccepted,
        profileComplete: !!profile.profileComplete,
        avatarId: profile.avatarId || null,
        tokens: Number(profile.tokenBalance || 0),
        cash: Number(profile.cashBalance || 0),
        cashBalance: Number(profile.cashBalance || 0),
        stats: profile.stats || { wins: 0, losses: 0, pending: 0, totalBets: 0, totalParlays: 0 },
        xp: Number(profile.xp || 0),
        level: profile.level || 'Bronze',
        streakWins: Number(profile.streakWins || 0),
        bestStreak: Number(profile.bestStreak || 0),
        streakMultiplier: Number(profile.streakMultiplier || 1),
        points: Number(profile.points || 0),
        firstBetRewarded: !!profile.firstBetRewarded,
        firstParlayRewarded: !!profile.firstParlayRewarded,
        firstBetEligible: !!profile.firstBetEligible,
        firstParlayEligible: !!profile.firstParlayEligible,
        firstBetClaimedAt: profile.firstBetClaimedAt || null,
        firstParlayClaimedAt: profile.firstParlayClaimedAt || null,
        dailyTasks: profile.dailyTasks || null,
        weeklyTasks: profile.weeklyTasks || null,
        dailyInsights: profile.dailyInsights || null,
        createdAt: profile.createdAt || null,
        lastLogin: profile.lastLogin || null
      });
    } catch (err) {
      console.error('Failed to load profile:', err && err.message);
      return res.status(500).json({ error: 'Failed to load profile' });
    }
  });

// Write scoreboard
async function writeScoreboard(scoreboard) {
  try {
    await firestore.collection('scoreboard').doc('main').set({ payload: scoreboard, seededAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    console.warn('writeScoreboard: Firestore write failed:', e && e.message);
  }
  try {
    fs.writeFileSync(SCOREBOARD_PATH, JSON.stringify(scoreboard, null, 2));
  } catch (e) {
    console.warn('writeScoreboard: disk write failed:', e && e.message);
  }
}

// API to get scoreboard
app.get('/api/scoreboard', async (req, res) => {
  try {
    const scoreboard = await readScoreboard();
    res.json(scoreboard);
  } catch (e) {
    console.error('Failed to load scoreboard:', e && e.message);
    res.status(500).json({ error: 'Failed to load scoreboard' });
  }
});

// Overall player leaderboard based on points
app.get('/api/leaderboard/players', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
    const startAfterPointsRaw = req.query.startAfterPoints;
    let query = firestore.collection('users').orderBy('points', 'desc');
    if (typeof startAfterPointsRaw !== 'undefined') {
      const startAfterPoints = Number(startAfterPointsRaw);
      if (!Number.isFinite(startAfterPoints)) {
        return res.status(400).json({ error: 'startAfterPoints must be a number' });
      }
      query = query.startAfter(startAfterPoints);
    }
    const snap = await query.limit(limit).get();
    const rows = [];
    snap.forEach((doc) => {
      const u = doc.data() || {};
      const email = String(u.email || '');
      const name = u.screenName || u.fullName || (email ? email.split('@')[0] : 'Player');
      rows.push({
        uid: u.uid || doc.id,
        name,
        avatarId: u.avatarId || null,
        points: Number(u.points || 0),
        level: u.level || 'Bronze',
        xp: Number(u.xp || 0),
        wins: Number(u.stats && u.stats.wins || 0),
        streakWins: Number(u.streakWins || 0)
      });
    });
    let nextCursor = null;
    if (!snap.empty && snap.size === limit) {
      const lastDoc = snap.docs[snap.docs.length - 1];
      const lastData = lastDoc.data() || {};
      nextCursor = {
        startAfterPoints: Number(lastData.points || 0)
      };
    }
    return res.json({ players: rows, nextCursor });
  } catch (err) {
    console.error('Leaderboard load failed:', err && err.message);
    return res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// Track when a player views an insight panel
app.post('/api/insights/view', authMiddleware, async (req, res) => {
  try {
    const uid = req.uid;
    const dailyInsights = await firestoreBets.recordInsightView(uid);
    return res.json({ ok: true, dailyInsights });
  } catch (err) {
    console.error('Insight view tracking failed:', err && err.message);
    return res.status(500).json({ error: 'Failed to record insight view' });
  }
});

// --------------------------------------------------------------------------
// NBA team logo proxy (API-Sports)
// --------------------------------------------------------------------------
const NBA_TEAM_NAME_MAP = {
  atlanta: 'Atlanta Hawks',
  hawks: 'Atlanta Hawks',
  boston: 'Boston Celtics',
  celtics: 'Boston Celtics',
  brooklyn: 'Brooklyn Nets',
  nets: 'Brooklyn Nets',
  charlotte: 'Charlotte Hornets',
  hornets: 'Charlotte Hornets',
  chicago: 'Chicago Bulls',
  bulls: 'Chicago Bulls',
  cleveland: 'Cleveland Cavaliers',
  cavaliers: 'Cleveland Cavaliers',
  cavs: 'Cleveland Cavaliers',
  dallas: 'Dallas Mavericks',
  mavericks: 'Dallas Mavericks',
  mavs: 'Dallas Mavericks',
  denver: 'Denver Nuggets',
  nuggets: 'Denver Nuggets',
  detroit: 'Detroit Pistons',
  pistons: 'Detroit Pistons',
  goldenstate: 'Golden State Warriors',
  gsw: 'Golden State Warriors',
  warriors: 'Golden State Warriors',
  houston: 'Houston Rockets',
  rockets: 'Houston Rockets',
  indiana: 'Indiana Pacers',
  pacers: 'Indiana Pacers',
  laclippers: 'Los Angeles Clippers',
  clippers: 'Los Angeles Clippers',
  losangelesclippers: 'Los Angeles Clippers',
  lalakers: 'Los Angeles Lakers',
  lakers: 'Los Angeles Lakers',
  losangeleslakers: 'Los Angeles Lakers',
  memphis: 'Memphis Grizzlies',
  grizzlies: 'Memphis Grizzlies',
  miami: 'Miami Heat',
  heat: 'Miami Heat',
  milwaukee: 'Milwaukee Bucks',
  bucks: 'Milwaukee Bucks',
  minnesota: 'Minnesota Timberwolves',
  timberwolves: 'Minnesota Timberwolves',
  wolves: 'Minnesota Timberwolves',
  neworleans: 'New Orleans Pelicans',
  pelicans: 'New Orleans Pelicans',
  nyknicks: 'New York Knicks',
  newyorkknicks: 'New York Knicks',
  knicks: 'New York Knicks',
  okc: 'Oklahoma City Thunder',
  oklahomacity: 'Oklahoma City Thunder',
  thunder: 'Oklahoma City Thunder',
  orlando: 'Orlando Magic',
  magic: 'Orlando Magic',
  philadelphia: 'Philadelphia 76ers',
  philly: 'Philadelphia 76ers',
  sixers: 'Philadelphia 76ers',
  phoenix: 'Phoenix Suns',
  suns: 'Phoenix Suns',
  portland: 'Portland Trail Blazers',
  trailblazers: 'Portland Trail Blazers',
  blazers: 'Portland Trail Blazers',
  sacramento: 'Sacramento Kings',
  kings: 'Sacramento Kings',
  sanantonio: 'San Antonio Spurs',
  spurs: 'San Antonio Spurs',
  toronto: 'Toronto Raptors',
  raptors: 'Toronto Raptors',
  utah: 'Utah Jazz',
  jazz: 'Utah Jazz',
  washington: 'Washington Wizards',
  wizards: 'Washington Wizards'
};

const NBA_TEAM_ID_MAP = {
  atlantahawks: '1610612737',
  bostonceltics: '1610612738',
  brooklynnets: '1610612751',
  charlottehornets: '1610612766',
  chicagobulls: '1610612741',
  clevelandcavaliers: '1610612739',
  dallasmavericks: '1610612742',
  denvernuggets: '1610612743',
  detroitpistons: '1610612765',
  goldenstatewarriors: '1610612744',
  houstonrockets: '1610612745',
  indianapacers: '1610612754',
  losangelesclippers: '1610612746',
  losangeleslakers: '1610612747',
  memphisgrizzlies: '1610612763',
  miamiheat: '1610612748',
  milwaukeebucks: '1610612749',
  minnesotatimberwolves: '1610612750',
  neworleanspelicans: '1610612740',
  newyorkknicks: '1610612752',
  oklahomacitythunder: '1610612760',
  orlandomagic: '1610612753',
  philadelphia76ers: '1610612755',
  phoenixsuns: '1610612756',
  portlandtrailblazers: '1610612757',
  sacramentokings: '1610612758',
  sanantoniospurs: '1610612759',
  torontoraptors: '1610612761',
  utahjazz: '1610612762',
  washingtonwizards: '1610612764'
};

function normalizeTeamKey(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveNbaTeamName(name = '') {
  const key = normalizeTeamKey(name);
  return NBA_TEAM_NAME_MAP[key] || name;
}

function getNbaFallbackLogo(teamName = '') {
  const resolved = resolveNbaTeamName(teamName);
  const key = normalizeTeamKey(resolved);
  const teamId = NBA_TEAM_ID_MAP[key];
  if (!teamId) return null;
  return `https://cdn.nba.com/logos/nba/${teamId}/global/L/logo.svg`;
}

function getSportsDataTeamLogo(team) {
  return team.WikipediaLogoUrl || team.TeamLogoUrl || team.LogoUrl || null;
}

function buildSportsDataTeamName(team) {
  const city = team.City || team.Location || '';
  const name = team.Name || team.TeamName || '';
  const combined = `${city} ${name}`.trim();
  return combined || team.Key || team.Abbreviation || team.Name || 'Team';
}

function findSportsDataTeam(teams, name) {
  const key = normalizeTeamKey(name);
  return teams.find((team) => {
    const candidates = [
      team.Name,
      team.TeamName,
      team.Key,
      team.Abbreviation,
      buildSportsDataTeamName(team)
    ].filter(Boolean);
    return candidates.some((value) => normalizeTeamKey(value) === key);
  }) || null;
}

async function lookupTeamLogo(name, sport) {
  const safeSport = getSportsDataSport(sport);
  const resolvedName = safeSport === 'nba' ? resolveNbaTeamName(name) : name;
  const teams = await getSportsDataTeams(safeSport);
  const team = findSportsDataTeam(teams, resolvedName) || findSportsDataTeam(teams, name);
  if (team) {
    const logo = getSportsDataTeamLogo(team);
    if (logo) return { logo, team: { name: buildSportsDataTeamName(team), teamId: team.TeamID || team.TeamId || null, key: team.Key || null } };
  }

  if (safeSport === 'nba') {
    const fallbackLogo = getNbaFallbackLogo(name);
    if (fallbackLogo) return { logo: fallbackLogo, team: { name: resolveNbaTeamName(name) } };
  }
  return null;
}
app.get('/api/teams/logo', async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    const league = String(req.query.league || '');
    const sport = String(req.query.sport || '').trim();
    if (!name) return res.status(400).json({ error: 'Missing team name' });
    if (!SPORTSDATA_KEY) return res.status(503).json({ error: 'SPORTSDATAIO_KEY not configured' });

    const inferredSport = sport || (league === '12' ? 'nba' : 'nba');
    const result = await lookupTeamLogo(name, inferredSport);
    if (!result || !result.logo) {
      return res.status(404).json({ error: 'Team not found' });
    }
    return res.json({ logo: result.logo, team: result.team });
  } catch (err) {
    console.error('Logo lookup failed:', err && err.message);
    return res.status(500).json({ error: 'Failed to fetch logo' });
  }
});

// Serve team logos via this backend to avoid third-party image blocking
app.get('/api/teams/logo/image', async (req, res) => {
  try {
    const name = String(req.query.name || '').trim();
    const league = String(req.query.league || '');
    const sport = String(req.query.sport || '').trim();
    if (!name) return res.status(400).json({ error: 'Missing team name' });
    if (!SPORTSDATA_KEY) return res.status(503).json({ error: 'SPORTSDATAIO_KEY not configured' });

    const inferredSport = sport || (league === '12' ? 'nba' : 'nba');
    const result = await lookupTeamLogo(name, inferredSport);
    if (!result || !result.logo) return res.status(404).json({ error: 'Team not found' });

    const imgResp = await axios.get(result.logo, { responseType: 'arraybuffer' });
    const contentType = (imgResp && imgResp.headers && imgResp.headers['content-type']) || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(Buffer.from(imgResp.data));
  } catch (err) {
    console.error('Logo image proxy failed:', err && err.message);
    return res.status(500).json({ error: 'Failed to fetch logo image' });
  }
});

// Update authenticated user's profile (partial updates allowed)
// Endpoint used by the onboarding form to complete a user's profile.
// Validates required fields, computes ageVerified and sets profileComplete=true.
app.post('/api/profile', authMiddleware, async (req, res) => {
  try {
    const uid = req.uid;
    const payload = req.body || {};
    // Required fields
    const fullName = (payload.fullName || '').trim();
    const screenNameRaw = (payload.screenName || '').trim();
    const screenName = screenNameRaw.toUpperCase();
    const dateOfBirth = payload.dateOfBirth || payload.dob || null; // accept dob for backwards compat
    const avatarId = String(payload.avatarId || '').trim();
    const address = payload.address || {
      street: payload.street || payload.addressStreet || null,
      city: payload.city || null,
      region: payload.region || null,
      postalCode: payload.postalCode || payload.postal || null,
      country: payload.country || null
    };
    const termsAccepted = !!payload.termsAccepted;

    if (!fullName) return res.status(400).json({ error: 'fullName is required' });
    if (!screenName) return res.status(400).json({ error: 'screenName is required' });
    if (!/^[A-Z0-9_.]+$/.test(screenName)) return res.status(400).json({ error: 'screenName must be A-Z, 0-9, _ or . (no spaces)' });
    if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateOfBirth))) return res.status(400).json({ error: 'dateOfBirth is required in YYYY-MM-DD format' });
    const allowedAvatars = new Set(['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6']);
    if (!avatarId || !allowedAvatars.has(avatarId)) return res.status(400).json({ error: 'avatarId must be a valid avatar selection' });
    // Compute age (UTC-safe)
    const dob = new Date(String(dateOfBirth) + 'T00:00:00Z');
    if (Number.isNaN(dob.getTime())) return res.status(400).json({ error: 'Invalid dateOfBirth' });
    const now = new Date();
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const m = now.getUTCMonth() - dob.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
    const MIN_AGE = process.env.MINIMUM_AGE ? Number(process.env.MINIMUM_AGE) : 18;
    if (!Number.isFinite(age) || age < MIN_AGE) return res.status(400).json({ error: `User must be at least ${MIN_AGE} years old` });

    // Validate address fields
    if (!address || !address.street || !address.city || !address.region || !address.postalCode || !address.country) {
      return res.status(400).json({ error: 'Complete address (street, city, region, postalCode, country) is required' });
    }
    if (!termsAccepted) return res.status(400).json({ error: 'You must accept the terms' });

    // Prepare the updates we will write server-side. Client is not allowed to set tokenBalance or stats.
    const toSave = {
      fullName,
      screenName,
      dateOfBirth: String(dateOfBirth),
      avatarId,
      ageVerified: true,
      address: {
        street: String(address.street),
        city: String(address.city),
        region: String(address.region),
        postalCode: String(address.postalCode),
        country: String(address.country)
      },
      termsAccepted: true,
      profileComplete: true,
      lastLogin: admin.firestore.FieldValue.serverTimestamp()
    };

    // Enforce unique, non-reusable screen names via a reservation document.
    const userRef = firestore.collection('users').doc(uid);
    const screenNameRef = firestore.collection('screenNames').doc(screenName);
    const updated = await firestore.runTransaction(async (tx) => {
      const [userSnap, nameSnap] = await Promise.all([tx.get(userRef), tx.get(screenNameRef)]);
      const existingUser = userSnap.exists ? (userSnap.data() || {}) : {};
      const existingScreen = existingUser.screenName || null;

      if (existingScreen && existingScreen !== screenName) {
        throw new Error('screen-name-locked');
      }

      if (nameSnap.exists) {
        const owner = nameSnap.data() && nameSnap.data().uid ? String(nameSnap.data().uid) : null;
        if (owner && owner !== String(uid)) {
          throw new Error('screen-name-taken');
        }
      }

      tx.set(screenNameRef, {
        uid: String(uid),
        screenName,
        createdAt: nameSnap.exists
          ? (nameSnap.data() && nameSnap.data().createdAt ? nameSnap.data().createdAt : admin.firestore.FieldValue.serverTimestamp())
          : admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      if (!existingUser || !existingUser.createdAt) {
        toSave.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }

      tx.set(userRef, toSave, { merge: true });
      return Object.assign({}, existingUser, toSave, { uid });
    });

    return res.json({ ok: true, user: Object.assign({ uid }, updated) });
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (msg === 'screen-name-taken') {
      return res.status(409).json({ error: 'Screen name already taken' });
    }
    if (msg === 'screen-name-locked') {
      return res.status(409).json({ error: 'Screen name cannot be changed once set' });
    }
    console.error('Failed to update profile:', err && err.message);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// API to get the current list of available picks. The server always
// returns at most 50 picks. Each entry includes the essential data
// needed by the client: event ID, home and away teams, start time and
// bookmakers. Clients can use this to display odds and allow users
// to place bets.
// API to get the current list of available picks. Supports optional
// `sport` query parameter to filter results by a specific sport key. If
// provided, only picks whose `sport_key` contains the supplied value
// (case‑insensitive) will be returned. Otherwise all picks are returned.
// The response always contains at most 50 entries, ordered chronologically
// by start time.
app.get('/api/nba/today', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    if (!SPORTSDATA_KEY) return res.status(503).json({ error: 'SPORTSDATAIO_KEY not configured' });
    const dateStr = formatSportsDataDate(new Date());
    const response = await fetchSportsData('nba', `/scores/json/GamesByDate/${dateStr}`);
    const games = Array.isArray(response.data) ? response.data : [];
    const teams = await getSportsDataTeams('nba');
    const byId = new Map();
    const byKey = new Map();
    teams.forEach((team) => {
      if (team.TeamID || team.TeamId) byId.set(String(team.TeamID || team.TeamId), team);
      if (team.Key) byKey.set(String(team.Key).toLowerCase(), team);
    });

    const formatTeam = (team, fallbackKey, fallbackId) => ({
      teamId: team && (team.TeamID || team.TeamId) ? String(team.TeamID || team.TeamId) : (fallbackId ? String(fallbackId) : null),
      teamName: team ? buildSportsDataTeamName(team) : (fallbackKey || 'Team'),
      teamCity: team && team.City ? team.City : '',
      teamTricode: team && team.Key ? team.Key : (fallbackKey || '')
    });

    const out = games.map((game) => {
      const homeKey = String(game.HomeTeam || game.HomeTeamKey || '').toLowerCase();
      const awayKey = String(game.AwayTeam || game.AwayTeamKey || '').toLowerCase();
      const homeId = game.HomeTeamID || game.HomeTeamId;
      const awayId = game.AwayTeamID || game.AwayTeamId;
      const homeTeam = (homeId && byId.get(String(homeId))) || (homeKey && byKey.get(homeKey)) || null;
      const awayTeam = (awayId && byId.get(String(awayId))) || (awayKey && byKey.get(awayKey)) || null;
      return {
        gameId: game.GameID || game.GameId || game.GameKey,
        gameTimeUTC: game.DateTime || game.DateTimeUTC || game.Day || null,
        statusText: game.Status || game.StatusText || game.GameStatus || '',
        homeTeam: formatTeam(homeTeam, game.HomeTeam || game.HomeTeamKey, homeId),
        awayTeam: formatTeam(awayTeam, game.AwayTeam || game.AwayTeamKey, awayId)
      };
    });

    res.json({ games: out });
  } catch (e) {
    console.error('Failed to fetch NBA today:', e && e.message);
    res.status(502).json({ error: 'NBA service unavailable' });
  }
});

app.get('/api/nba/roster', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    const { teamId } = req.query;
    if (!teamId) return res.status(400).json({ error: 'teamId is required' });
    if (!SPORTSDATA_KEY) return res.status(503).json({ error: 'SPORTSDATAIO_KEY not configured' });
    const players = await getSportsDataPlayers('nba');
    const filtered = players.filter((p) => String(p.TeamID || p.TeamId || '') === String(teamId));
    const out = filtered.map((player) => {
      const first = player.FirstName || player.First || '';
      const last = player.LastName || player.Last || '';
      const fullName = player.Name || player.FullName || `${first} ${last}`.trim() || 'Player';
      return {
        playerId: player.PlayerID || player.PlayerId || player.ID || player.Id,
        fullName,
        position: player.Position || player.Pos || '',
        jersey: player.Jersey || player.JerseyNumber || ''
      };
    });
    res.json({ players: out });
  } catch (e) {
    console.error('Failed to fetch NBA roster:', e && e.message);
    res.status(502).json({ error: 'NBA service unavailable' });
  }
});

app.get('/api/nba/player-stats', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    const { playerId, playerName, season } = req.query;
    if (!playerId && !playerName) return res.status(400).json({ error: 'playerId or playerName is required' });
    if (!SPORTSDATA_KEY) return res.status(503).json({ error: 'SPORTSDATAIO_KEY not configured' });

    const seasonYear = season || String(new Date().getUTCFullYear());
    let statsPayload = null;
    if (playerId) {
      try {
        const resp = await fetchSportsData('nba', `/stats/json/PlayerSeasonStatsByPlayer/${encodeURIComponent(seasonYear)}/${encodeURIComponent(playerId)}`);
        statsPayload = Array.isArray(resp.data) ? resp.data[0] : resp.data;
      } catch (err) {
        statsPayload = null;
      }
    }

    if (statsPayload) {
      const stats = normalizeSportsDataStats(statsPayload, playerName, seasonYear);
      return res.json(stats);
    }

    let name = playerName || 'Player';
    if (!playerName && playerId) {
      try {
        const players = await getSportsDataPlayers('nba');
        const match = players.find((p) => String(p.PlayerID || p.PlayerId || p.ID || p.Id) === String(playerId));
        if (match) name = match.Name || match.FullName || `${match.FirstName || ''} ${match.LastName || ''}`.trim() || name;
      } catch (e) {
        name = name;
      }
    }

    return res.json({ error: 'Stats unavailable', player: { name }, season: seasonYear });
  } catch (e) {
    console.error('Failed to fetch NBA player stats:', e && e.message);
    res.status(502).json({ error: 'NBA service unavailable' });
  }
});

app.get('/api/picks', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    const { sport } = req.query;
    let picks = await readPicks();
    let limited = filterPicksForResponse(picks, sport);
    if (limited.length === 0) {
      await fetchLatestPicks();
      picks = await readPicks();
      limited = filterPicksForResponse(picks, sport);
    }
    res.json(limited);
  } catch (e) {
    console.error('Failed to load picks:', e && e.message);
    res.status(500).json({ error: 'Failed to load picks' });
  }
});

// Optionally provide an endpoint to trigger a manual refresh of picks.
// Useful during development or if you want to refresh on demand.
app.post('/api/picks/update', authMiddleware, ensureProfileComplete, async (req, res) => {
  await fetchLatestPicks();
  res.json({ message: 'Picks updated successfully' });
});

// API to place a wager
app.post('/api/wager', async (req, res) => {
  try {
    const { user, amount } = req.body;
    if (!user || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invalid user or amount' });
    }
    const scoreboard = await readScoreboard();
    let player = (scoreboard.users || []).find((u) => u.name === user);
    if (!player) {
      player = { name: user, wager: 0 };
      scoreboard.users = scoreboard.users || [];
      scoreboard.users.push(player);
    }
    player.wager += amount;
    await writeScoreboard(scoreboard);
    res.json({ message: 'Wager placed successfully', scoreboard });
  } catch (e) {
    console.error('Failed to place wager:', e && e.message);
    res.status(500).json({ error: 'Failed to place wager' });
  }
});

// --------------------------------------------------------------------------
// Betting API - integrate pure betting logic with Firestore
// --------------------------------------------------------------------------

/**
 * POST /api/bets/place
 * Body: { selections: [...], stake: number, type: 'single'|'parlay' }
 * Auth: Bearer <idToken>
 */
app.post('/api/bets/place', authMiddleware, ensureProfileComplete, async (req, res) => {
  const uid = req.uid;
  const { selections, stake, type = 'single' } = req.body || {};
  if (!Array.isArray(selections) || !Number.isInteger(stake) || stake <= 0) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  try {
    // Delegate to Firestore-backed placement which performs transactional balance updates
    const result = await firestoreBets.placeBet(uid, { type, stake, selections });
    return res.json({ ok: true, bet: result.bet, rewards: result.rewards });
  } catch (err) {
    console.error('Place bet failed:', err && err.message);
    // Surface validation and domain errors as 400 where appropriate
    if (err.message && (err.message.includes('Insufficient') || err.message.includes('Invalid') || err.message.includes('Missing'))) {
      return res.status(400).json({ error: String(err.message) });
    }
    return res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * GET /api/bets
 * Returns bets for authenticated user
 */
app.get('/api/bets', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    const uid = req.uid;
    const bets = await firestoreBets.getUserBets(uid);
    return res.json({ bets });
  } catch (err) {
    console.error('Fetch bets failed:', err && err.message);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * POST /api/bets/settle
 * Admin-protected: header 'x-admin-key' must match process.env.ADMIN_KEY
 * Body: { betId: string, settlementResults: [{eventId,marketType,selection,outcome}] }
 */
app.post('/api/bets/settle', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
  const { betId, status } = req.body || {};
  if (!betId || !status) return res.status(400).json({ error: 'Invalid payload' });
  if (!['won', 'lost', 'void'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    const result = await firestoreBets.settleBet(betId, { status });
    return res.json({ ok: true, result });
  } catch (err) {
    console.error('Settle bet failed:', err && err.message);
    return res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * POST /api/tasks/claim
 * Body: { task: 'first-bet' | 'first-parlay' }
 */
app.post('/api/tasks/claim', authMiddleware, async (req, res) => {
  try {
    const uid = req.uid;
    const { task } = req.body || {};
    if (!task) return res.status(400).json({ error: 'Missing task' });
    const result = await firestoreBets.claimTaskReward(uid, task);
    return res.json(result);
  } catch (err) {
    console.error('Claim task reward failed:', err && err.message);
    if (err.message && err.message.includes('Invalid task')) {
      return res.status(400).json({ error: 'Invalid task' });
    }
    return res.status(500).json({ error: String(err.message || err) });
  }
});

// --------------------------------------------------------------------------
// Admin: Seed Firestore from repository JSON (protected)
// --------------------------------------------------------------------------
/**
 * POST /api/admin/seed
 * Headers: x-admin-key: <ADMIN_KEY>
 * Body: { force: true }  // optional to bypass emulator safety when SEED_FORCE=1
 * Seeds collections: picks, dailyPicks (doc: current), scoreboard (doc: main)
 */
app.post('/api/admin/seed', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });

    // Safety: require emulator or explicit SEED_FORCE=1 unless request body sets force and env allows it
    const bodyForce = req.body && req.body.force;
    const allowed = Boolean(process.env.FIRESTORE_EMULATOR_HOST) || process.env.SEED_FORCE === '1' || bodyForce === true;
    if (!allowed) {
      return res.status(400).json({ error: 'Seeding blocked: set FIRESTORE_EMULATOR_HOST for local seeding or SEED_FORCE=1 to seed production.' });
    }

    // Read files from disk
    const picksFile = PICKs_PATH || PICKS_PATH; // defensive
    const picksData = (() => {
      try { return JSON.parse(fs.readFileSync(PICKS_PATH, 'utf8')) || []; } catch (e) { return []; }
    })();
    const dailyData = (() => {
      try { return JSON.parse(fs.readFileSync(DAILY_PICKS_PATH, 'utf8')) || []; } catch (e) { return []; }
    })();
    const scoreboardData = (() => {
      try { return JSON.parse(fs.readFileSync(SCOREBOARD_PATH, 'utf8')) || { users: [] }; } catch (e) { return { users: [] }; }
    })();

    // Write picks in batches
    let writtenPicks = 0;
    if (Array.isArray(picksData) && picksData.length) {
      const BATCH_SIZE = 400;
      for (let i = 0; i < picksData.length; i += BATCH_SIZE) {
        const chunk = picksData.slice(i, i + BATCH_SIZE);
        const batch = firestore.batch();
        chunk.forEach(doc => {
          const id = String(doc.id || (Math.random().toString(36).slice(2, 10)));
          const ref = firestore.collection('picks').doc(id);
          batch.set(ref, doc, { merge: false });
        });
        await batch.commit();
        writtenPicks += chunk.length;
      }
    }

    // dailyPicks -> doc current
    if (Array.isArray(dailyData) && dailyData.length) {
      await firestore.collection('dailyPicks').doc('current').set({ picks: dailyData, seededAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    // scoreboard -> doc main
    if (scoreboardData && (Array.isArray(scoreboardData.users) && scoreboardData.users.length)) {
      await firestore.collection('scoreboard').doc('main').set({ payload: scoreboardData, seededAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    return res.json({ ok: true, writtenPicks, daily: (dailyData || []).length, scoreboardUsers: (scoreboardData.users || []).length });
  } catch (err) {
    console.error('Admin seed failed:', err && err.message);
    return res.status(500).json({ error: 'Admin seed failed', detail: String(err && err.message) });
  }
});

// Admin: list users (protected)
app.get('/api/admin/users', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
    const snap = await firestore.collection('users').orderBy('createdAt', 'desc').limit(limit).get();
    const users = [];
    snap.forEach(d => users.push(Object.assign({ uid: d.id }, d.data())));
    return res.json({ ok: true, users });
  } catch (err) {
    console.error('Admin list users failed:', err && err.message);
    return res.status(500).json({ error: 'Admin list users failed' });
  }
});

// Admin: get single user
app.get('/api/admin/user/:uid', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
    const uid = req.params.uid;
    if (!uid) return res.status(400).json({ error: 'Missing uid' });
    const snap = await firestore.collection('users').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });
    return res.json({ ok: true, user: Object.assign({ uid: snap.id }, snap.data()) });
  } catch (err) {
    console.error('Admin get user failed:', err && err.message);
    return res.status(500).json({ error: 'Admin get user failed' });
  }
});

// Serve a simple admin UI page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --------------------------------------------------------------------------
// Daily Picks API
// --------------------------------------------------------------------------
/**
 * GET /api/dailyPicks
 *
 * Returns the current list of daily picks.  The server always
 * responds with at most 50 entries, sorted in the order they were
 * selected by the algorithm.  Each object includes the event id,
 * competing teams, start time, sport key, the recommended team to bet
 * on (pickTeam), its decimal multiplier (pickTeamValue) and the
 * computed value score.  This route reads from the persisted
 * dailyPicks.json file rather than computing picks on demand.
 */
app.get('/api/dailyPicks', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    const picks = await readDailyPicks();
    res.json(picks.slice(0, 50));
  } catch (e) {
    console.error('Failed to load daily picks:', e && e.message);
    res.status(500).json({ error: 'Failed to load daily picks' });
  }
});

/**
 * POST /api/dailyPicks/update
 *
 * Manually trigger an update of the daily picks.  This can be used
 * during development or for debugging to force a refresh outside of
 * the scheduled windows.  The underlying computeDailyPicks() call
 * handles fetching new events and writing the result to disk.
 */
app.post('/api/dailyPicks/update', authMiddleware, ensureProfileComplete, async (req, res) => {
  try {
    await computeDailyPicks();
    res.json({ message: 'Daily picks updated successfully' });
  } catch (err) {
    console.error('Failed to update daily picks:', err);
    res.status(500).json({ error: 'Failed to update daily picks' });
  }
});

// --------------------------------------------------------------------------
// Debug endpoints (development only)
// --------------------------------------------------------------------------
// Provides an unauthenticated set of synthetic picks for quick UI testing.
// This endpoint is intentionally only active when not in production.
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/debug/fillerPicks', (req, res) => {
    try {
      const count = Number(req.query.count) || 20;
      const picks = generateFillerPicks(count);
      return res.json(picks);
    } catch (err) {
      console.error('debug fillerPicks failed:', err && err.message);
      return res.status(500).json({ error: 'Failed to generate filler picks' });
    }
  });
}

// Start the server
const PORT = process.env.PORT || 3000;

// Start server immediately
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  console.log('Server started successfully');
});

// Graceful and informative handling for common listen errors (e.g. EADDRINUSE)
server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`ERROR: Port ${PORT} is already in use. Another process may be running the server.`);
      console.error('To resolve:');
      console.error(`  - Stop the other process using port ${PORT}, or`);
      console.error('  - Start this server on a different port: set PORT=<port> && node server.js');
      console.error('Helpful commands (Windows cmd.exe):');
      console.error('  netstat -ano | findstr :' + PORT);
      console.error('  taskkill /PID <pid> /F');
      process.exit(1);
    }
    console.error('Server error:', err);
    process.exit(1);
  });

