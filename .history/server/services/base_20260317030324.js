/**
 * Base Sport Service
 * ------------------
 * Shared helpers used by every sport-specific service.
 * Wraps SportsDataIO API calls, caching, odds-map building, team records,
 * and recent-form computation so each sport service stays lean.
 */

const axios = require('axios');
const { cache, DEFAULT_TTL } = require('./cache');

// ─── Config pulled from env (same constants as server.js) ─────────────────────
const SPORTSDATAIO_KEY = process.env.SPORTSDATAIO_KEY || process.env.SPORTS_DATA_IO_KEY || '';
const SPORTSDATA_BASE  = 'https://api.sportsdata.io/v3';
const APISPORTS_KEY    = process.env.APISPORTS_KEY || process.env.API_SPORTS_KEY || '0254dcc218e487f9523bf40edda8640f';
const APISPORTS_BASE   = 'https://v1.basketball.api-sports.io';

// ─── Utility ──────────────────────────────────────────────────────────────────

function readStat(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function normalizeTeamKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getUtcDateKey(d) {
  return d.toISOString().slice(0, 10);
}

function getGameStartIso(game) {
  const startRaw = readStat(game, ['DateTime', 'DateTimeUTC', 'Day', 'GameDate', 'DateTimeLocal', 'StartTime', 'StartTimeUTC']);
  const startDate = startRaw ? new Date(startRaw) : null;
  return startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null;
}

// ─── SportsDataIO wrapper ─────────────────────────────────────────────────────

async function fetchSportsDataIO(sport, path, params, ttlMs) {
  if (!SPORTSDATAIO_KEY) throw new Error('SPORTSDATAIO_KEY not configured');
  const cacheKey = `sdio:${sport}:${path}:${JSON.stringify(params || {})}`;
  if (ttlMs) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }
  const url = `${SPORTSDATA_BASE}/${sport}${path}`;
  const resp = await axios.get(url, {
    params: Object.assign({ key: SPORTSDATAIO_KEY }, params || {}),
    timeout: 12000
  });
  const payload = resp && typeof resp.data !== 'undefined' ? resp.data : null;
  if (ttlMs) cache.set(cacheKey, payload, ttlMs);
  return payload;
}

// ─── API-Sports.io wrapper ────────────────────────────────────────────────────

function getApiSportsHeaders() {
  return { 'x-apisports-key': APISPORTS_KEY };
}

async function fetchApiSports(path, params, ttlMs) {
  if (!APISPORTS_KEY) throw new Error('APISPORTS_KEY not configured');
  const cacheKey = `apisports:${path}:${JSON.stringify(params || {})}`;
  if (ttlMs) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }
  const resp = await axios.get(`${APISPORTS_BASE}${path}`, {
    headers: getApiSportsHeaders(),
    params,
    timeout: 12000
  });
  const list = resp && resp.data && Array.isArray(resp.data.response) ? resp.data.response : [];
  if (ttlMs) cache.set(cacheKey, list, ttlMs);
  return list;
}

// ─── Odds map builder (from SportsDataIO odds payload) ───────────────────────

function buildOddsMap(oddsList) {
  const map = new Map();
  (oddsList || []).forEach((game) => {
    const gameId = readStat(game, ['GameID', 'GameId', 'GameKey']);
    if (!gameId) return;

    const getUpdateMs = (obj) => {
      if (!obj) return 0;
      const raw = readStat(obj, ['Updated', 'LastUpdated', 'DateUpdated', 'UpdatedAt', 'LastUpdate', 'Timestamp', 'DateTime', 'DateTimeUTC']);
      if (!raw) return 0;
      if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
      const parsed = Date.parse(String(raw));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const chooseLatest = (current, value, updateMs) => {
      if (typeof value === 'undefined' || value === null) return current;
      if (!current || updateMs >= current.updatedMs) return { value, updatedMs: updateMs };
      return current;
    };

    const baseUpdateMs = getUpdateMs(game);
    let homeML = null, awayML = null, drawML = null;
    let pointSpread = null, homeSpread = null, awaySpread = null;
    let homeSpreadPayout = null, awaySpreadPayout = null;
    let totalPoints = null, overPayout = null, underPayout = null;

    const processEntry = (entry, entryUpdateMs) => {
      homeML = chooseLatest(homeML, readStat(entry, ['HomeMoneyLine', 'HomeTeamMoneyLine', 'HomeMoneyline']), entryUpdateMs);
      awayML = chooseLatest(awayML, readStat(entry, ['AwayMoneyLine', 'AwayTeamMoneyLine', 'AwayMoneyline']), entryUpdateMs);
      drawML = chooseLatest(drawML, readStat(entry, ['DrawMoneyLine', 'TieMoneyLine', 'DrawMoneyline']), entryUpdateMs);
      pointSpread = chooseLatest(pointSpread, readStat(entry, ['PointSpread', 'PointSpreadValue']), entryUpdateMs);
      homeSpread = chooseLatest(homeSpread, readStat(entry, ['HomePointSpread', 'HomeSpread']), entryUpdateMs);
      awaySpread = chooseLatest(awaySpread, readStat(entry, ['AwayPointSpread', 'AwaySpread']), entryUpdateMs);
      homeSpreadPayout = chooseLatest(homeSpreadPayout, readStat(entry, ['HomePointSpreadPayout', 'HomeSpreadPayout']), entryUpdateMs);
      awaySpreadPayout = chooseLatest(awaySpreadPayout, readStat(entry, ['AwayPointSpreadPayout', 'AwaySpreadPayout']), entryUpdateMs);
      totalPoints = chooseLatest(totalPoints, readStat(entry, ['OverUnder', 'Total', 'TotalPoints', 'OverUnderPoints', 'OverUnderTotal', 'TotalScore']), entryUpdateMs);
      overPayout = chooseLatest(overPayout, readStat(entry, ['OverPayout', 'OverMoneyLine', 'OverOdds', 'OverPrice']), entryUpdateMs);
      underPayout = chooseLatest(underPayout, readStat(entry, ['UnderPayout', 'UnderMoneyLine', 'UnderOdds', 'UnderPrice']), entryUpdateMs);
    };

    processEntry(game, baseUpdateMs);

    ['PregameOdds', 'Odds', 'GameOdds', 'Books', 'Bookmakers', 'BookmakerOdds'].forEach((key) => {
      const entries = Array.isArray(game && game[key]) ? game[key] : [];
      entries.forEach((entry) => processEntry(entry, getUpdateMs(entry) || baseUpdateMs));
    });

    map.set(String(gameId), {
      moneyline: {
        home: homeML ? homeML.value : null,
        draw: drawML ? drawML.value : null,
        away: awayML ? awayML.value : null
      },
      spread: {
        points: pointSpread ? pointSpread.value : null,
        home: homeSpread ? homeSpread.value : null,
        away: awaySpread ? awaySpread.value : null,
        homePayout: homeSpreadPayout ? homeSpreadPayout.value : null,
        awayPayout: awaySpreadPayout ? awaySpreadPayout.value : null
      },
      totals: {
        points: totalPoints ? totalPoints.value : null,
        over: overPayout ? overPayout.value : null,
        under: underPayout ? underPayout.value : null
      }
    });
  });
  return map;
}

// ─── Team records ─────────────────────────────────────────────────────────────

function buildTeamRecordMap(teams) {
  const map = new Map();
  (teams || []).forEach((team) => {
    const wins = readStat(team, ['Wins', 'wins', 'LeagueWins', 'ConferenceWins']);
    const losses = readStat(team, ['Losses', 'losses', 'LeagueLosses', 'ConferenceLosses']);
    const ties = readStat(team, ['Ties', 'ties', 'Draws', 'draws']);
    const record = ties != null
      ? `${wins || 0}-${losses || 0}-${ties || 0}`
      : `${wins || 0}-${losses || 0}`;
    [
      readStat(team, ['TeamID', 'TeamId', 'TeamIDGlobal']),
      readStat(team, ['Key', 'TeamKey', 'Abbreviation']),
      readStat(team, ['Name', 'TeamName']),
      `${readStat(team, ['City', 'Market']) || ''} ${readStat(team, ['Name', 'TeamName']) || ''}`.trim()
    ].filter(Boolean).forEach((key) => map.set(normalizeTeamKey(key), record));
  });
  return map;
}

// ─── Recent form (W/L/D last N games) ────────────────────────────────────────

async function getRecentFormMap(sport, maxDays = 14) {
  const cacheKey = `recent-form:${sport}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const formMap = new Map();
  const now = new Date();
  for (let offset = 1; offset <= maxDays; offset++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    const dateKey = getUtcDateKey(date);
    let games = [];
    try {
      const payload = await fetchSportsDataIO(sport, `/scores/json/GamesByDate/${dateKey}`, null, DEFAULT_TTL.scores);
      games = Array.isArray(payload) ? payload : [];
    } catch (err) { continue; }

    games.forEach((game) => {
      const status = String(readStat(game, ['Status', 'GameStatus', 'StatusType', 'StatusName']) || '').toLowerCase();
      if (!status.includes('final') && status !== 'f' && status !== 'closed') return;
      const home = readStat(game, ['HomeTeamName', 'HomeTeam', 'HomeTeamKey']);
      const away = readStat(game, ['AwayTeamName', 'AwayTeam', 'AwayTeamKey']);
      const homeScore = Number(readStat(game, ['HomeTeamScore', 'HomeScore', 'HomeScoreTotal']));
      const awayScore = Number(readStat(game, ['AwayTeamScore', 'AwayScore', 'AwayScoreTotal']));
      if (!home || !away || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return;
      const hk = normalizeTeamKey(home), ak = normalizeTeamKey(away);
      const hl = formMap.get(hk) || [], al = formMap.get(ak) || [];
      if (homeScore > awayScore) { if (hl.length < 5) hl.push('W'); if (al.length < 5) al.push('L'); }
      else if (awayScore > homeScore) { if (hl.length < 5) hl.push('L'); if (al.length < 5) al.push('W'); }
      else { if (hl.length < 5) hl.push('D'); if (al.length < 5) al.push('D'); }
      formMap.set(hk, hl); formMap.set(ak, al);
    });
  }

  cache.set(cacheKey, formMap, DEFAULT_TTL.recentForm);
  return formMap;
}

// ─── Date-range game loading (SportsDataIO) ──────────────────────────────────

async function loadGamesForDates(sport, dateKeys) {
  let allGames = [];
  let allOddsMap = new Map();
  for (const dk of dateKeys) {
    try {
      const [games, odds] = await Promise.all([
        fetchSportsDataIO(sport, `/scores/json/GamesByDate/${dk}`, null, DEFAULT_TTL.scores),
        fetchSportsDataIO(sport, `/odds/json/GameOddsByDate/${dk}`, null, DEFAULT_TTL.odds)
      ]);
      allGames.push(...(Array.isArray(games) ? games : []));
      const oddsMap = buildOddsMap(Array.isArray(odds) ? odds : []);
      for (const [k, v] of oddsMap) allOddsMap.set(k, v);
    } catch (err) { /* skip unavailable dates */ }
  }
  return { games: allGames, oddsMap: allOddsMap };
}

/**
 * Load today + tomorrow games (default window).
 */
async function loadTodayTomorrowGames(sport) {
  const now = new Date();
  const todayKey = getUtcDateKey(now);
  const tomorrowKey = getUtcDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  return loadGamesForDates(sport, [todayKey, tomorrowKey]);
}

/**
 * Scan up to 30 days ahead to find the next day with games (fallback).
 */
async function findNextGameDay(sport, maxDays = 30) {
  for (let i = 0; i < maxDays; i++) {
    const dk = getUtcDateKey(new Date(Date.now() + i * 24 * 60 * 60 * 1000));
    try {
      const games = await fetchSportsDataIO(sport, `/scores/json/GamesByDate/${dk}`, null, DEFAULT_TTL.scores);
      if (Array.isArray(games) && games.length > 0) {
        const odds = await fetchSportsDataIO(sport, `/odds/json/GameOddsByDate/${dk}`, null, DEFAULT_TTL.odds).catch(() => []);
        return { dateKey: dk, games, oddsMap: buildOddsMap(Array.isArray(odds) ? odds : []) };
      }
    } catch (err) { continue; }
  }
  return { dateKey: null, games: [], oddsMap: new Map() };
}

module.exports = {
  // Config (re-exported for convenience)
  SPORTSDATAIO_KEY,
  SPORTSDATA_BASE,
  APISPORTS_KEY,
  APISPORTS_BASE,
  // Utility
  readStat,
  normalizeTeamKey,
  getUtcDateKey,
  getGameStartIso,
  // API wrappers
  fetchSportsDataIO,
  fetchApiSports,
  getApiSportsHeaders,
  // Data builders
  buildOddsMap,
  buildTeamRecordMap,
  getRecentFormMap,
  // Game loaders
  loadGamesForDates,
  loadTodayTomorrowGames,
  findNextGameDay,
  // TTL
  DEFAULT_TTL
};
