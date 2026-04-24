/**
 * Services Index
 * ──────────────
 * Central registry of all sport services.
 * Each service exposes: { getGames(filterLeague?), SPORT, LEAGUE? }
 */

const nba = require('./nba');
const nfl = require('./nfl');
const nhl = require('./nhl');
const mlb = require('./mlb');
const soccer = require('./soccer');
const { cache, CacheService, DEFAULT_TTL } = require('./cache');

const SERVICES = {
  nba,
  nfl,
  nhl,
  mlb,
  soccer
};

/**
 * Get the service for a sport string (case-insensitive).
 */
function getService(sport) {
  const key = String(sport || '').toLowerCase().trim();
  const aliases = {
    basketball: 'nba',
    football: 'nfl',
    hockey: 'nhl',
    baseball: 'mlb',
    soccer: 'soccer'
  };
  return SERVICES[aliases[key] || key] || null;
}

module.exports = { SERVICES, getService, cache, CacheService, DEFAULT_TTL };
