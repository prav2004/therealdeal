/**
 * NHL Service
 * -----------
 * Source: SportsDataIO /nhl.
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

const SPORT = 'nhl';
const LEAGUE = 'NHL';

async function getGames() {
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
    if (!startIso) continue;

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
