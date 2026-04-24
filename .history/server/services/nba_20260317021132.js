/**
 * NBA Service
 * -----------
 * Primary source: API-Sports.io (league 12) with new key.
 * Fallback: SportsDataIO /nba.
 * Returns array of Game model instances.
 */

const { Game } = require('../models/Game');
const {
  APISPORTS_KEY,
  fetchApiSports,
  fetchSportsDataIO,
  buildOddsMap,
  buildTeamRecordMap,
  getRecentFormMap,
  loadTodayTomorrowGames,
  findNextGameDay,
  readStat,
  normalizeTeamKey,
  getUtcDateKey,
  getGameStartIso,
  DEFAULT_TTL
} = require('./base');

const SPORT = 'nba';
const LEAGUE = 'NBA';

// ─── API-Sports season helper ─────────────────────────────────────────────────

function getApiSportsNbaSeason(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

// ─── Build from API-Sports ────────────────────────────────────────────────────

async function fetchFromApiSports() {
  if (!APISPORTS_KEY) return null;
  const season = getApiSportsNbaSeason();
  const todayKey = getUtcDateKey(new Date());
  const tomorrowKey = getUtcDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

  let allGames = [];
  for (const dk of [todayKey, tomorrowKey]) {
    try {
      const games = await fetchApiSports('/games', { league: '12', season, date: dk }, DEFAULT_TTL.scores);
      allGames.push(...games);
    } catch (err) { /* skip */ }
  }

  if (!allGames.length) return null;
  return allGames;
}

// ─── Odds from API-Sports ─────────────────────────────────────────────────────

async function fetchApiSportsOdds(gameId) {
  try {
    const data = await fetchApiSports('/odds', {
      league: '12',
      season: getApiSportsNbaSeason(),
      game: String(gameId)
    }, DEFAULT_TTL.odds);
    return data;
  } catch (err) {
    return [];
  }
}

function pickApiSportsMoneyline(response, homeName, awayName) {
  const homeKey = String(homeName || '').toLowerCase();
  const awayKey = String(awayName || '').toLowerCase();
  let home = null, away = null;

  const list = Array.isArray(response) ? response : [];
  list.forEach((entry) => {
    const bookmakers = entry && entry.bookmakers;
    if (!Array.isArray(bookmakers)) return;
    bookmakers.forEach((bookmaker) => {
      const bets = bookmaker && bookmaker.bets;
      if (!Array.isArray(bets)) return;
      bets.forEach((bet) => {
        const name = String(bet && bet.name || '').toLowerCase();
        if (!name.includes('winner') && !name.includes('moneyline') && !name.includes('home/away')) return;
        const values = Array.isArray(bet.values) ? bet.values : [];
        values.forEach((value) => {
          const label = String(value && (value.value || value.name) || '').toLowerCase();
          const odd = Number(value && (value.odd || value.price));
          if (!Number.isFinite(odd) || odd <= 1) return;
          if (label.includes(homeKey) || label === 'home' || label === '1') home = odd;
          if (label.includes(awayKey) || label === 'away' || label === '2') away = odd;
        });
      });
    });
  });

  return { home, away, draw: null };
}

// ─── Main entry: get NBA games ────────────────────────────────────────────────

async function getGames() {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;

  // Try API-Sports first
  const apiSportsGames = await fetchFromApiSports();
  if (apiSportsGames && apiSportsGames.length) {
    // Enrich with SportsDataIO team records + form
    const teamsPayload = await fetchSportsDataIO(SPORT, '/scores/json/Teams', null, DEFAULT_TTL.teams).catch(() => []);
    const teamRecords = buildTeamRecordMap(Array.isArray(teamsPayload) ? teamsPayload : []);
    const formMap = await getRecentFormMap(SPORT);

    const output = [];
    for (const game of apiSportsGames) {
      const startMs = game.date ? Date.parse(game.date) : NaN;
      if (!Number.isFinite(startMs) || startMs < now - 3600000 || startMs > now + windowMs) continue;

      const teams = game.teams || {};
      const homeName = (teams.home && teams.home.name) || '';
      const awayName = (teams.away && teams.away.name) || '';
      if (!homeName || !awayName) continue;

      // Fetch odds for this game
      const oddsResp = await fetchApiSportsOdds(game.id);
      const ml = pickApiSportsMoneyline(oddsResp, homeName, awayName);

      output.push(Game.fromApiSports(game, {
        oddsData: { moneyline: ml, spread: {}, totals: {} },
        teamRecords,
        formMap
      }));
    }
    if (output.length) return output;
  }

  // Fallback to SportsDataIO
  return getGamesFromSportsDataIO();
}

async function getGamesFromSportsDataIO() {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;

  let payload = await loadTodayTomorrowGames(SPORT);
  if (!payload.games.length) {
    payload = await findNextGameDay(SPORT);
  }

  const teamsPayload = await fetchSportsDataIO(SPORT, '/scores/json/Teams', null, DEFAULT_TTL.teams).catch(() => []);
  const teamRecords = buildTeamRecordMap(Array.isArray(teamsPayload) ? teamsPayload : []);
  const formMap = await getRecentFormMap(SPORT);

  const output = [];
  const seen = new Set();

  for (const game of payload.games) {
    const gameId = readStat(game, ['GameID', 'GameId', 'GameKey']);
    if (!gameId || seen.has(String(gameId))) continue;
    const startIso = getGameStartIso(game);
    const startMs = startIso ? Date.parse(startIso) : NaN;
    if (!Number.isFinite(startMs)) continue;

    const homeTeam = readStat(game, ['HomeTeamName', 'HomeTeam', 'HomeTeamKey']);
    const awayTeam = readStat(game, ['AwayTeamName', 'AwayTeam', 'AwayTeamKey']);
    if (!homeTeam || !awayTeam) continue;

    const oddsData = payload.oddsMap.get(String(gameId)) || { moneyline: {}, spread: {}, totals: {} };
    output.push(Game.fromSportsDataIO(SPORT, game, { oddsData, league: LEAGUE, teamRecords, formMap }));
    seen.add(String(gameId));
  }

  return output;
}

module.exports = { getGames, SPORT, LEAGUE };
