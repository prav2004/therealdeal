/**
 * betting.js
 * Core betting logic for Pickr (server-side, pure functions).
 *
 * Responsibilities:
 * - validateBet: strict validation according to rules
 * - calculateParlayOdds: deterministic combined odds
 * - placeBet: perform placement flow against a user object (pure, returns updated objects)
 * - settleBet: settle a placed bet given results
 *
 * This module does not perform any I/O. It operates on plain objects so
 * it can be used in unit tests and easily integrated into persistence
 * layers (Firestore, SQL, etc.). All math uses fixed decimal rounding
 * to 4 decimal places to avoid floating point drift for odds calculation.
 */

const DEFAULT_MAX_PARLAY_LEGS = 10;
const DECIMAL_PRECISION = 4; // odds rounding precision

function nowTs() { return new Date().toISOString(); }

function roundDecimals(n, precision = DECIMAL_PRECISION) {
  if (!isFinite(n)) return NaN;
  const factor = Math.pow(10, precision);
  return Math.round(n * factor) / factor;
}

function roundMoney(n) {
  if (!isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

function calculateParlayOdds(selections) {
  if (!Array.isArray(selections) || selections.length === 0) return NaN;
  // multiply all odds, rounding at the end for determinism
  let product = 1.0;
  for (const s of selections) {
    const o = Number(s.odds);
    if (!isFinite(o)) return NaN;
    product = product * o;
  }
  return roundDecimals(product);
}

function validateSelectionShape(sel) {
  if (!sel || typeof sel !== 'object') return 'Invalid selection object';
  if (!sel.eventId) return 'Selection missing eventId';
  if (!sel.marketType) return 'Selection missing marketType';
  if (!sel.selection) return 'Selection missing selection';
  if (typeof sel.odds === 'undefined' || sel.odds === null) return 'Selection missing odds';
  const odds = Number(sel.odds);
  if (!isFinite(odds) || odds <= 1.0) return 'Selection odds must be > 1.0';
  return null;
}

/**
 * validateBet(user, selections, stake, type, opts)
 * - user: { id, tokenBalance, bets: [...] } (bets array optional)
 * - selections: array of selection objects
 * - stake: integer number of tokens
 * - type: 'single' | 'parlay'
 * - opts: { maxParlayLegs, eventsMap, existingBets }
 *    - eventsMap: optional map eventId -> event object (for startTime validation)
 *    - existingBets: optional array of user's existing bets to check duplicates
 */
function validateBet(user, selections, stake, type = 'single', opts = {}) {
  const errors = [];
  const maxParlay = opts.maxParlayLegs || DEFAULT_MAX_PARLAY_LEGS;

  if (!user || typeof user !== 'object') errors.push('Invalid user');
  if (!Number.isInteger(stake) || stake <= 0) errors.push('Stake must be a positive integer');
  if (!Array.isArray(selections) || selections.length === 0) errors.push('Selections cannot be empty');
  if (type !== 'single' && type !== 'parlay') errors.push('Invalid bet type');

  // user balance
  const balance = Number(user.tokenBalance || 0);
  if (stake > balance) errors.push('Insufficient token balance');

  // validate each selection shape and odds
  for (const sel of selections) {
    const e = validateSelectionShape(sel);
    if (e) errors.push(e);
    if (sel.odds <= 1.0) errors.push('Odds must be greater than 1.0');
  }

  // type-specific rules
  if (type === 'single') {
    if (selections.length !== 1) errors.push('Single bet must have exactly one selection');
  }
  if (type === 'parlay') {
    if (selections.length < 2) errors.push('Parlay must have at least two selections');
    if (selections.length > maxParlay) errors.push(`Parlay cannot exceed ${maxParlay} legs`);
    // check duplicate eventIds and duplicate team/market
    const seenEvents = new Set();
    const seenSelKeys = new Set();
    for (const s of selections) {
      if (seenEvents.has(s.eventId)) errors.push('Parlay contains multiple selections from the same event');
      seenEvents.add(s.eventId);
      const key = `${s.eventId}::${s.marketType}::${String(s.selection)}`;
      if (seenSelKeys.has(key)) errors.push('Parlay contains duplicate selection (same event/market/choice)');
      seenSelKeys.add(key);
    }
  }

  // event time validation (must be future)
  const eventsMap = opts.eventsMap || {};
  const now = Date.now();
  for (const s of selections) {
    const ev = eventsMap[s.eventId];
    if (ev && ev.startTime) {
      const start = new Date(ev.startTime).getTime();
      if (!isFinite(start) || start <= now) errors.push(`Event ${s.eventId} has already started`);
    }
  }

  // prevent duplicate exact selection across existing pending bets if provided
  if (Array.isArray(opts.existingBets)) {
    for (const existing of opts.existingBets) {
      if (!existing.selections || !Array.isArray(existing.selections)) continue;
      if (existing.status && existing.status !== 'pending') continue; // only compare active pending bets
      for (const s of selections) {
        for (const eSel of existing.selections) {
          if (eSel.eventId === s.eventId && eSel.marketType === s.marketType && String(eSel.selection) === String(s.selection)) {
            errors.push('User already has an identical pending selection');
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * placeBet(user, selections, stake, type, opts)
 * - returns { bet, user } on success or throws Error with message(s)
 */
function placeBet(user, selections, stake, type = 'single', opts = {}) {
  const validation = validateBet(user, selections, stake, type, opts);
  if (!validation.valid) {
    const msg = validation.errors.join('; ');
    const err = new Error('Bet validation failed: ' + msg);
    err.details = validation.errors;
    throw err;
  }

  // compute combined odds
  let combinedOdds = 1.0;
  if (type === 'single') combinedOdds = Number(selections[0].odds);
  else combinedOdds = calculateParlayOdds(selections);
  combinedOdds = roundDecimals(combinedOdds);

  // potential payout
  const potentialPayout = roundDecimals(stake * combinedOdds);

  // deduct stake (ensure integer and never negative)
  const current = Number(user.tokenBalance || 0);
  const newBalance = Math.max(0, Math.trunc(current - stake));
  if (newBalance < 0) {
    throw new Error('Insufficient balance after re-check');
  }

  // build bet object (immutable after placement)
  const bet = {
    betId: `bet_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    userId: user.id,
    type,
    stake: Math.trunc(stake),
    selections: selections.map(s => ({ eventId: s.eventId, marketType: s.marketType, selection: s.selection, odds: roundDecimals(Number(s.odds)) })),
    combinedOdds,
    potentialPayout,
    status: 'pending',
    placedAt: nowTs()
  };

  // persist to user object (caller is responsible for DB persistence)
  user.tokenBalance = newBalance;
  if (!Array.isArray(user.bets)) user.bets = [];
  user.bets.push(bet);

  return { bet, user };
}

/**
 * settleBet(bet, settlementResults, opts)
 * - bet: bet object produced by placeBet
 * - settlementResults: array of { eventId, marketType, selection, outcome }
 *    outcome: 'win' | 'lose' | 'void'
 * - opts: { user } optional user object to credit balances. If provided, user.tokenBalance and user.cashBalance may be updated and user.bets updated.
 * Returns updated { bet, user } (user may be null if not provided)
 */
function settleBet(bet, settlementResults, opts = {}) {
  if (!bet || !Array.isArray(bet.selections)) throw new Error('Invalid bet');
  if (bet.status && bet.status !== 'pending') throw new Error('Bet already settled');
  const resultsMap = new Map();
  for (const r of settlementResults || []) {
    const key = `${r.eventId}::${r.marketType}::${String(r.selection)}`;
    resultsMap.set(key, r.outcome);
  }

  // determine each leg outcome
  const legOutcomes = bet.selections.map(sel => {
    const key = `${sel.eventId}::${sel.marketType}::${String(sel.selection)}`;
    const o = resultsMap.get(key);
    return { sel, outcome: o || 'pending' };
  });

  // If any lost -> whole parlay lost (or single lost)
  const anyLost = legOutcomes.some(l => l.outcome === 'lose');
  const anyPending = legOutcomes.some(l => l.outcome === 'pending');
  const anyVoid = legOutcomes.some(l => l.outcome === 'void');

  let updatedBet = Object.assign({}, bet);

  if (bet.type === 'single') {
    const leg = legOutcomes[0];
    if (leg.outcome === 'win') {
      updatedBet.status = 'won';
      // credit payout
      if (opts.user) {
        const currentCash = Number(opts.user.cashBalance || opts.user.cash || 0);
        opts.user.cashBalance = roundMoney(currentCash + roundDecimals(updatedBet.potentialPayout));
      }
    } else if (leg.outcome === 'lose') {
      updatedBet.status = 'lost';
      // stake already deducted at placement
    } else if (leg.outcome === 'void') {
      updatedBet.status = 'void';
      // refund stake
      if (opts.user) {
        opts.user.tokenBalance = Math.trunc(Number(opts.user.tokenBalance || 0) + Math.trunc(updatedBet.stake));
      }
    } else {
      // still pending
      updatedBet.status = 'pending';
    }
  } else {
    // parlay
    if (anyLost) {
      updatedBet.status = 'lost';
    } else {
      // no losses among legs
      const voidLegs = legOutcomes.filter(l => l.outcome === 'void');
      const activeLegs = legOutcomes.filter(l => l.outcome === 'win' || l.outcome === 'pending');
      if (voidLegs.length > 0 && activeLegs.length === 0) {
        // all legs voided -> refund stake
        updatedBet.status = 'void';
        if (opts.user) opts.user.tokenBalance = Math.trunc(Number(opts.user.tokenBalance || 0) + Math.trunc(updatedBet.stake));
      } else if (!anyPending && activeLegs.length > 0 && voidLegs.length === 0) {
        // all legs won
        updatedBet.status = 'won';
        if (opts.user) {
          const currentCash = Number(opts.user.cashBalance || opts.user.cash || 0);
          opts.user.cashBalance = roundMoney(currentCash + roundDecimals(updatedBet.potentialPayout));
        }
      } else if (!anyPending && voidLegs.length > 0 && activeLegs.length > 0) {
        // some voids, none lost, none pending: recompute odds removing voids
        const remainingSelections = bet.selections.filter(s => {
          const key = `${s.eventId}::${s.marketType}::${String(s.selection)}`;
          return resultsMap.get(key) !== 'void';
        });
        if (remainingSelections.length === 0) {
          updatedBet.status = 'void';
          if (opts.user) opts.user.tokenBalance = Math.trunc(Number(opts.user.tokenBalance || 0) + Math.trunc(updatedBet.stake));
        } else if (remainingSelections.length === 1) {
          // becomes a single
          const newOdds = roundDecimals(Number(remainingSelections[0].odds));
          const payout = roundDecimals(updatedBet.stake * newOdds);
          updatedBet.status = 'won';
          if (opts.user) {
            const currentCash = Number(opts.user.cashBalance || opts.user.cash || 0);
            opts.user.cashBalance = roundMoney(currentCash + payout);
          }
        } else {
          // recompute combinedOdds and payout
          const newOdds = calculateParlayOdds(remainingSelections);
          const payout = roundDecimals(updatedBet.stake * newOdds);
          updatedBet.status = 'won';
          if (opts.user) {
            const currentCash = Number(opts.user.cashBalance || opts.user.cash || 0);
            opts.user.cashBalance = roundMoney(currentCash + payout);
          }
        }
      } else {
        // still waiting for results
        updatedBet.status = 'pending';
      }
    }
  }

  // update bet status in user.bets if provided
  if (opts.user && Array.isArray(opts.user.bets)) {
    opts.user.bets = opts.user.bets.map(b => (b.betId === updatedBet.betId ? Object.assign({}, b, { status: updatedBet.status }) : b));
  }

  return { bet: updatedBet, user: opts.user };
}

module.exports = {
  calculateParlayOdds,
  validateBet,
  placeBet,
  settleBet,
  roundDecimals
};
