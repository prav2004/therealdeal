const admin = require('firebase-admin');
const firestore = admin.firestore();

// Seed amount for new users. Centralized so it's easy to change later.
// Per product requirements, new users receive 1000 starter tokens.
const NEW_USER_TOKENS = 1000;

// Rounding helpers
function roundDecimals(n, precision = 4) {
  if (!isFinite(n)) return NaN;
  const factor = Math.pow(10, precision);
  return Math.round(n * factor) / factor;
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
      stats: { wins: 0, losses: 0, pending: 0, totalBets: 0 }
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
  await userRef.update({ lastLogin: admin.firestore.FieldValue.serverTimestamp() });
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
  const stake = parseInt(betData.stake, 10);
  if (!Number.isInteger(stake) || stake <= 0) throw new Error('Invalid stake');

  const userRef = firestore.collection('users').doc(uid);
  const betsCol = firestore.collection('bets');

  // Precompute combinedOdds and potentialPayout from selections
  const selections = betData.selections.map(s => ({
    eventId: s.eventId,
    league: s.league || null,
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
  const potentialPayout = roundDecimals(stake * combinedOdds);

  // Firestore transaction: deduct stake, increment stats, create bet
  return firestore.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('User not found');
    const user = userSnap.data();
    const currentBalance = Number(user.tokenBalance || 0);
    if (stake > currentBalance) throw new Error('Insufficient token balance');

    const newBalance = Math.trunc(currentBalance - stake);

    // Update user stats
    const stats = user.stats || { wins: 0, losses: 0, pending: 0, totalBets: 0 };
    const updatedStats = Object.assign({}, stats, {
      pending: (Number(stats.pending || 0) + 1),
      totalBets: (Number(stats.totalBets || 0) + 1)
    });

    // Prepare bet document
    const betRef = betsCol.doc();
    const betDoc = {
      betId: betRef.id,
      userId: uid,
      type: betData.type === 'parlay' ? 'parlay' : 'single',
      stake: Math.trunc(stake),
      selections,
      combinedOdds,
      potentialPayout,
      status: 'pending',
      placedAt: admin.firestore.FieldValue.serverTimestamp(),
      settledAt: null
    };

    // Apply updates
    tx.set(betRef, betDoc);
    tx.update(userRef, { tokenBalance: newBalance, stats: updatedStats });

    return betDoc;
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
    const stats = user.stats || { wins: 0, losses: 0, pending: 0, totalBets: 0 };

    if (result.status === 'won') {
      newBalance = Math.trunc(newBalance + Number(bet.potentialPayout || 0));
      stats.wins = Number(stats.wins || 0) + 1;
    } else if (result.status === 'lost') {
      stats.losses = Number(stats.losses || 0) + 1;
      // stake was already deducted at placement
    } else if (result.status === 'void') {
      // refund stake
      newBalance = Math.trunc(newBalance + Number(bet.stake || 0));
    }

    // decrement pending (guard against negative)
    stats.pending = Math.max(0, Number(stats.pending || 0) - 1);

    // update bet doc
    tx.update(betRef, { status: result.status, settledAt: admin.firestore.FieldValue.serverTimestamp() });

    // update user doc
    tx.update(userRef, { tokenBalance: newBalance, stats });

    return { betId, status: result.status, newBalance, stats };
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

module.exports = {
  createUserProfile,
  updateLastLogin,
  placeBet,
  settleBet,
  getUserProfile,
  getUserBets,
  getUserStats,
  creditTokens
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

