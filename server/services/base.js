/**
 * Base Sport Service
 * ------------------
 * Shared helpers used by every sport-specific service.
 * Wraps The Odds API calls, caching, and odds extraction so each
 * sport service stays lean.
 *
 * The Odds API v4 docs: https://the-odds-api.com/liveapi/guides/v4/
 */

const axios = require('axios');
const { cache, DEFAULT_TTL } = require('./cache');

// ─── Config ───────────────────────────────────────────────────────────────────
const ODDS_API_KEY  = process.env.ODDS_API_KEY || '0254dcc218e487f9523bf40edda8640f';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// ─── Utility ──────────────────────────────────────────────────────────────────

function normalizeTeamKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getUtcDateKey(d) {
  return d.toISOString().slice(0, 10);
}

// ─── The Odds API wrapper ─────────────────────────────────────────────────────

/**
 * Fetch upcoming odds for a given sport key from The Odds API.
 * @param {string} sportKey  e.g. 'basketball_nba', 'americanfootball_nfl'
 * @param {string} markets   comma-separated market keys (default: 'h2h,spreads,totals')
 * @param {number} ttlMs     cache TTL in milliseconds
 * @returns {Array} array of event objects from The Odds API
 */
async function fetchOddsApi(sportKey, markets, ttlMs) {
  if (!ODDS_API_KEY) throw new Error('ODDS_API_KEY not configured');
  markets = markets || 'h2h,spreads,totals';

  const cacheKey = `oddsapi:${sportKey}:${markets}`;
  if (ttlMs) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds`;
  const resp = await axios.get(url, {
    params: {
      apiKey: ODDS_API_KEY,
      regions: 'us',
      markets: markets,
      oddsFormat: 'decimal',
      dateFormat: 'iso'
    },
    timeout: 15000
  });

  const payload = Array.isArray(resp.data) ? resp.data : [];
  if (ttlMs) cache.set(cacheKey, payload, ttlMs);
  return payload;
}

// ─── Best-odds extraction from bookmakers ─────────────────────────────────────

/**
 * Extract the best (highest) odds across all bookmakers for an event.
 * Returns the canonical { moneyline, spread, totals } shape used by Game model.
 */
function extractBestOdds(event) {
  const bookmakers = event.bookmakers || [];

  let bestML = { home: null, away: null, draw: null };
  let bestSpread = { points: null, home: null, away: null, homePayout: null, awayPayout: null };
  let bestTotals = { points: null, over: null, under: null };

  for (const book of bookmakers) {
    for (const market of (book.markets || [])) {
      if (market.key === 'h2h') {
        for (const o of (market.outcomes || [])) {
          if (o.name === event.home_team) {
            if (!bestML.home || o.price > bestML.home) bestML.home = o.price;
          } else if (o.name === event.away_team) {
            if (!bestML.away || o.price > bestML.away) bestML.away = o.price;
          } else {
            // Draw / Tie
            if (!bestML.draw || o.price > bestML.draw) bestML.draw = o.price;
          }
        }
      } else if (market.key === 'spreads') {
        for (const o of (market.outcomes || [])) {
          if (o.name === event.home_team) {
            if (!bestSpread.homePayout || o.price > bestSpread.homePayout) {
              bestSpread.home = o.point;
              bestSpread.homePayout = o.price;
              bestSpread.points = Math.abs(o.point);
            }
          } else if (o.name === event.away_team) {
            if (!bestSpread.awayPayout || o.price > bestSpread.awayPayout) {
              bestSpread.away = o.point;
              bestSpread.awayPayout = o.price;
            }
          }
        }
      } else if (market.key === 'totals') {
        for (const o of (market.outcomes || [])) {
          if (o.name === 'Over') {
            if (!bestTotals.over || o.price > bestTotals.over) {
              bestTotals.over = o.price;
              bestTotals.points = o.point;
            }
          } else if (o.name === 'Under') {
            if (!bestTotals.under || o.price > bestTotals.under) {
              bestTotals.under = o.price;
            }
          }
        }
      }
    }
  }

  const r = (v) => v != null ? Number(Number(v).toFixed(2)) : null;

  return {
    moneyline: { home: r(bestML.home), away: r(bestML.away), draw: r(bestML.draw) },
    spread: {
      points: r(bestSpread.points),
      home: r(bestSpread.home),
      away: r(bestSpread.away),
      homePayout: r(bestSpread.homePayout),
      awayPayout: r(bestSpread.awayPayout)
    },
    totals: {
      points: r(bestTotals.points),
      over: r(bestTotals.over),
      under: r(bestTotals.under)
    }
  };
}

// ─── ESPN enrichment ──────────────────────────────────────────────────────────

// Map from Pickr sport key → ESPN slug/league for scoreboard API
const ESPN_ENRICHMENT_MAP = {
  nba:    { slug: 'basketball', league: 'nba' },
  nfl:    { slug: 'football',   league: 'nfl' },
  nhl:    { slug: 'hockey',     league: 'nhl' },
  mlb:    { slug: 'baseball',   league: 'mlb' },
  // Soccer leagues mapped individually by the soccer service
  soccer_epl:                  { slug: 'soccer', league: 'eng.1' },
  soccer_spain_la_liga:        { slug: 'soccer', league: 'esp.1' },
  soccer_germany_bundesliga:   { slug: 'soccer', league: 'ger.1' },
  soccer_italy_serie_a:        { slug: 'soccer', league: 'ita.1' },
  soccer_uefa_champs_league:   { slug: 'soccer', league: 'uefa.champions' },
  soccer_usa_mls:              { slug: 'soccer', league: 'usa.1' },
  soccer_france_ligue_one:     { slug: 'soccer', league: 'fra.1' },
  soccer_mexico_ligamx:        { slug: 'soccer', league: 'mex.1' },
  soccer_fifa_world_cup:       { slug: 'soccer', league: 'fifa.world' }
};

function fuzzyMatch(a, b) {
  if (!a || !b) return false;
  const na = String(a).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const nb = String(b).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const aw = na.split(/\s+/); const bw = nb.split(/\s+/);
  const al = aw[aw.length - 1]; const bl = bw[bw.length - 1];
  if (al.length >= 3 && al === bl) return true;
  return false;
}

/**
 * Fetch ESPN scoreboard for a sport/league and return raw events.
 * Caches for 5 minutes.
 */
async function fetchEspnEnrichment(slug, league) {
  const cacheKey = `espn_enrich:${slug}:${league}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/${league}/scoreboard?dates=${dateStr}`;
    const resp = await axios.get(url, { timeout: 12000 });
    const events = (resp.data && resp.data.events) || [];
    cache.set(cacheKey, events, 5 * 60 * 1000); // 5 min cache
    return events;
  } catch (err) {
    console.warn(`ESPN enrichment failed ${slug}/${league}:`, err && err.message);
    return [];
  }
}

/**
 * Fetch recent form (last ~10 days of scoreboard) for a sport/league.
 * Returns Map<normalizedTeamName, ['W','L','W',...]>  (most recent first, up to 10)
 */
async function fetchRecentForm(slug, league) {
  const cacheKey = `espn_form:${slug}:${league}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const allEvents = [];
    const seen = new Set();
    const today = new Date();
    const dateFetches = [];
    // Fetch last 10 days
    for (let d = 1; d <= 10; d++) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - d);
      const ds = dt.toISOString().slice(0, 10).replace(/-/g, '');
      dateFetches.push(
        axios.get(`https://site.api.espn.com/apis/site/v2/sports/${slug}/${league}/scoreboard?dates=${ds}`, { timeout: 10000 })
          .then(r => (r.data && r.data.events) || [])
          .catch(() => [])
      );
    }
    const results = await Promise.allSettled(dateFetches);
    results.forEach(r => {
      if (r.status === 'fulfilled') {
        (r.value || []).forEach(ev => {
          if (ev && ev.id && !seen.has(ev.id)) { seen.add(ev.id); allEvents.push(ev); }
        });
      }
    });

    // Build form map
    const formMap = new Map();
    // Sort events newest first by date
    allEvents.sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const ev of allEvents) {
      const comp = ev.competitions && ev.competitions[0];
      if (!comp) continue;
      const statusType = (comp.status && comp.status.type) || {};
      if (statusType.state !== 'post') continue;
      const competitors = comp.competitors || [];
      const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
      const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
      const homeScore = Number(home.score || 0);
      const awayScore = Number(away.score || 0);
      const homeName = normalizeTeamKey((home.team && home.team.displayName) || '');
      const awayName = normalizeTeamKey((away.team && away.team.displayName) || '');
      if (homeScore === awayScore) {
        // Draw (soccer) — D for both
        if (homeName) { if (!formMap.has(homeName)) formMap.set(homeName, []); formMap.get(homeName).push('D'); }
        if (awayName) { if (!formMap.has(awayName)) formMap.set(awayName, []); formMap.get(awayName).push('D'); }
      } else {
        const homeWin = homeScore > awayScore;
        if (homeName) { if (!formMap.has(homeName)) formMap.set(homeName, []); formMap.get(homeName).push(homeWin ? 'W' : 'L'); }
        if (awayName) { if (!formMap.has(awayName)) formMap.set(awayName, []); formMap.get(awayName).push(homeWin ? 'L' : 'W'); }
      }
    }
    // Trim each to max 10
    for (const [k, v] of formMap) { formMap.set(k, v.slice(0, 10)); }
    cache.set(cacheKey, formMap, 10 * 60 * 1000); // 10 min
    return formMap;
  } catch (err) {
    console.warn(`ESPN recent form failed ${slug}/${league}:`, err && err.message);
    return new Map();
  }
}

/**
 * Fetch a team's full season schedule from ESPN (cached 1 hour).
 * Returns array of event objects with game results.
 */
async function fetchTeamSchedule(slug, league, teamId) {
  if (!teamId) return [];
  const cacheKey = `espn_sched:${slug}:${league}:${teamId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${slug}/${league}/teams/${teamId}/schedule`;
    const resp = await axios.get(url, { timeout: 12000 });
    const events = (resp.data && resp.data.events) || [];
    cache.set(cacheKey, events, 60 * 60 * 1000);
    return events;
  } catch (err) {
    console.warn(`ESPN sched fetch fail ${slug}/${league}/${teamId}:`, err && err.message);
    return [];
  }
}

/**
 * Extract head-to-head results from a team's schedule vs a specific opponent.
 * Returns { wins, losses, draws, games: [{date, teamScore, oppScore, teamHome}] }
 */
function extractH2H(scheduleEvents, teamName, opponentName) {
  const teamKey = normalizeTeamKey(teamName);
  const oppKey = normalizeTeamKey(opponentName);
  const result = { wins: 0, losses: 0, draws: 0, games: [] };
  for (const ev of (scheduleEvents || [])) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp) continue;
    const st = comp.status && comp.status.type;
    if (!st || st.state !== 'post') continue;
    const competitors = comp.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
    const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
    const hDispName = (home.team && home.team.displayName) || '';
    const aDispName = (away.team && away.team.displayName) || '';
    const hn = normalizeTeamKey(hDispName);
    const an = normalizeTeamKey(aDispName);
    const isMatch = ((hn === teamKey || fuzzyMatch(hDispName, teamName)) && (an === oppKey || fuzzyMatch(aDispName, opponentName)))
                 || ((hn === oppKey || fuzzyMatch(hDispName, opponentName)) && (an === teamKey || fuzzyMatch(aDispName, teamName)));
    if (!isMatch) continue;
    const hScore = Number(home.score || 0);
    const aScore = Number(away.score || 0);
    const isTeamHome = hn === teamKey || fuzzyMatch(hDispName, teamName);
    const tScore = isTeamHome ? hScore : aScore;
    const oScore = isTeamHome ? aScore : hScore;
    if (tScore > oScore) result.wins++;
    else if (tScore < oScore) result.losses++;
    else result.draws++;
    result.games.push({ date: ev.date || '', teamScore: tScore, oppScore: oScore, teamHome: isTeamHome });
  }
  result.games.sort((a, b) => new Date(b.date) - new Date(a.date));
  return result;
}

/**
 * Compute recent per-team stats from last N completed games in their schedule.
 * Returns { ppg, oppPpg, diff, avgTotal, gamesUsed } or null.
 */
function computeTeamStats(scheduleEvents, teamName, n) {
  n = n || 10;
  const teamKey = normalizeTeamKey(teamName);
  const completed = [];
  for (const ev of (scheduleEvents || [])) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp) continue;
    const st = comp.status && comp.status.type;
    if (!st || st.state !== 'post') continue;
    const competitors = comp.competitors || [];
    const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
    const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
    const hn = normalizeTeamKey((home.team && home.team.displayName) || '');
    const an = normalizeTeamKey((away.team && away.team.displayName) || '');
    if (hn !== teamKey && an !== teamKey) continue;
    const hScore = Number(home.score || 0);
    const aScore = Number(away.score || 0);
    const isTeamHome = hn === teamKey;
    completed.push({ date: ev.date || '', pts: isTeamHome ? hScore : aScore, opp: isTeamHome ? aScore : hScore, total: hScore + aScore });
  }
  completed.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = completed.slice(0, n);
  if (!recent.length) return null;
  const ppg = recent.reduce((s, g) => s + g.pts, 0) / recent.length;
  const oppPpg = recent.reduce((s, g) => s + g.opp, 0) / recent.length;
  const avgTotal = recent.reduce((s, g) => s + g.total, 0) / recent.length;
  return {
    ppg: Math.round(ppg * 10) / 10,
    oppPpg: Math.round(oppPpg * 10) / 10,
    diff: Math.round((ppg - oppPpg) * 10) / 10,
    avgTotal: Math.round(avgTotal * 10) / 10,
    gamesUsed: recent.length
  };
}

/**
 * Enrich an array of Game instances with real ESPN data.
 * Modifies games in place (updates game.meta).
 * @param {Game[]} games  Array of Game model instances
 * @param {string} espnKey  Key in ESPN_ENRICHMENT_MAP, or an object {slug, league}
 */
async function enrichGamesWithEspn(games, espnKey) {
  if (!games || !games.length) return games;

  const mapping = typeof espnKey === 'object' ? espnKey : ESPN_ENRICHMENT_MAP[espnKey];
  if (!mapping) return games;
  const { slug, league } = mapping;

  try {
    // Fetch ESPN scoreboard + recent form in parallel
    const [espnEvents, formMap] = await Promise.all([
      fetchEspnEnrichment(slug, league),
      fetchRecentForm(slug, league)
    ]);

    const matchedPairs = [];

    for (const game of games) {
      // Find matching ESPN event
      let matched = null;
      for (const ev of espnEvents) {
        const comp = ev.competitions && ev.competitions[0];
        if (!comp) continue;
        const competitors = comp.competitors || [];
        const espnHome = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
        const espnAway = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};
        const espnHomeName = (espnHome.team && espnHome.team.displayName) || '';
        const espnAwayName = (espnAway.team && espnAway.team.displayName) || '';
        if (fuzzyMatch(game.home_team, espnHomeName) && fuzzyMatch(game.away_team, espnAwayName)) {
          matched = { comp, espnHome, espnAway, ev };
          break;
        }
      }

      // Populate form from the form map regardless of ESPN match
      const homeKey = normalizeTeamKey(game.home_team);
      const awayKey = normalizeTeamKey(game.away_team);
      if (formMap.has(homeKey)) game.meta.homeForm = formMap.get(homeKey);
      if (formMap.has(awayKey)) game.meta.awayForm = formMap.get(awayKey);

      if (!matched) continue;
      const { comp, espnHome, espnAway, ev } = matched;

      // Team records
      const homeRecords = espnHome.records || [];
      const awayRecords = espnAway.records || [];
      game.meta.homeTeamRecord = (homeRecords[0] && homeRecords[0].summary) || '';
      game.meta.awayTeamRecord = (awayRecords[0] && awayRecords[0].summary) || '';
      game.meta.homeRecord = (homeRecords[1] && homeRecords[1].summary) || '';
      game.meta.awayRecord = (awayRecords[2] && awayRecords[2].summary) || '';

      // ESPN odds
      const espnOdds = (comp.odds && comp.odds[0]) || {};
      game.meta.espnSpread = espnOdds.details || '';
      game.meta.espnOverUnder = espnOdds.overUnder || null;
      game.meta.espnHomeML = (espnOdds.homeTeamOdds && espnOdds.homeTeamOdds.moneyLine) || null;
      game.meta.espnAwayML = (espnOdds.awayTeamOdds && espnOdds.awayTeamOdds.moneyLine) || null;

      // ESPN win probability (BPI)
      game.meta.espnHomeWinPct = (espnOdds.homeTeamOdds && espnOdds.homeTeamOdds.winPercentage) || null;
      game.meta.espnAwayWinPct = (espnOdds.awayTeamOdds && espnOdds.awayTeamOdds.winPercentage) || null;

      // Venue
      const venue = comp.venue || {};
      game.meta.venue = venue.fullName || '';

      // Collect team IDs for H2H & stats second pass
      const _hid = espnHome.team && espnHome.team.id;
      const _aid = espnAway.team && espnAway.team.id;
      if (_hid || _aid) matchedPairs.push({ game, hid: _hid, aid: _aid });
    }

    // ── Second pass: team schedules → head-to-head & per-team stats ──
    if (matchedPairs.length > 0) {
      try {
        const ids = new Set();
        matchedPairs.forEach(p => { if (p.hid) ids.add(String(p.hid)); if (p.aid) ids.add(String(p.aid)); });
        const sm = new Map();
        await Promise.allSettled([...ids].map(id =>
          fetchTeamSchedule(slug, league, id).then(ev => sm.set(id, ev)).catch(() => sm.set(id, []))
        ));
        for (const { game, hid, aid } of matchedPairs) {
          const hs = sm.get(String(hid)) || [];
          const as_ = sm.get(String(aid)) || [];
          game.meta.h2h = extractH2H(hs, game.home_team, game.away_team);
          game.meta.homeStats = computeTeamStats(hs, game.home_team, 10);
          game.meta.awayStats = computeTeamStats(as_, game.away_team, 10);
        }
      } catch (schedErr) {
        console.warn('enrichGamesWithEspn schedule pass error:', schedErr && schedErr.message);
      }
    }
  } catch (err) {
    console.warn('enrichGamesWithEspn error:', err && err.message);
  }

  return games;
}

module.exports = {
  // Config
  ODDS_API_KEY,
  ODDS_API_BASE,
  // Utility
  normalizeTeamKey,
  getUtcDateKey,
  // API wrapper
  fetchOddsApi,
  // Odds helpers
  extractBestOdds,
  // ESPN enrichment
  ESPN_ENRICHMENT_MAP,
  enrichGamesWithEspn,
  // TTL
  DEFAULT_TTL
};
