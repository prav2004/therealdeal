/**
 * Unified Game Model
 * ------------------
 * Canonical schema every sport service must produce.  Normalizes data from
 * different APIs (API-Sports, SportsDataIO) into a single shape consumed by
 * the frontend and the games controller.
 *
 * Schema:
 *   sport       – uppercase sport key (NBA, NFL, NHL, MLB, SOCCER)
 *   league      – league label (e.g. EPL, La Liga, MLS, NBA, NFL, NHL, MLB)
 *   game_id     – unique string identifier from the source API
 *   home_team   – home team name
 *   away_team   – away team name
 *   start_time  – ISO-8601 UTC string
 *   status      – one of: scheduled, live, final, postponed, unknown
 *   score       – { home: number|null, away: number|null }
 *   odds        – { moneyline: {}, spread: {}, totals: {} }
 *   meta        – optional bag for extra data (records, recent form, etc.)
 */

const VALID_SPORTS = new Set(['NBA', 'NFL', 'NHL', 'MLB', 'SOCCER']);

const STATUS_MAP = {
  scheduled: 'scheduled',
  'not started': 'scheduled',
  'pre-game': 'scheduled',
  pregame: 'scheduled',
  upcoming: 'scheduled',
  ns: 'scheduled',
  inprogress: 'live',
  'in progress': 'live',
  live: 'live',
  q1: 'live', q2: 'live', q3: 'live', q4: 'live',
  '1h': 'live', '2h': 'live', ht: 'live', halftime: 'live',
  et: 'live', ot: 'live', bt: 'live',
  final: 'final',
  f: 'final',
  'f/ot': 'final',
  closed: 'final',
  canceled: 'postponed',
  cancelled: 'postponed',
  postponed: 'postponed',
  suspended: 'postponed'
};

function normalizeStatus(raw) {
  const key = String(raw || '').toLowerCase().trim();
  return STATUS_MAP[key] || 'unknown';
}

class Game {
  constructor({
    sport,
    league,
    game_id,
    home_team,
    away_team,
    start_time,
    status,
    score,
    odds,
    meta
  }) {
    this.sport = String(sport || '').toUpperCase();
    this.league = league || this.sport;
    this.game_id = String(game_id || '');
    this.home_team = String(home_team || '');
    this.away_team = String(away_team || '');
    this.start_time = start_time || null;
    this.status = normalizeStatus(status);
    this.score = Object.assign({ home: null, away: null }, score || {});
    this.odds = Object.assign(
      { moneyline: {}, spread: {}, totals: {} },
      odds || {}
    );
    this.meta = meta || {};
  }

  /**
   * Return the plain-object shape expected by the existing frontend.
   * Keeps backward compatibility with the current /api/games/:sport response.
   */
  toJSON() {
    return {
      sport: this.sport,
      league: this.league,
      gameId: this.game_id,
      startTime: this.start_time,
      status: this.status,
      homeTeam: this.home_team,
      awayTeam: this.away_team,
      homeTeamRecord: this.meta.homeTeamRecord || '',
      awayTeamRecord: this.meta.awayTeamRecord || '',
      recentForm: {
        home: (this.meta.homeForm || []).slice(0, 5),
        away: (this.meta.awayForm || []).slice(0, 5)
      },
      score: this.score,
      odds: {
        moneyline: this.odds.moneyline || {},
        spread: this.odds.spread || {},
        totals: this.odds.totals || {}
      }
    };
  }

  /**
   * Convenience: create a Game from a SportsDataIO game object + odds/meta.
   */
  static fromSportsDataIO(sport, game, { oddsData, league, teamRecords, formMap } = {}) {
    const readStat = Game._readStat;
    const gameId = readStat(game, ['GameID', 'GameId', 'GameKey']);
    const startRaw = readStat(game, ['DateTime', 'DateTimeUTC', 'Day', 'GameDate', 'DateTimeLocal', 'StartTime', 'StartTimeUTC']);
    const startDate = startRaw ? new Date(startRaw) : null;
    const startTime = startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null;
    const homeTeam = readStat(game, ['HomeTeamName', 'HomeTeam', 'HomeTeamKey', 'HomeTeamAbbreviation']);
    const awayTeam = readStat(game, ['AwayTeamName', 'AwayTeam', 'AwayTeamKey', 'AwayTeamAbbreviation']);
    const status = readStat(game, ['Status', 'GameStatus', 'StatusType', 'StatusName']);
    const homeScore = readStat(game, ['HomeTeamScore', 'HomeScore', 'HomeScoreTotal']);
    const awayScore = readStat(game, ['AwayTeamScore', 'AwayScore', 'AwayScoreTotal']);

    const normalizeKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const homeKey = normalizeKey(homeTeam);
    const awayKey = normalizeKey(awayTeam);

    return new Game({
      sport: String(sport || '').toUpperCase(),
      league: league || String(sport || '').toUpperCase(),
      game_id: gameId,
      home_team: homeTeam,
      away_team: awayTeam,
      start_time: startTime,
      status: status,
      score: {
        home: homeScore != null ? Number(homeScore) : null,
        away: awayScore != null ? Number(awayScore) : null
      },
      odds: oddsData || { moneyline: {}, spread: {}, totals: {} },
      meta: {
        homeTeamRecord: teamRecords ? (teamRecords.get(homeKey) || '') : '',
        awayTeamRecord: teamRecords ? (teamRecords.get(awayKey) || '') : '',
        homeForm: formMap ? (formMap.get(homeKey) || []) : [],
        awayForm: formMap ? (formMap.get(awayKey) || []) : []
      }
    });
  }

  /**
   * Create from API-Sports (basketball) response item + odds.
   */
  static fromApiSports(game, { oddsData, teamRecords, formMap } = {}) {
    const teams = game.teams || {};
    const scores = game.scores || {};
    const homeTeam = (teams.home && teams.home.name) || '';
    const awayTeam = (teams.away && teams.away.name) || '';
    const homeScore = scores.home && scores.home.total;
    const awayScore = scores.away && scores.away.total;

    const normalizeKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const homeKey = normalizeKey(homeTeam);
    const awayKey = normalizeKey(awayTeam);

    const statusRaw = game.status && game.status.long
      ? game.status.long
      : (game.status && game.status.short) || '';

    return new Game({
      sport: 'NBA',
      league: 'NBA',
      game_id: String(game.id || ''),
      home_team: homeTeam,
      away_team: awayTeam,
      start_time: game.date ? new Date(game.date).toISOString() : null,
      status: statusRaw,
      score: {
        home: homeScore != null ? Number(homeScore) : null,
        away: awayScore != null ? Number(awayScore) : null
      },
      odds: oddsData || { moneyline: {}, spread: {}, totals: {} },
      meta: {
        homeTeamRecord: teamRecords ? (teamRecords.get(homeKey) || '') : '',
        awayTeamRecord: teamRecords ? (teamRecords.get(awayKey) || '') : '',
        homeForm: formMap ? (formMap.get(homeKey) || []) : [],
        awayForm: formMap ? (formMap.get(awayKey) || []) : []
      }
    });
  }

  /**
   * Utility: extract first defined value from an object given a list of
   * possible keys.  Mirrors the server.js readStat helper.
   */
  static _readStat(obj, keys) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    }
    return undefined;
  }
}

module.exports = { Game, normalizeStatus, VALID_SPORTS };
