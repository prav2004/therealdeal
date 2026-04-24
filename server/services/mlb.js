/**
 * MLB Service
 * -----------
 * Source: The Odds API – sport key 'baseball_mlb'.
 * Returns array of Game model instances.
 */

const { Game } = require('../models/Game');
const { fetchOddsApi, extractBestOdds, DEFAULT_TTL, enrichGamesWithEspn } = require('./base');

const SPORT = 'mlb';
const LEAGUE = 'MLB';
const ODDS_SPORT_KEY = 'baseball_mlb';

async function getGames() {
  try {
    const events = await fetchOddsApi(ODDS_SPORT_KEY, 'h2h,spreads,totals', DEFAULT_TTL.odds);

    const output = [];
    const seen = new Set();

    for (const event of events) {
      if (!event.id || seen.has(event.id)) continue;
      if (!event.home_team || !event.away_team) continue;

      const oddsData = extractBestOdds(event);
      output.push(Game.fromOddsApi(SPORT, event, { oddsData, league: LEAGUE }));
      seen.add(event.id);
    }

    // Enrich with ESPN real data (records, form, odds, venue)
    await enrichGamesWithEspn(output, 'mlb');

    return output;
  } catch (err) {
    console.warn('MLB: Failed to fetch from Odds API:', err.message);
    return [];
  }
}

module.exports = { getGames, SPORT, LEAGUE };

