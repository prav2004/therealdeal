/**
 * Soccer Service
 * ──────────────
 * Source: SportsDataIO /soccer (competition-based).
 * Supported leagues: EPL, UCL, La Liga, Serie A, Bundesliga, Ligue 1, MLS,
 *                    FIFA World Cup.
 * Returns array of Game model instances.
 */

const { Game } = require('../models/Game');
const {
  fetchSportsDataIO,
  buildOddsMap,
  buildTeamRecordMap,
  getRecentFormMap,
  readStat,
  normalizeTeamKey,
  getGameStartIso,
  getUtcDateKey,
  DEFAULT_TTL
} = require('./base');

const SPORT = 'soccer';

// ─── League rules ─────────────────────────────────────────────────────────────

const SOCCER_LEAGUE_RULES = [
  { label: 'MLS',                   keys: ['mls', 'major league soccer'] },
  { label: 'FIFA World Cup',        keys: ['fifa world cup', 'world cup'] },
  { label: 'La Liga',               keys: ['la liga', 'laliga', 'laliga santander'] },
  { label: 'UEFA Champions League', keys: ['uefa champions league', 'champions league', 'ucl'] },
  { label: 'EPL',                   keys: ['english premier league', 'premier league', 'epl', 'barclays'] },
  { label: 'Serie A',               keys: ['serie a', 'serie a tim', 'italian serie a'] },
  { label: 'Bundesliga',            keys: ['bundesliga', 'german bundesliga'] },
  { label: 'Ligue 1',               keys: ['ligue 1', 'ligue 1 uber eats', 'french ligue 1'] }
];

const ALL_LEAGUES = SOCCER_LEAGUE_RULES.map(r => r.label);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveSoccerLeague(game) {
  const raw = [
    readStat(game, ['League', 'LeagueKey', 'Competition', 'CompetitionName', 'Season', 'Group', 'Name']),
    readStat(game, ['SeasonName', 'ShortName'])
  ].filter(Boolean).join(' ').toLowerCase();
  for (const rule of SOCCER_LEAGUE_RULES) {
    if (rule.keys.some(key => raw.includes(key))) return rule.label;
  }
  return null;
}

function normalizeCompetitionKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function fetchCompetitions() {
  const payload = await fetchSportsDataIO(SPORT, '/scores/json/Competitions', null, DEFAULT_TTL.competitions);
  return Array.isArray(payload) ? payload : [];
}

function mapCompetitions(competitions) {
  const mapped = new Map();
  competitions.forEach((comp) => {
    const name = readStat(comp, ['Name', 'Competition', 'CompetitionName']) || '';
    const key = readStat(comp, ['Key', 'CompetitionKey', 'ShortName', 'Abbreviation']) || '';
    const id = readStat(comp, ['CompetitionId', 'CompetitionID', 'CompetitionIDGlobal', 'CompetitionIdGlobal', 'Id', 'ID']);
    const tokens = normalizeCompetitionKey(`${name} ${key}`);
    if (!id) return;
    for (const rule of SOCCER_LEAGUE_RULES) {
      if (rule.keys.some(k => tokens.includes(k))) {
        mapped.set(rule.label, { id: String(id), label: rule.label });
        return;
      }
    }
  });
  return mapped;
}

async function fetchGamesByCompetition(competitionId, dateKey) {
  const scoresPath = `/scores/json/GamesByDate/${dateKey}/${competitionId}`;
  const oddsPath = `/odds/json/GameOddsByDate/${dateKey}/${competitionId}`;
  const [scoresPayload, oddsPayload] = await Promise.all([
    fetchSportsDataIO(SPORT, scoresPath, null, DEFAULT_TTL.scores),
    fetchSportsDataIO(SPORT, oddsPath, null, DEFAULT_TTL.odds)
  ]);
  return {
    games: Array.isArray(scoresPayload) ? scoresPayload : [],
    odds: Array.isArray(oddsPayload) ? oddsPayload : []
  };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Get all soccer games across all supported leagues.
 * @param {string} [filterLeague] – optional league label to filter (e.g. "EPL").
 */
async function getGames(filterLeague) {
  const now = Date.now();
  const windowMs = 48 * 60 * 60 * 1000; // look 48 hours ahead for soccer
  const dates = [getUtcDateKey(new Date()), getUtcDateKey(new Date(now + 24 * 60 * 60 * 1000))];

  const competitions = await fetchCompetitions();
  const leagueMap = mapCompetitions(competitions);

  const teamsPayload = await fetchSportsDataIO(SPORT, '/scores/json/Teams', null, DEFAULT_TTL.teams).catch(() => []);
  const teamRecords = buildTeamRecordMap(Array.isArray(teamsPayload) ? teamsPayload : []);
  const formMap = await getRecentFormMap(SPORT);

  const output = [];
  const seen = new Set();

  const addGames = (games, odds, leagueLabel) => {
    if (!games || !games.length) return;
    const oddsMap = buildOddsMap(odds || []);
    for (const game of games) {
      const gameId = readStat(game, ['GameID', 'GameId', 'GameKey']);
      if (!gameId || seen.has(String(gameId))) continue;
      const startIso = getGameStartIso(game);
      const startMs = startIso ? Date.parse(startIso) : NaN;
      if (!Number.isFinite(startMs) || startMs < now - 3600000 || startMs > now + windowMs) continue;

      const homeTeam = readStat(game, ['HomeTeamName', 'HomeTeam', 'HomeTeamKey']);
      const awayTeam = readStat(game, ['AwayTeamName', 'AwayTeam', 'AwayTeamKey']);
      if (!homeTeam || !awayTeam) continue;

      const resolvedLeague = leagueLabel || resolveSoccerLeague(game);
      if (!resolvedLeague) continue;
      if (filterLeague && resolvedLeague !== filterLeague) continue;

      const oddsData = oddsMap.get(String(gameId)) || { moneyline: {}, spread: {}, totals: {} };
      output.push(Game.fromSportsDataIO(SPORT, game, {
        oddsData,
        league: resolvedLeague,
        teamRecords,
        formMap
      }));
      seen.add(String(gameId));
    }
  };

  // Fetch by competition if we have mapped competitions
  if (leagueMap.size) {
    for (const { id: competitionId, label } of leagueMap.values()) {
      if (filterLeague && label !== filterLeague) continue;
      const allGames = [];
      const allOdds = [];
      for (const dateKey of dates) {
        try {
          const payload = await fetchGamesByCompetition(competitionId, dateKey);
          allGames.push(...payload.games);
          allOdds.push(...payload.odds);
        } catch (err) { /* skip */ }
      }
      addGames(allGames, allOdds, label);
    }
  }

  // Fallback: fetch all soccer games and resolve league from data
  if (!output.length) {
    for (const dateKey of dates) {
      try {
        const [scoresPayload, oddsPayload] = await Promise.all([
          fetchSportsDataIO(SPORT, `/scores/json/GamesByDate/${dateKey}`, null, DEFAULT_TTL.scores),
          fetchSportsDataIO(SPORT, `/odds/json/GameOddsByDate/${dateKey}`, null, DEFAULT_TTL.odds)
        ]);
        addGames(
          Array.isArray(scoresPayload) ? scoresPayload : [],
          Array.isArray(oddsPayload) ? oddsPayload : [],
          null
        );
      } catch (err) { /* skip */ }
    }
  }

  return output;
}

module.exports = { getGames, SPORT, SOCCER_LEAGUE_RULES, ALL_LEAGUES };
