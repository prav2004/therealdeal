/**
 * Soccer Service
 * ──────────────
 * Source: The Odds API – multiple soccer sport keys.
 * Top 5 leagues + FIFA World Cup.
 * Returns array of Game model instances.
 */

const { Game } = require('../models/Game');
const { fetchOddsApi, extractBestOdds, DEFAULT_TTL, enrichGamesWithEspn, ESPN_ENRICHMENT_MAP } = require('./base');

const SPORT = 'soccer';

// ─── League → Odds API sport key mapping ──────────────────────────────────────

const SOCCER_LEAGUES = [
  { label: 'EPL',                   sportKey: 'soccer_epl' },
  { label: 'La Liga',               sportKey: 'soccer_spain_la_liga' },
  { label: 'Bundesliga',            sportKey: 'soccer_germany_bundesliga' },
  { label: 'Serie A',               sportKey: 'soccer_italy_serie_a' },
  { label: 'UEFA Champions League', sportKey: 'soccer_uefa_champs_league' },
  { label: 'FIFA World Cup',        sportKey: 'soccer_fifa_world_cup' }
];

const ALL_LEAGUES = SOCCER_LEAGUES.map(r => r.label);

// ─── Main entry ───────────────────────────────────────────────────────────────

async function getGames(filterLeague) {
  const leagues = filterLeague
    ? SOCCER_LEAGUES.filter(r => r.label === filterLeague)
    : SOCCER_LEAGUES;

  const output = [];
  const seen = new Set();

  // Fetch all requested leagues in parallel
  const fetches = leagues.map(async (league) => {
    try {
      const events = await fetchOddsApi(league.sportKey, 'h2h,spreads,totals', DEFAULT_TTL.odds);
      return { league: league.label, sportKey: league.sportKey, events };
    } catch (err) {
      console.warn(`Soccer: Failed to fetch ${league.label} (${league.sportKey}):`, err.message);
      return { league: league.label, sportKey: league.sportKey, events: [] };
    }
  });

  const results = await Promise.allSettled(fetches);

  // Collect games per sport key so we can enrich per league
  const gamesByKey = {};

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { league, sportKey, events } = result.value;
    if (!gamesByKey[sportKey]) gamesByKey[sportKey] = [];

    for (const event of events) {
      if (!event.id || seen.has(event.id)) continue;
      if (!event.home_team || !event.away_team) continue;

      const oddsData = extractBestOdds(event);
      const game = Game.fromOddsApi(SPORT, event, { oddsData, league });
      output.push(game);
      gamesByKey[sportKey].push(game);
      seen.add(event.id);
    }
  }

  // Enrich each soccer league with ESPN data in parallel
  const enrichPromises = Object.entries(gamesByKey).map(([sportKey, games]) => {
    const espnMap = ESPN_ENRICHMENT_MAP[sportKey];
    if (espnMap && games.length) {
      return enrichGamesWithEspn(games, espnMap).catch(() => {});
    }
    return Promise.resolve();
  });
  await Promise.allSettled(enrichPromises);

  return output;
}

module.exports = { getGames, SPORT, SOCCER_LEAGUES, ALL_LEAGUES };
