/**
 * NHL Service
 * -----------
 * Source: The Odds API – sport key 'icehockey_nhl'.
 * Returns array of Game model instances.
 */

const { Game } = require('../models/Game');
const { fetchOddsApi, extractBestOdds, DEFAULT_TTL, enrichGamesWithEspn } = require('./base');

const SPORT = 'nhl';
const LEAGUE = 'NHL';
const ODDS_SPORT_KEY = 'icehockey_nhl';

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
    await enrichGamesWithEspn(output, 'nhl');

    return output;
  } catch (err) {
    console.warn('NHL: Failed to fetch from Odds API:', err.message);
    return [];
  }
}

module.exports = { getGames, SPORT, LEAGUE };

