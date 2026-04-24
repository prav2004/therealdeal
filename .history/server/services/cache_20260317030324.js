/**
 * Unified Cache Service
 * ---------------------
 * In-memory TTL cache with configurable per-key expiry.
 * Live games use shorter TTL (30-60 s), static data (teams, players) uses longer TTL.
 */

const DEFAULT_TTL = {
  liveGames: 30 * 1000,         // 30 seconds for live / in-progress games
  upcomingGames: 60 * 1000,     // 60 seconds for upcoming games
  odds: 60 * 60 * 1000,         // 1 hour for odds
  scores: 60 * 60 * 1000,       // 1 hour for scores
  teams: 12 * 60 * 60 * 1000,   // 12 hours for team rosters / standings
  players: 6 * 60 * 60 * 1000,  // 6 hours for player data
  competitions: 12 * 60 * 60 * 1000, // 12 hours for competition lists
  recentForm: 10 * 60 * 1000    // 10 minutes for recent form
};

class CacheService {
  constructor(customTTL = {}) {
    this._store = new Map();
    this.TTL = Object.assign({}, DEFAULT_TTL, customTTL);
  }

  /**
   * Get a cached value or null if expired / missing.
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Set a value with a specific TTL (ms).  Pass 0 or falsy to skip caching.
   */
  set(key, value, ttlMs) {
    if (!ttlMs) return;
    this._store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Delete a specific key.
   */
  del(key) {
    this._store.delete(key);
  }

  /**
   * Flush all entries whose keys start with the given prefix.
   */
  flush(prefix) {
    if (!prefix) {
      this._store.clear();
      return;
    }
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key);
    }
  }

  /**
   * Return current cache stats.
   */
  stats() {
    let active = 0;
    let expired = 0;
    const now = Date.now();
    for (const entry of this._store.values()) {
      if (entry.expiresAt && entry.expiresAt <= now) expired++;
      else active++;
    }
    return { active, expired, total: this._store.size };
  }
}

// Singleton instance shared across all services
const cache = new CacheService();

module.exports = { CacheService, cache, DEFAULT_TTL };
