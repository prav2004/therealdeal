/**
 * NFL Service
 * -----------
 * Source: SportsDataIO /nfl.
 * Returns array of Game model instances.
 */

const { Game } = require('../models/Game');
const {
  fetchSportsDataIO,
  buildOddsMap,
  buildTeamRecordMap,
  getRecentFormMap,
  loadTodayTomorrowGames,
  findNextGameDay,
  readStat,
  normalizeTeamKey,
  getGameStartIso,
  DEFAULT_TTL
} = require('./base');

const SPORT = 'nfl';
const LEAGUE = 'NFL';

async function getGames() {
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000; // NFL games span a week

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
