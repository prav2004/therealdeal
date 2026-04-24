const admin = require('firebase-admin');

// Ensure tests run against the emulator. Developer must start Firestore emulator
// separately. If FIRESTORE_EMULATOR_HOST is not set, tests will attempt to
// use localhost:8080 which is the default emulator port.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';

// Initialize admin for tests with a projectId
try {
  admin.initializeApp({ projectId: 'pickr-test' });
} catch (e) {
  // ignore duplicate init in some runners
}

const firestore = admin.firestore();
const path = require('path');
const firestoreBets = require(path.resolve(__dirname, '..', '..', 'server', 'firestore_bets'));

// Utility to generate unique UIDs per test
// Increase default jest timeout for emulator interactions
jest.setTimeout(30000);

function uid(prefix = 'test') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

afterAll(async () => {
  // Nothing specific to tear down here; emulator will be stopped by developer
});

beforeAll(async () => {
  // Quick sanity check that the emulator appears reachable. This will
  // throw quickly if there is no emulator running on the host/port.
  try {
    await firestore.listCollections();
  } catch (err) {
    console.error('Firestore emulator not reachable. Start the emulator on localhost:8080 and re-run tests.');
    throw err;
  }
});

test('createUserProfile seeds new user with tokens and cash', async () => {
  const u = uid('create');
  const r = await firestoreBets.createUserProfile(u, `${u}@example.com`, { fullName: 'Test User' });
  expect(r.created).toBe(true);
  const profile = await firestoreBets.getUserProfile(u);
  expect(profile).not.toBeNull();
  expect(profile.tokenBalance).toBe(1000);
  expect(profile.cashBalance).toBe(0);
  expect(profile.stats).toEqual({ wins: 0, losses: 0, pending: 0, totalBets: 0 });
});

test('placeBet deducts stake and creates bet doc', async () => {
  const u = uid('place');
  await firestoreBets.createUserProfile(u, `${u}@example.com`, { fullName: 'Better' });
  const betData = {
    type: 'single',
    stake: 100,
    selections: [ { eventId: 'e1', league: 'nba', marketType: 'h2h', pick: 'home', odds: 1.5 } ]
  };
  const bet = await firestoreBets.placeBet(u, betData);
  expect(bet).toHaveProperty('betId');
  expect(bet.stake).toBe(100);
  // Verify user balance reduced
  const profile = await firestoreBets.getUserProfile(u);
  expect(profile.tokenBalance).toBe(900); // 1000 - 100
  // Bet doc exists in collection
  const snap = await firestore.collection('bets').doc(bet.betId).get();
  expect(snap.exists).toBe(true);
});

test('settleBet won credits payout to cash and updates stats', async () => {
  const u = uid('settle');
  await firestoreBets.createUserProfile(u, `${u}@example.com`, { fullName: 'Winner' });
  const betData = {
    type: 'single',
    stake: 50,
    selections: [ { eventId: 'e2', league: 'nba', marketType: 'h2h', pick: 'away', odds: 2.0 } ]
  };
  const bet = await firestoreBets.placeBet(u, betData);
  // At this point user balance should be 1000 - 50 = 950
  let profile = await firestoreBets.getUserProfile(u);
  expect(profile.tokenBalance).toBe(950);
  expect(profile.cashBalance).toBe(0);

  // Now settle as 'won'
  const res = await firestoreBets.settleBet(bet.betId, { status: 'won' });
  expect(res.status).toBe('won');
  // Payout = (50 tokens -> $0.50) * 2.0 = $1.00
  profile = await firestoreBets.getUserProfile(u);
  expect(profile.tokenBalance).toBe(950);
  expect(profile.cashBalance).toBe(1);
  expect(profile.stats.wins).toBe(1);
});

test('placeBet and settleBet for cash stakes credit cash only', async () => {
  const u = uid('cash');
  await firestoreBets.createUserProfile(u, `${u}@example.com`, { fullName: 'Cash Better' });
  // Seed cash for the test user
  await firestoreBets.updateUserProfile(u, { cashBalance: 10 });
  const betData = {
    type: 'single',
    currency: 'cash',
    stake: 5,
    selections: [ { eventId: 'e3', league: 'nba', marketType: 'h2h', pick: 'home', odds: 3.0 } ]
  };
  const bet = await firestoreBets.placeBet(u, betData);
  let profile = await firestoreBets.getUserProfile(u);
  expect(profile.cashBalance).toBe(5);
  // Settle as won: payout = $5 * 3.0 = $15
  await firestoreBets.settleBet(bet.betId, { status: 'won' });
  profile = await firestoreBets.getUserProfile(u);
  expect(profile.cashBalance).toBe(20);
});
