/**
 * Games Routes (v2)
 * ─────────────────
 * New modular routes alongside legacy /api/games/:sport endpoints.
 *
 *   GET /v2/games              – all sports, all games
 *   GET /v2/games/leagues      – available leagues per sport
 *   GET /v2/games/:sport       – games for a single sport
 *   GET /v2/games/:sport/:league – games for a specific league
 *
 * These routes re-use the same auth middleware from the main app.
 * The router is mounted in server.js and passed the middleware at mount time.
 */

const express = require('express');
const {
  getAllGames,
  getGamesBySport,
  getGamesBySportAndLeague,
  getLeagues
} = require('../controllers/gamesController');

/**
 * Create the router. Accepts auth + profile middleware from server.js
 * so this module stays decoupled from auth implementation.
 *
 * @param {Function} authMiddleware
 * @param {Function} ensureProfileComplete
 */
function createRouter(authMiddleware, ensureProfileComplete) {
  const router = express.Router();

  // List available leagues
  router.get('/leagues', getLeagues);

  // All games across all sports
  router.get('/', getAllGames);

  // Games for a single sport
  router.get('/:sport', getGamesBySport);

  // Games for a specific league within a sport
  router.get('/:sport/:league', getGamesBySportAndLeague);

  return router;
}

module.exports = { createRouter };
