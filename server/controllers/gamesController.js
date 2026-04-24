/**
 * Games Controller
 * ────────────────
 * Orchestrates fetching, normalizing, and returning games from sport services.
 * Each handler returns an array of Game.toJSON() objects for the response.
 */

const { getService, SERVICES } = require('../services');
const { Game } = require('../models/Game');
const { ALL_LEAGUES: SOCCER_LEAGUES } = require('../services/soccer');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendError(res, err) {
  const msg = err && err.message ? String(err.message) : String(err || 'Unknown error');
  if (msg.includes('ODDS_API_KEY')) {
    return res.status(503).json({ error: 'API key not configured' });
  }
  if (msg.includes('Unsupported sport')) {
    return res.status(400).json({ error: 'Unsupported sport' });
  }
  console.error('Games controller error:', msg);
  return res.status(502).json({ error: 'Sports data unavailable' });
}

// ─── GET /v2/games – all sports ───────────────────────────────────────────────

async function getAllGames(req, res) {
  try {
    const results = await Promise.allSettled(
      Object.values(SERVICES).map(svc => svc.getGames())
    );
    const games = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) {
        r.value.forEach(g => games.push(g instanceof Game ? g.toJSON() : g));
      }
    });
    // Sort by start time
    games.sort((a, b) => {
      const ta = a.startTime ? Date.parse(a.startTime) : Infinity;
      const tb = b.startTime ? Date.parse(b.startTime) : Infinity;
      return ta - tb;
    });
    return res.json(games);
  } catch (err) {
    return sendError(res, err);
  }
}

// ─── GET /v2/games/:sport ─────────────────────────────────────────────────────

async function getGamesBySport(req, res) {
  const sportParam = String(req.params.sport || '').toLowerCase();
  const service = getService(sportParam);
  if (!service) {
    return res.status(400).json({
      error: `Unsupported sport: ${sportParam}`,
      supported: Object.keys(SERVICES)
    });
  }

  try {
    const raw = await service.getGames();
    const games = (raw || []).map(g => g instanceof Game ? g.toJSON() : g);
    games.sort((a, b) => {
      const ta = a.startTime ? Date.parse(a.startTime) : Infinity;
      const tb = b.startTime ? Date.parse(b.startTime) : Infinity;
      return ta - tb;
    });
    return res.json(games);
  } catch (err) {
    return sendError(res, err);
  }
}

// ─── GET /v2/games/:sport/:league ─────────────────────────────────────────────

async function getGamesBySportAndLeague(req, res) {
  const sportParam = String(req.params.sport || '').toLowerCase();
  const leagueParam = String(req.params.league || '');

  if (sportParam !== 'soccer') {
    // For non-soccer sports, league == sport name — just return all games
    const service = getService(sportParam);
    if (!service) {
      return res.status(400).json({ error: `Unsupported sport: ${sportParam}` });
    }
    try {
      const raw = await service.getGames();
      const games = (raw || []).map(g => g instanceof Game ? g.toJSON() : g);
      return res.json(games);
    } catch (err) {
      return sendError(res, err);
    }
  }

  // Soccer: resolve league label from param
  const leagueUpper = leagueParam.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim();
  const leagueLabel = SOCCER_LEAGUES.find(l =>
    l.toUpperCase() === leagueUpper ||
    l.toUpperCase().replace(/[^A-Z0-9]/g, '') === leagueUpper.replace(/[^A-Z0-9]/g, '')
  );

  if (!leagueLabel) {
    return res.status(400).json({
      error: `Unknown soccer league: ${leagueParam}`,
      supported: SOCCER_LEAGUES
    });
  }

  try {
    const soccerService = getService('soccer');
    const raw = await soccerService.getGames(leagueLabel);
    const games = (raw || []).map(g => g instanceof Game ? g.toJSON() : g);
    return res.json(games);
  } catch (err) {
    return sendError(res, err);
  }
}

// ─── GET /v2/games/leagues – list available leagues per sport ─────────────────

async function getLeagues(req, res) {
  return res.json({
    nba: ['NBA'],
    nfl: ['NFL'],
    nhl: ['NHL'],
    mlb: ['MLB'],
    soccer: SOCCER_LEAGUES
  });
}

module.exports = {
  getAllGames,
  getGamesBySport,
  getGamesBySportAndLeague,
  getLeagues
};
