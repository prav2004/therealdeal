const admin = require('firebase-admin');
const firestore = admin.firestore();

// Seed amount for new users. Centralized so it's easy to change later.
// Per product requirements, new users receive 1000 starter tokens.
const NEW_USER_TOKENS = 1000;
const TOKEN_TO_CASH = 0.01; // 100 tokens = $1.00
const FIRST_BET_REWARD_TOKENS = 100;
const FIRST_PARLAY_REWARD_TOKENS = 200;
const XP_PER_BET = 10;
const XP_WIN = 25;
const XP_LOSS = 5;
const XP_VOID = 0;
const POINTS_PER_WIN = 50;
const POINTS_PER_BET = 5;
const POINTS_PER_STREAK_WIN = 20;
const STREAK_THRESHOLDS = [
  { wins: 10, multiplier: 2.0 },
  { wins: 5, multiplier: 1.5 },
  { wins: 3, multiplier: 1.2 }
];

function getStreakMultiplier(wins) {
  const w = Number(wins || 0);
  for (const t of STREAK_THRESHOLDS) {
    if (w >= t.wins) return t.multiplier;
  }
  return 1.0;
}

function getLevelFromXp(xp) {
  const value = Number(xp || 0);
  if (value >= 1500) return 'Platinum';
  if (value >= 750) return 'Gold';
  if (value >= 250) return 'Silver';
  return 'Bronze';
}

function getUtcDateKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getIsoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getDailyTaskState(user, dateKey) {
  const daily = user && user.dailyTasks ? user.dailyTasks : {};
  if (daily.dateKey !== dateKey) {
    return { dateKey, betsPlaced: 0, wins: 0, sports: [], claims: {} };
  }
  return {
    dateKey,
    betsPlaced: Number(daily.betsPlaced || 0),
    wins: Number(daily.wins || 0),
    sports: Array.isArray(daily.sports) ? daily.sports : [],
    claims: daily.claims && typeof daily.claims === 'object' ? daily.claims : {}
  };
}

function getWeeklyTaskState(user, weekKey) {
  const weekly = user && user.weeklyTasks ? user.weeklyTasks : {};
  if (weekly.weekKey !== weekKey) {
    return { weekKey, claims: {} };
  }
  return {
    weekKey,
    claims: weekly.claims && typeof weekly.claims === 'object' ? weekly.claims : {}
  };
}

function computePoints({ xp = 0, stats = {}, streakWins = 0 }) {
  const wins = Number(stats.wins || 0);
  const totalBets = Number(stats.totalBets || 0);
  const streak = Number(streakWins || 0);
  const base = Number(xp || 0);
  return Math.max(0, Math.trunc(base + (wins * POINTS_PER_WIN) + (totalBets * POINTS_PER_BET) + (streak * POINTS_PER_STREAK_WIN)));
}

// Rounding helpers
function roundDecimals(n, precision = 4) {
  if (!isFinite(n)) return NaN;
  const factor = Math.pow(10, precision);
  return Math.round(n * factor) / factor;
}

function roundMoney(n) {
  if (!isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

/**
 * Create a user profile document if it doesn't exist.
 * - uid: string
 * - email: string
 * - profileData: { fullName, dateOfBirth, ageVerified, authProvider }
 */
async function createUserProfile(uid, email, profileData = {}) {
  if (!uid) throw new Error('Missing uid');
  const userRef = firestore.collection('users').doc(uid);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (snap.exists) {
      // Do not overwrite existing profile
      return { created: false, data: snap.data() };
    }
    const now = admin.firestore.Timestamp.now();
    const todayKey = getUtcDateKey();
    const weekKey = getIsoWeekKey();
    const doc = {
      uid,
      email: email || '',
      authProvider: profileData.authProvider || 'password',
      fullName: profileData.fullName || '',
      // Use the canonical field name required by the product
      dateOfBirth: profileData.dateOfBirth || null,
      ageVerified: !!profileData.ageVerified,
      address: profileData.address || null,
      termsAccepted: !!profileData.termsAccepted,
      profileComplete: false,
      createdAt: now,
      lastLogin: now,
      tokenBalance: NEW_USER_TOKENS,
      cashBalance: 0,
      xp: 0,
      level: 'Bronze',
      streakWins: 0,
      bestStreak: 0,
      streakMultiplier: 1,
      points: 0,
      stats: { wins: 0, losses: 0, pending: 0, totalBets: 0, totalParlays: 0 },
      firstBetRewarded: false,
      firstParlayRewarded: false,
      firstBetEligible: false,
      firstParlayEligible: false,
      dailyTasks: { dateKey: todayKey, betsPlaced: 0, wins: 0, sports: [], claims: {} },
      weeklyTasks: { weekKey, claims: {} },
      dailyInsights: { dateKey: todayKey, count: 0 }
    };
    tx.set(userRef, doc);
    return { created: true, data: doc };
  });
}

/**
 * Update lastLogin timestamp for uid
 */
async function updateLastLogin(uid) {
  if (!uid) throw new Error('Missing uid');
  const userRef = firestore.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    // If user doc missing, create a profile with default tokens so new users
    // always receive the starting balance.
    await createUserProfile(uid, '', {});
    const created = await userRef.get();
    return created.exists ? created.data() : null;
  }
  const updates = { lastLogin: admin.firestore.FieldValue.serverTimestamp() };
  const data = snap.data() || {};
  if (typeof data.cashBalance === 'undefined') updates.cashBalance = 0;
  await userRef.update(updates);
  const updated = await userRef.get();
  return updated.exists ? updated.data() : null;
}

/**
 * placeBet(uid, betData)
 * betData: { type: 'single'|'parlay', stake: integer, selections: [{eventId, league, marketType, pick, odds}] }
 */
async function placeBet(uid, betData) {
  if (!uid) throw new Error('Missing uid');
  if (!betData || !Array.isArray(betData.selections) || betData.selections.length === 0) throw new Error('Invalid selections');
  const currency = betData.currency === 'cash' ? 'cash' : 'tokens';
  const stakeRaw = Number(betData.stake);
  if (!Number.isFinite(stakeRaw) || stakeRaw <= 0) throw new Error('Invalid stake');
  const stakeTokens = currency === 'tokens' ? Math.trunc(stakeRaw) : 0;
  const stakeCash = currency === 'cash'
    ? Math.round(stakeRaw * 100) / 100
    : Math.round((stakeTokens * TOKEN_TO_CASH) * 100) / 100;

  const userRef = firestore.collection('users').doc(uid);
  const betsCol = firestore.collection('bets');

  // Precompute combinedOdds and potentialPayout from selections
  const selections = betData.selections.map(s => ({
    eventId: s.eventId,
    league: s.league || null,
    sportKey: s.sportKey || s.sport_key || null,
    commenceTime: s.commenceTime || s.startTime || s.commence_time || null,
    homeTeam: s.homeTeam || s.home_team || null,
    awayTeam: s.awayTeam || s.away_team || null,
    marketType: s.marketType || 'h2h',
    pick: s.pick,
    odds: Number(s.odds)
  }));
  // Validate odds
  for (const s of selections) {
    if (!isFinite(s.odds) || s.odds <= 1.0) throw new Error('Invalid odds on selection');
  }
  let combinedOdds = selections.reduce((p, s) => p * Number(s.odds), 1.0);
  combinedOdds = roundDecimals(combinedOdds);
  const potentialPayout = roundDecimals(stakeCash * combinedOdds);

  // Firestore transaction: deduct stake, increment stats, create bet
  return firestore.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('User not found');
    const user = userSnap.data();
    const currentTokenBalance = Number(user.tokenBalance || 0);
    const currentCashBalance = Number(user.cashBalance || 0);
    if (currency === 'tokens') {
      if (stakeTokens > currentTokenBalance) throw new Error('Insufficient token balance');
    } else {
      if (stakeCash > currentCashBalance) throw new Error('Insufficient cash balance');
    }

    const newTokenBalance = currency === 'tokens'
      ? Math.trunc(currentTokenBalance - stakeTokens)
      : currentTokenBalance;
    const newCashBalance = currency === 'cash'
      ? Math.round((currentCashBalance - stakeCash) * 100) / 100
      : currentCashBalance;

    // Update user stats
    const parlayIntent = Boolean(betData.parlayIntent);
    const parlayLegs = Number(betData.parlayLegs || selections.length || 0);
    const isParlay = parlayIntent
      ? parlayLegs >= 2
      : (betData.type === 'parlay' || (Array.isArray(betData.selections) && betData.selections.length > 1));
    const stats = user.stats || { wins: 0, losses: 0, pending: 0, totalBets: 0, totalParlays: 0 };
    const updatedStats = Object.assign({}, stats, {
      pending: (Number(stats.pending || 0) + 1),
      totalBets: (Number(stats.totalBets || 0) + 1),
      totalParlays: (Number(stats.totalParlays || 0) + (isParlay ? 1 : 0))
    });

    const todayKey = getUtcDateKey();
    const weekKey = getIsoWeekKey();
    const dailyTasks = getDailyTaskState(user, todayKey);
    const weeklyTasks = getWeeklyTaskState(user, weekKey);
    dailyTasks.betsPlaced = Number(dailyTasks.betsPlaced || 0) + 1;
    const sports = new Set(Array.isArray(dailyTasks.sports) ? dailyTasks.sports : []);
    selections.forEach((s) => {
      const label = s.sportKey || s.league || null;
      if (label) sports.add(String(label));
    });
    dailyTasks.sports = Array.from(sports);

    const currentXp = Number(user.xp || 0);
    const nextXp = currentXp + XP_PER_BET;
    const nextLevel = getLevelFromXp(nextXp);
    const nextPoints = computePoints({ xp: nextXp, stats: updatedStats, streakWins: Number(user.streakWins || 0) });

    let rewardTokens = 0;
    const firstBetRewarded = Boolean(user.firstBetRewarded);
    const firstParlayRewarded = Boolean(user.firstParlayRewarded);
    if (!firstBetRewarded && Number(stats.totalBets || 0) === 0) {
      rewardTokens += FIRST_BET_REWARD_TOKENS;
    }
    if (isParlay && !firstParlayRewarded && Number(stats.totalParlays || 0) === 0) {
      rewardTokens += FIRST_PARLAY_REWARD_TOKENS;
    }

    // Prepare bet document
    const betRef = betsCol.doc();
    const betDoc = {
      betId: betRef.id,
      userId: uid,
      type: isParlay ? 'parlay' : 'single',
      stake: currency === 'tokens' ? Math.trunc(stakeTokens) : stakeCash,
      stakeTokens: currency === 'tokens' ? Math.trunc(stakeTokens) : null,
      stakeCash,
      stakeCurrency: currency,
      tokenToCashRate: TOKEN_TO_CASH,
      selections,
      combinedOdds,
      potentialPayout,
      status: 'pending',
      placedAt: admin.firestore.FieldValue.serverTimestamp(),
      settledAt: null
    };

    const nextFirstBetRewarded = firstBetRewarded || rewardTokens >= FIRST_BET_REWARD_TOKENS;
    const nextFirstParlayRewarded = firstParlayRewarded || (isParlay && rewardTokens >= FIRST_PARLAY_REWARD_TOKENS);

    // Apply updates
    tx.set(betRef, betDoc);
    tx.update(userRef, {
      tokenBalance: Math.trunc(newTokenBalance + rewardTokens),
      cashBalance: newCashBalance,
      stats: updatedStats,
      xp: nextXp,
      level: nextLevel,
      points: nextPoints,
      firstBetRewarded: nextFirstBetRewarded,
      firstParlayRewarded: nextFirstParlayRewarded,
      dailyTasks,
      weeklyTasks
    });

    return {
      bet: betDoc,
      rewards: {
        tokens: rewardTokens,
        firstBetRewarded: nextFirstBetRewarded,
        firstParlayRewarded: nextFirstParlayRewarded,
        stats: updatedStats
      },
      balances: {
        tokens: Math.trunc(newTokenBalance + rewardTokens),
        cash: newCashBalance
      }
    };
  });
}

/**
 * settleBet(betId, result)
 * result: { status: 'won'|'lost'|'void' }
 */
async function settleBet(betId, result) {
  if (!betId) throw new Error('Missing betId');
  if (!result || !['won', 'lost', 'void'].includes(result.status)) throw new Error('Invalid result');

  const betRef = firestore.collection('bets').doc(betId);

  return firestore.runTransaction(async (tx) => {
    const betSnap = await tx.get(betRef);
    if (!betSnap.exists) throw new Error('Bet not found');
    const bet = betSnap.data();
    if (!bet || bet.status !== 'pending') throw new Error('Bet already settled or invalid status');

    const userRef = firestore.collection('users').doc(bet.userId);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('User not found');
    const user = userSnap.data();

    let newBalance = Number(user.tokenBalance || 0);
    let newCashBalance = Number(user.cashBalance || 0);
    const stats = user.stats || { wins: 0, losses: 0, pending: 0, totalBets: 0 };
    const currentXp = Number(user.xp || 0);
    let nextXp = currentXp;
    let streakWins = Number(user.streakWins || 0);
    let bestStreak = Number(user.bestStreak || 0);
    let streakMultiplier = Number(user.streakMultiplier || 1);

    if (result.status === 'won') {
      newCashBalance = roundMoney(newCashBalance + Number(bet.potentialPayout || 0));
      stats.wins = Number(stats.wins || 0) + 1;
      nextXp += XP_WIN;
      streakWins += 1;
      if (streakWins > bestStreak) bestStreak = streakWins;
      streakMultiplier = getStreakMultiplier(streakWins);

      const stakeTokens = bet.stakeCurrency === 'cash'
        ? Math.round(Number(bet.stakeCash || 0) / TOKEN_TO_CASH)
        : Math.round(Number(bet.stakeTokens || bet.stake || 0));
      const baseReward = Math.max(10, Math.round(stakeTokens * 0.05));
      const bonusTokens = Math.max(0, Math.round(baseReward * streakMultiplier));
      newBalance = Math.trunc(newBalance + bonusTokens);
    } else if (result.status === 'lost') {
      stats.losses = Number(stats.losses || 0) + 1;
      nextXp += XP_LOSS;
      streakWins = 0;
      streakMultiplier = 1;
      // stake was already deducted at placement
    } else if (result.status === 'void') {
      // refund stake (original currency)
      if (bet.stakeCurrency === 'cash') {
        newCashBalance = roundMoney(newCashBalance + Number(bet.stakeCash || bet.stake || 0));
      } else {
        newBalance = Math.trunc(newBalance + Number(bet.stakeTokens || bet.stake || 0));
      }
      nextXp += XP_VOID;
    }

    // decrement pending (guard against negative)
    stats.pending = Math.max(0, Number(stats.pending || 0) - 1);

    const todayKey = getUtcDateKey();
    const weekKey = getIsoWeekKey();
    const dailyTasks = getDailyTaskState(user, todayKey);
    const weeklyTasks = getWeeklyTaskState(user, weekKey);
    if (result.status === 'won') {
      dailyTasks.wins = Number(dailyTasks.wins || 0) + 1;
    }

    // update bet doc
    tx.update(betRef, { status: result.status, settledAt: admin.firestore.FieldValue.serverTimestamp() });

    // update user doc
    const nextPoints = computePoints({ xp: nextXp, stats, streakWins });

    tx.update(userRef, {
      tokenBalance: newBalance,
      cashBalance: newCashBalance,
      stats,
      xp: nextXp,
      level: getLevelFromXp(nextXp),
      streakWins,
      bestStreak,
      streakMultiplier,
      points: nextPoints,
      dailyTasks,
      weeklyTasks
    });

    return { betId, status: result.status, newBalance, newCashBalance, stats };
  });
}

/** Query helpers **/
async function getUserProfile(uid) {
  if (!uid) throw new Error('Missing uid');
  const snap = await firestore.collection('users').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function getUserBets(uid) {
  if (!uid) throw new Error('Missing uid');
  const [byUserId, byUid] = await Promise.all([
    firestore.collection('bets').where('userId', '==', uid).get(),
    firestore.collection('bets').where('uid', '==', uid).get()
  ]);
  const bets = [];
  const seen = new Set();
  const pushBet = (doc) => {
    const data = doc.data();
    const key = data && (data.betId || doc.id);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    bets.push(data);
  };
  byUserId.forEach(pushBet);
  byUid.forEach(pushBet);
  const toMillis = (ts) => {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
    return 0;
  };
  bets.sort((a, b) => toMillis(b.placedAt) - toMillis(a.placedAt));
  return bets;
}

async function getUserStats(uid) {
  const profile = await getUserProfile(uid);
  return profile ? (profile.stats || { wins: 0, losses: 0, pending: 0, totalBets: 0 }) : null;
}

/**
 * Credit tokens to a user's balance (transactional).
 * Returns the updated user document data.
 */
async function creditTokens(uid, amount) {
  if (!uid) throw new Error('Missing uid');
  const delta = Number(amount) || 0;
  if (!Number.isFinite(delta) || delta <= 0) throw new Error('Invalid amount');
  const userRef = firestore.collection('users').doc(uid);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error('User not found');
    const user = snap.data();
    const current = Number(user.tokenBalance || 0);
    const updated = Math.trunc(current + delta);
    tx.update(userRef, { tokenBalance: updated });
    return Object.assign({}, user, { tokenBalance: updated });
  });
}

/**
 * Credit cash to a user's balance (transactional).
 * Returns the updated user document data.
 */
async function creditCash(uid, amount) {
  if (!uid) throw new Error('Missing uid');
  const delta = Number(amount) || 0;
  if (!Number.isFinite(delta) || delta <= 0) throw new Error('Invalid amount');
  const userRef = firestore.collection('users').doc(uid);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error('User not found');
    const user = snap.data();
    const current = Number(user.cashBalance || 0);
    const updated = Math.round((current + delta) * 100) / 100;
    tx.update(userRef, { cashBalance: updated });
    return Object.assign({}, user, { cashBalance: updated });
  });
}

const SPIN_TIMEZONE = process.env.SPIN_TIMEZONE || 'America/Toronto';

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  return parts.reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
}

function getDateKeyForZone(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getOffsetMinutes(timeZone, date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const tz = (parts.find((p) => p.type === 'timeZoneName') || {}).value || '';
  const match = tz.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;
  const rawHours = Number(match[1]);
  const sign = rawHours < 0 ? -1 : 1;
  const hours = Math.abs(rawHours);
  const mins = Number(match[2] || 0);
  return sign * (hours * 60 + mins);
}

function getNoonUtcMs(year, month, day, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetMinutes = getOffsetMinutes(timeZone, guess);
  return Date.UTC(year, month - 1, day, 12, 0, 0) - (offsetMinutes * 60 * 1000);
}

function getLastNoonUtcMs(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const todayNoonUtcMs = getNoonUtcMs(year, month, day, timeZone);
  if (date.getTime() >= todayNoonUtcMs) return todayNoonUtcMs;
  const yesterday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return getNoonUtcMs(yesterday.getUTCFullYear(), yesterday.getUTCMonth() + 1, yesterday.getUTCDate(), timeZone);
}

function getNextNoonIso(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (hour >= 12) base.setUTCDate(base.getUTCDate() + 1);
  const targetYear = base.getUTCFullYear();
  const targetMonth = base.getUTCMonth() + 1;
  const targetDay = base.getUTCDate();
  const utcMs = getNoonUtcMs(targetYear, targetMonth, targetDay, timeZone);
  return new Date(utcMs).toISOString();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  return 0;
}

function pickReward(options) {
  if (!Array.isArray(options) || !options.length) return 0;
  const idx = Math.floor(Math.random() * options.length);
  return options[idx];
}

/**
 * Claim a daily spin reward (once per day after 12:00 PM server time).
 * Returns the updated token balance and reward.
 */
async function claimDailySpin(uid) {
  if (!uid) throw new Error('Missing uid');
  const now = new Date();
  const todayKey = getDateKeyForZone(now, SPIN_TIMEZONE);
  const rewards = [100, 100, 100, 250, 250, 50, 500];

  const userRef = firestore.collection('users').doc(uid);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error('User not found');
    const user = snap.data() || {};
    const lastSpinMs = toMillis(user.dailySpinAt);
    const lastNoonMs = getLastNoonUtcMs(now, SPIN_TIMEZONE);
    if (lastSpinMs && lastSpinMs >= lastNoonMs) {
      const err = new Error('Spin already claimed');
      err.code = 'SPIN_ALREADY_CLAIMED';
      err.nextAvailableAt = getNextNoonIso(now, SPIN_TIMEZONE);
      throw err;
    }

    const reward = pickReward(rewards);
    const current = Number(user.tokenBalance || 0);
    const updated = Math.trunc(current + reward);
    tx.update(userRef, {
      tokenBalance: updated,
      dailySpinDate: todayKey,
      dailySpinReward: reward,
      dailySpinAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { tokenBalance: updated, reward, spinDate: todayKey, nextAvailableAt: getNextNoonIso(now, SPIN_TIMEZONE) };
  });
}

/**
 * Claim task rewards (first-bet, first-parlay) once eligible.
 */
async function claimTaskReward(uid, taskKey) {
  if (!uid) throw new Error('Missing uid');
  const task = String(taskKey || '').toLowerCase();
  const taskConfig = {
    'first-bet': {
      reward: FIRST_BET_REWARD_TOKENS,
      flag: 'firstBetRewarded',
      statKey: 'totalBets'
    },
    'first-parlay': {
      reward: FIRST_PARLAY_REWARD_TOKENS,
      flag: 'firstParlayRewarded',
      statKey: 'totalParlays'
    }
  };
  const config = taskConfig[task];
  if (!config) throw new Error('Invalid task');

  let hasAnyBet = false;
  let hasParlayBet = false;
  const betsSnap = await firestore.collection('bets')
    .where('userId', '==', uid)
    .limit(1)
    .get();
  hasAnyBet = !betsSnap.empty;
  if (task === 'first-parlay') {
    const parlaySnap = await firestore.collection('bets')
      .where('userId', '==', uid)
      .where('type', '==', 'parlay')
      .limit(1)
      .get();
    hasParlayBet = !parlaySnap.empty;
  }

  const userRef = firestore.collection('users').doc(uid);
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new Error('User not found');
    const user = snap.data() || {};
    const stats = user.stats || { wins: 0, losses: 0, pending: 0, totalBets: 0, totalParlays: 0 };
    const alreadyClaimed = Boolean(user[config.flag]);
    const eligibleFlag = Boolean(user[task === 'first-bet' ? 'firstBetEligible' : 'firstParlayEligible']);
    const eligibleFromStats = Number(stats[config.statKey] || 0) > 0;
    const eligibleFromBets = task === 'first-parlay' ? hasParlayBet : hasAnyBet;
    const eligible = eligibleFlag || eligibleFromStats || eligibleFromBets;

    const currentTokens = Math.trunc(Number(user.tokenBalance || 0));
    const currentCash = Math.round(Number(user.cashBalance || 0) * 100) / 100;
    if (alreadyClaimed) {
      return {
        awarded: false,
        reason: 'already-claimed',
        reward: 0,
        balances: { tokens: currentTokens, cash: currentCash },
        stats,
        firstBetRewarded: !!user.firstBetRewarded,
        firstParlayRewarded: !!user.firstParlayRewarded
      };
    }
    if (!eligible) {
      return {
        awarded: false,
        reason: 'not-eligible',
        reward: 0,
        balances: { tokens: currentTokens, cash: currentCash },
        stats,
        firstBetRewarded: !!user.firstBetRewarded,
        firstParlayRewarded: !!user.firstParlayRewarded
      };
    }

    const nextTokens = Math.trunc(currentTokens + config.reward);
    tx.update(userRef, {
      tokenBalance: nextTokens,
      [config.flag]: true
    });

    return {
      awarded: true,
      reward: config.reward,
      balances: { tokens: nextTokens, cash: currentCash },
      stats,
      firstBetRewarded: task === 'first-bet' ? true : !!user.firstBetRewarded,
      firstParlayRewarded: task === 'first-parlay' ? true : !!user.firstParlayRewarded
    };
  });
}

module.exports = {
  createUserProfile,
  updateLastLogin,
  placeBet,
  settleBet,
  getUserProfile,
  getUserBets,
  getUserStats,
  creditTokens,
  claimDailySpin,
  claimTaskReward
};

// Update user profile fields (partial update). Returns the updated document data.
async function updateUserProfile(uid, fields) {
  if (!uid) throw new Error('Missing uid');
  const userRef = firestore.collection('users').doc(uid);
  await userRef.set(fields, { merge: true });
  const snap = await userRef.get();
  return snap.exists ? snap.data() : null;
}

// append the new method to exports for server usage
module.exports.updateUserProfile = updateUserProfile;
module.exports.creditCash = creditCash;

