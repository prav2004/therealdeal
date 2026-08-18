/**
 * Recommendation Engine
 * ─────────────────────
 * Fetches real ESPN gamelog + schedule data, computes per-prop
 * confidence scores using last-5 / last-10 / season hit rates,
 * Poisson CDF (counting stats) and Normal CDF (continuous stats),
 * and returns structured prop recommendations.
 *
 * DISCLAIMER: For virtual-token practice only.
 * Recommendations are trend-based and NOT guaranteed.
 */

'use strict';

const axios = require('axios');

// ─── ESPN sport paths ────────────────────────────────────────────────────────
const ESPN_SPORT_PATH = {
  nba:    'basketball/nba',
  nfl:    'football/nfl',
  nhl:    'hockey/nhl',
  mlb:    'baseball/mlb',
  soccer: 'soccer/usa.1',      // MLS default; caller can override
};

// ─── Prop types per sport ────────────────────────────────────────────────────
const PROP_TYPES = {
  nba: [
    { key: 'points',     label: 'Points',          discrete: false, espnStat: 'PTS' },
    { key: 'rebounds',   label: 'Rebounds',         discrete: true,  espnStat: 'REB' },
    { key: 'assists',    label: 'Assists',           discrete: true,  espnStat: 'AST' },
    { key: '3pm',        label: '3-Pointers Made',  discrete: true,  espnStat: '3PM' },
  ],
  nfl: [
    { key: 'passYds',  label: 'Passing Yards',    discrete: false, espnStat: 'PYDS',  positions: ['QB'] },
    { key: 'rushYds',  label: 'Rushing Yards',    discrete: false, espnStat: 'RYDS',  positions: ['RB','QB'] },
    { key: 'recYds',   label: 'Receiving Yards',  discrete: false, espnStat: 'RECYDS',positions: ['WR','TE','RB'] },
    { key: 'passTD',   label: 'Passing TDs',      discrete: true,  espnStat: 'PTD',   positions: ['QB'], highRisk: true },
    { key: 'anyTD',    label: 'Anytime TD',       discrete: true,  espnStat: 'TD',    highRisk: true },
  ],
  nhl: [
    { key: 'points',  label: 'Points (G+A)',      discrete: true,  espnStat: 'PTS' },
    { key: 'shots',   label: 'Shots on Goal',     discrete: true,  espnStat: 'SOG' },
    { key: 'goals',   label: 'Goals',             discrete: true,  espnStat: 'G',   highRisk: true },
    { key: 'saves',   label: 'Goalie Saves',      discrete: true,  espnStat: 'SV',  positions: ['G'] },
  ],
  mlb: [
    { key: 'hits',     label: 'Hits',              discrete: true,  espnStat: 'H' },
    { key: 'totBases', label: 'Total Bases',        discrete: true,  espnStat: 'TB' },
    { key: 'strikeouts',label:'Strikeouts',          discrete: true,  espnStat: 'K',  positions: ['SP','RP'] },
    { key: 'runs',     label: 'Runs',               discrete: true,  espnStat: 'R' },
  ],
  soccer: [
    { key: 'goals',   label: 'Goals',              discrete: true,  espnStat: 'G' },
    { key: 'shots',   label: 'Shots',              discrete: true,  espnStat: 'SH' },
    { key: 'sot',     label: 'Shots on Target',    discrete: true,  espnStat: 'SOT' },
  ],
};

// ─── In-memory cache ─────────────────────────────────────────────────────────
const _cache = new Map();
function cacheGet(k) { const e = _cache.get(k); if (e && Date.now() < e.exp) return e.v; _cache.delete(k); return null; }
function cacheSet(k, v, ttlMs) { _cache.set(k, { v, exp: Date.now() + ttlMs }); }

// ─── ESPN fetch helpers ───────────────────────────────────────────────────────
async function espnFetch(url, ttlMs = 300000) {
  const cached = cacheGet(url);
  if (cached) return cached;
  try {
    const resp = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Pickr-App/1.0)' },
    });
    cacheSet(url, resp.data, ttlMs);
    return resp.data;
  } catch (err) {
    console.warn(`ESPN fetch failed: ${url} — ${err.message}`);
    return null;
  }
}

/**
 * Fetch today's scoreboard for a sport.
 * Returns array of event objects.
 */
async function fetchSchedule(sport) {
  const path = ESPN_SPORT_PATH[sport];
  if (!path) return [];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;
  const data = await espnFetch(url, 180000); // 3 min cache
  return data?.events || [];
}

/**
 * Fetch team roster (athletes + IDs) for a team by ESPN team ID.
 */
async function fetchRoster(sport, teamId) {
  const path = ESPN_SPORT_PATH[sport];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/roster`;
  const data = await espnFetch(url, 900000); // 15 min cache
  if (!data?.athletes) return [];

  const athletes = [];
  const groups = Array.isArray(data.athletes) ? data.athletes : Object.values(data.athletes);
  for (const grp of groups) {
    const items = grp.items || (Array.isArray(grp) ? grp : []);
    for (const a of items) {
      athletes.push({
        id: a.id,
        name: a.fullName || a.displayName || '',
        position: a.position?.abbreviation || '',
        status: a.status?.type || 'active',
      });
    }
  }
  return athletes;
}

/**
 * Fetch gamelog for a player.
 * Returns an object keyed by stat abbreviation → array of per-game values (most-recent last).
 */
async function fetchGameLog(sport, athleteId) {
  if (!athleteId) return {};
  const path = ESPN_SPORT_PATH[sport];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/athletes/${athleteId}/gamelog`;
  const data = await espnFetch(url, 1800000); // 30 min cache

  if (!data) return {};

  // ESPN gamelog returns seasonTypes → categories → events
  const result = {};

  const seasonTypes = data.seasonTypes || [];
  for (const st of seasonTypes) {
    if (!st.categories) continue;
    for (const cat of st.categories) {
      const names = cat.names || [];         // stat abbreviation array
      const events = cat.events || [];
      for (const ev of events) {
        const vals = ev.stats || [];
        names.forEach((name, i) => {
          if (!result[name]) result[name] = [];
          const v = parseFloat(vals[i]);
          if (!isNaN(v)) result[name].push(v);
        });
      }
    }
  }

  return result;
}

/**
 * Fetch season averages for a player.
 */
async function fetchSeasonStats(sport, athleteId) {
  if (!athleteId) return {};
  const path = ESPN_SPORT_PATH[sport];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/athletes/${athleteId}/statistics`;
  const data = await espnFetch(url, 3600000); // 1 hr cache

  const result = {};
  const splits = data?.splits?.categories || [];
  for (const cat of splits) {
    for (const stat of (cat.stats || [])) {
      if (stat.name) result[stat.name] = parseFloat(stat.value) || 0;
    }
  }
  return result;
}

// ─── Probability Math ─────────────────────────────────────────────────────────

/** Log-factorial (Stirling not needed for k < 50) */
function logFact(k) {
  let r = 0;
  for (let i = 2; i <= k; i++) r += Math.log(i);
  return r;
}

/** Poisson CDF: P(X <= floor(line) | lambda=mu) */
function poissonCDF(line, mu) {
  if (mu <= 0) return line >= 0 ? 1 : 0;
  let s = 0;
  for (let k = 0; k <= Math.floor(line); k++) {
    s += Math.exp(k * Math.log(mu) - mu - logFact(k));
  }
  return Math.min(s, 1);
}

/** Normal CDF P(Z <= z) */
function normCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const phi = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? phi : 1 - phi;
}

/** Weighted mean — recent games count 2× */
function weightedMean(arr) {
  if (!arr || !arr.length) return 0;
  let wSum = 0, vSum = 0;
  for (let i = 0; i < arr.length; i++) {
    const w = i >= arr.length - 5 ? 2 : 1;
    vSum += arr[i] * w; wSum += w;
  }
  return vSum / wSum;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr, mu) {
  if (arr.length < 2) return (mu || 1) * 0.25;
  const m = mu !== undefined ? mu : mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

/** P(X > line) using Poisson or Normal based on stat type */
function trueProb(gameLog, line, discrete) {
  if (!gameLog || gameLog.length < 3) return null;  // insufficient data
  const mu = weightedMean(gameLog);
  if (discrete) {
    return Math.max(0.02, Math.min(0.97, 1 - poissonCDF(line, mu)));
  } else {
    const sd = Math.max(stdDev(gameLog, mu), mu * 0.1);
    return Math.max(0.02, Math.min(0.97, 1 - normCDF((line - mu) / sd)));
  }
}

/** Hit rate: fraction of games where value > line */
function hitRate(arr, line) {
  if (!arr || !arr.length) return 0;
  return arr.filter(v => v > line).length / arr.length;
}

// ─── Line estimation ──────────────────────────────────────────────────────────
function estimateLine(arr) {
  if (!arr || !arr.length) return null;
  const mu = mean(arr);
  // Round to nearest .5 just below mean — typical sportsbook placement
  return Math.max(0.5, Math.floor(mu * 2) / 2 - 0.5);
}

// ─── Opponent weakness score ──────────────────────────────────────────────────
// Compares opponent's allowed avg for this stat against league average.
// Returns 0-1 (1 = worst defense = best for bettor)
const LEAGUE_ALLOWED = {
  nba:  { points: 112, rebounds: 43, assists: 25, '3pm': 12 },
  nfl:  { passYds: 240, rushYds: 110, recYds: 70 },
  nhl:  { shots: 30, points: 3, goals: 3 },
  mlb:  { hits: 8.5, strikeouts: 8, runs: 4.5 },
  soccer: { goals: 1.3, shots: 12, sot: 5 },
};
function opponentScore(sport, statKey, opponentAllowed) {
  const base = LEAGUE_ALLOWED[sport]?.[statKey];
  if (!base || !opponentAllowed) return 0.5;
  // Higher allowed = weaker defense = higher score for bettor
  return Math.min(1, Math.max(0, (opponentAllowed / base) * 0.5));
}

// ─── Usage / minutes trend ────────────────────────────────────────────────────
// Returns 0-1 score. 1 = usage trending up significantly.
function usageTrendScore(minutesLog) {
  if (!minutesLog || minutesLog.length < 4) return 0.5;
  const last3 = mean(minutesLog.slice(-3));
  const prev = mean(minutesLog.slice(-8, -3));
  if (!prev) return 0.5;
  const delta = (last3 - prev) / prev;
  return Math.min(1, Math.max(0, 0.5 + delta * 2));
}

// ─── Confidence score ─────────────────────────────────────────────────────────
function confidenceScore({ last5HR, last10HR, seasonHR, oppScore, usageScore }) {
  return (
    (last5HR   || 0) * 0.35 +
    (last10HR  || 0) * 0.25 +
    (seasonHR  || 0) * 0.15 +
    (oppScore  || 0.5) * 0.15 +
    (usageScore|| 0.5) * 0.10
  ) * 100;
}

function riskLevel(conf, last10HR, highRisk) {
  if (highRisk) return 'High';
  if (conf >= 80 && last10HR >= 0.70) return 'Low';
  if (conf >= 68) return 'Medium';
  return 'High';
}

// ─── Recommendation label ─────────────────────────────────────────────────────
function confLabel(conf) {
  if (conf >= 80) return 'High Confidence';
  if (conf >= 70) return 'Recommended';
  return 'Trend-Based Pick';
}

// ─── Explanation builder ──────────────────────────────────────────────────────
function buildExplanation({ playerName, propLabel, line, last5, last10, season, conf, risk, recentAvg }) {
  const l5 = Math.round(last5 * 100);
  const l10 = Math.round(last10 * 100);
  const parts = [
    `${playerName} has cleared ${line} ${propLabel} in ${l5}% of last 5 games and ${l10}% of last 10 games.`,
    `Season average: ${recentAvg?.toFixed(1) || '—'}.`,
    `Confidence: ${Math.round(conf)}/100.`,
    `Risk: ${risk}.`,
  ];
  if (l5 >= 70) parts.push('Recent trend is strong.');
  if (risk === 'Low') parts.push('This is a high-confidence trend pick.');
  parts.push('Trend-based recommendation — not guaranteed.');
  return parts.join(' ');
}

// ─── Main engine function ─────────────────────────────────────────────────────

/**
 * Generate prop recommendations for a given sport.
 * @param {string} sport  nba | nfl | nhl | mlb | soccer
 * @param {object} opts   { homeTeamId, awayTeamId, homeTeam, awayTeam, maxProps }
 * @returns {Promise<Array>} sorted prop recommendation objects
 */
async function generateProps(sport, opts = {}) {
  const {
    homeTeamId,
    awayTeamId,
    homeTeam = 'Home',
    awayTeam = 'Away',
    maxProps = 20,
  } = opts;

  const propDefs = PROP_TYPES[sport] || PROP_TYPES.nba;
  const results = [];

  // Collect roster for both teams
  let players = [];
  const teamMap = {};
  for (const [teamId, teamName] of [[homeTeamId, homeTeam], [awayTeamId, awayTeam]]) {
    if (!teamId) continue;
    const roster = await fetchRoster(sport, teamId);
    for (const p of roster) {
      p.teamName = teamName;
      p.teamId = teamId;
      teamMap[p.id] = p;
      players.push(p);
    }
  }

  // If no roster data, use fallback static player list for sport
  if (!players.length) {
    players = getFallbackPlayers(sport, homeTeam, awayTeam);
  }

  // Filter: skip injured players
  players = players.filter(p => !['injured','out','ir'].includes((p.status || '').toLowerCase()));

  // Limit to top-N players per team to avoid too many API calls
  const MAX_PLAYERS = 20;
  players = players.slice(0, MAX_PLAYERS);

  // Fetch gamelogs in parallel
  const logCache = {};
  await Promise.allSettled(players.map(async (p) => {
    logCache[p.id] = await fetchGameLog(sport, p.id);
  }));

  // Generate props
  for (const player of players) {
    const logs = logCache[player.id] || {};
    const minutesLog = logs['MIN'] || logs['TMP'] || [];

    for (const propDef of propDefs) {
      // Position filter
      if (propDef.positions && propDef.positions.length) {
        if (!propDef.positions.some(pos => (player.position || '').toUpperCase().includes(pos))) continue;
      }

      const statLog = logs[propDef.espnStat] || [];
      if (statLog.length < 3) continue; // not enough data

      const last5Log  = statLog.slice(-5);
      const last10Log = statLog.slice(-10);
      const fullLog   = statLog;

      const line = estimateLine(fullLog);
      if (line === null || line <= 0) continue;

      const recentAvg = weightedMean(statLog);
      const last5HR   = hitRate(last5Log, line);
      const last10HR  = hitRate(last10Log, line);
      const seasonHR  = hitRate(fullLog, line);
      const tp        = trueProb(statLog, line, propDef.discrete);
      if (!tp) continue;

      const usageScore = usageTrendScore(minutesLog);
      const oppScore   = 0.5; // without opponent gamelog data default to neutral
      const conf       = confidenceScore({ last5HR, last10HR, seasonHR, oppScore, usageScore });

      // Filter: require confidence >= 60
      if (conf < 60) continue;

      const risk  = riskLevel(conf, last10HR, propDef.highRisk);
      const label = confLabel(conf);
      const edge  = Math.round((tp - 0.524) * 100); // vs -110 implied

      results.push({
        id: `${player.id}-${propDef.key}`,
        playerName:   player.name,
        team:         player.teamName,
        position:     player.position,
        propType:     propDef.label,
        propKey:      propDef.key,
        line,
        recentAvg:    parseFloat(recentAvg.toFixed(1)),
        last5HitRate: parseFloat(last5HR.toFixed(3)),
        last10HitRate:parseFloat(last10HR.toFixed(3)),
        seasonHitRate:parseFloat(seasonHR.toFixed(3)),
        trueProb:     parseFloat(tp.toFixed(3)),
        edge,
        confidenceScore: Math.round(conf),
        riskLevel:    risk,
        label,
        trend5:       last5Log.map(v => v > line ? 1 : 0),
        trend10:      last10Log.map(v => v > line ? 1 : 0),
        streak:       calcStreak(statLog, line),
        explanation:  buildExplanation({
          playerName: player.name, propLabel: propDef.label, line,
          last5: last5HR, last10: last10HR, season: seasonHR,
          conf, risk, recentAvg,
        }),
        dataSource:   'espn-live',
        highRisk:     !!propDef.highRisk,
      });
    }
  }

  // Sort by confidence desc
  results.sort((a, b) => b.confidenceScore - a.confidenceScore);
  return results.slice(0, maxProps);
}

function calcStreak(log, line) {
  let s = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i] > line) s++; else break;
  }
  return s;
}

// ─── Fallback static players ──────────────────────────────────────────────────
// Used when roster fetch fails. Contains ESPN IDs + realistic 2025-26 stats.
const FALLBACK_PLAYERS = {
  nba: [
    { id: '4278086', name: 'Shai Gilgeous-Alexander', position: 'PG', status: 'active',
      _mock: { PTS:[34,29,38,27,33,31,36,28,32,35,30,29], REB:[5,3,6,4,5,4,5,3,4,5,6,4], AST:[6,8,5,7,4,6,7,5,6,5,4,7], '3PM':[2,1,3,2,1,3,2,1,2,3,1,2], MIN:[36,35,37,34,36,35,36,34,35,37,36,34] } },
    { id: '3112335', name: 'Nikola Jokic', position: 'C', status: 'active',
      _mock: { PTS:[29,32,26,31,28,30,27,33,25,29,31,28], REB:[13,15,11,14,12,13,14,10,12,14,13,15], AST:[9,11,8,10,9,10,8,12,9,10,9,11], MIN:[34,35,33,36,34,35,33,36,34,35,34,35] } },
    { id: '3032977', name: 'Giannis Antetokounmpo', position: 'PF', status: 'active',
      _mock: { PTS:[31,27,35,29,33,30,28,32,26,30,34,29], REB:[12,10,14,11,13,12,10,14,11,12,13,11], AST:[7,5,8,6,7,6,5,7,6,7,8,6], MIN:[34,32,36,33,34,33,32,35,33,34,33,35] } },
    { id: '4395725', name: 'Anthony Edwards', position: 'SG', status: 'active',
      _mock: { PTS:[28,25,31,27,29,26,30,24,28,27,32,25], REB:[6,4,7,5,6,5,4,6,5,6,7,5], AST:[5,6,4,7,5,6,5,7,4,5,6,5], '3PM':[4,2,5,3,4,3,5,2,4,3,4,3], MIN:[36,34,37,35,36,34,36,33,35,36,35,34] } },
    { id: '4065670', name: 'Jayson Tatum', position: 'SF', status: 'active',
      _mock: { PTS:[27,31,25,29,28,26,30,24,28,27,29,26], REB:[8,6,9,7,8,7,9,6,8,7,8,9], AST:[5,4,6,5,4,5,6,4,5,5,4,6], '3PM':[3,2,4,3,3,2,4,2,3,3,4,3], MIN:[36,35,37,35,36,34,36,34,35,36,35,36] } },
    { id: '4065648', name: 'Luka Doncic', position: 'PG', status: 'active',
      _mock: { PTS:[30,34,27,32,29,31,28,35,26,30,33,29], REB:[9,7,11,8,9,8,10,7,9,8,9,10], AST:[9,11,8,10,9,8,11,9,8,9,10,9], '3PM':[4,3,5,3,4,3,4,3,5,4,3,4], MIN:[37,36,38,35,37,36,37,35,36,37,36,37] } },
    { id: '3975',    name: 'Stephen Curry',   position: 'PG', status: 'active',
      _mock: { PTS:[28,24,31,26,29,25,30,23,27,26,30,25], REB:[5,4,6,4,5,4,5,3,4,5,5,4], AST:[5,6,5,7,5,6,5,6,4,5,6,5], '3PM':[5,4,6,4,5,4,6,3,5,5,6,4], MIN:[34,33,35,32,34,32,35,31,33,34,33,34] } },
    { id: '4431681', name: 'Tyrese Haliburton', position: 'PG', status: 'active',
      _mock: { PTS:[22,19,25,21,23,20,24,18,22,21,24,20], AST:[12,14,11,13,12,11,14,10,12,13,11,12], '3PM':[3,4,3,4,3,3,4,2,3,4,3,3], MIN:[34,33,35,32,34,33,34,32,33,34,33,34] } },
  ],
  nfl: [
    { id: '3139477', name: 'Patrick Mahomes', position: 'QB', status: 'active',
      _mock: { PYDS:[312,268,345,289,301,274,328,255,294,305,285,318], PTD:[3,2,4,3,2,3,4,2,3,3,2,4], RYDS:[28,15,35,22,18,30,12,25,20,18,22,15] } },
    { id: '3918298', name: 'Josh Allen',      position: 'QB', status: 'active',
      _mock: { PYDS:[295,278,312,260,285,271,305,248,280,293,270,300], PTD:[3,2,3,2,2,3,3,2,2,3,2,3], RYDS:[45,38,52,35,48,42,55,30,44,47,36,50] } },
    { id: '3916387', name: 'Lamar Jackson',   position: 'QB', status: 'active',
      _mock: { PYDS:[255,238,278,245,260,248,270,232,253,262,241,268], PTD:[2,3,2,3,2,3,2,2,3,2,3,2], RYDS:[72,58,85,65,70,62,80,55,68,74,60,78] } },
    { id: '4262921', name: 'Justin Jefferson', position: 'WR', status: 'active',
      _mock: { RECYDS:[95,72,112,84,98,78,105,68,90,96,75,102], MIN:[45,42,47,40,44,41,46,38,43,45,41,46] } },
    { id: '3054211', name: 'Tyreek Hill',      position: 'WR', status: 'active',
      _mock: { RECYDS:[102,78,118,88,105,82,112,72,96,104,80,110], MIN:[44,41,46,39,43,40,45,37,42,44,40,45] } },
  ],
  nhl: [
    { id: '3895074', name: 'Connor McDavid', position: 'C', status: 'active',
      _mock: { PTS:[1,2,1,0,2,1,1,2,0,1,2,1], SOG:[5,7,4,6,5,6,4,7,5,5,6,4] } },
    { id: '3114727', name: 'Nathan MacKinnon', position: 'C', status: 'active',
      _mock: { PTS:[1,1,0,2,1,1,0,1,2,1,0,1], SOG:[6,5,4,7,5,6,4,6,5,5,6,5] } },
    { id: null,      name: 'Nikita Kucherov', position: 'RW', status: 'active',
      _mock: { PTS:[2,1,0,1,2,1,1,0,1,2,1,1], SOG:[4,5,3,5,4,5,3,4,5,4,5,4] } },
    { id: null,      name: 'Leon Draisaitl',  position: 'C',  status: 'active',
      _mock: { PTS:[1,1,2,0,1,1,0,2,1,1,0,1], SOG:[5,4,6,4,5,5,4,5,4,5,4,5] } },
  ],
  mlb: [
    { id: '39949',   name: 'Shohei Ohtani',   position: 'DH', status: 'active',
      _mock: { H:[1,2,1,0,1,2,1,1,0,2,1,1], TB:[2,4,2,0,2,3,2,1,0,4,2,3] } },
    { id: '30836',   name: 'Freddie Freeman',  position: '1B', status: 'active',
      _mock: { H:[1,1,2,0,1,1,1,2,0,1,1,2], TB:[2,2,3,0,2,2,2,3,0,2,2,3] } },
    { id: '33039',   name: 'Mookie Betts',     position: 'RF', status: 'active',
      _mock: { H:[1,0,2,1,1,0,1,2,1,1,0,1], TB:[2,0,3,2,2,0,2,3,2,2,1,2] } },
    { id: null,      name: 'Juan Soto',        position: 'LF', status: 'active',
      _mock: { H:[1,2,0,1,1,2,0,1,1,1,2,0], TB:[2,3,0,2,2,3,0,2,2,2,3,0] } },
  ],
  soccer: [
    { id: null, name: 'Lionel Messi',    position: 'F', status: 'active',
      _mock: { G:[0,1,0,0,1,0,1,0,0,1,0,1], SH:[4,3,5,2,4,3,4,2,3,4,3,4], SOT:[2,2,3,1,2,2,2,1,2,2,2,2] } },
    { id: null, name: 'Lorenzo Insigne', position: 'F', status: 'active',
      _mock: { G:[0,0,1,0,0,1,0,0,1,0,0,1], SH:[3,2,4,2,3,3,2,2,3,3,2,3], SOT:[1,1,2,1,1,2,1,1,1,1,1,2] } },
  ],
};

function getFallbackPlayers(sport, homeTeam, awayTeam) {
  const pool = FALLBACK_PLAYERS[sport] || FALLBACK_PLAYERS.nba;
  // Inject mock logs as gamelog data
  return pool.map((p, i) => ({
    ...p,
    teamName: i % 2 === 0 ? homeTeam : awayTeam,
    _mockLogs: p._mock,
  }));
}

// ─── Override fetchGameLog for mock-log players ───────────────────────────────
const _realFetchGameLog = fetchGameLog;
async function fetchGameLogWithMock(sport, athleteId, player) {
  if (player && player._mockLogs) {
    // Use mock logs as the gamelog
    return player._mockLogs;
  }
  return await _realFetchGameLog(sport, athleteId);
}

/**
 * Public API: generate props using ESPN ID-aware path
 */
async function generatePropsForGame(sport, opts = {}) {
  const {
    homeTeamId,
    awayTeamId,
    homeTeam = 'Home',
    awayTeam = 'Away',
    maxProps = 20,
  } = opts;

  const propDefs = PROP_TYPES[sport] || PROP_TYPES.nba;
  const results = [];

  let players = [];
  if (homeTeamId || awayTeamId) {
    for (const [teamId, teamName] of [[homeTeamId, homeTeam], [awayTeamId, awayTeam]]) {
      if (!teamId) continue;
      const roster = await fetchRoster(sport, teamId);
      for (const p of roster) { players.push({ ...p, teamName }); }
    }
  }

  if (!players.length) {
    players = getFallbackPlayers(sport, homeTeam, awayTeam);
  }

  players = players.filter(p => !['injured','out','ir'].includes((p.status || '').toLowerCase()));
  players = players.slice(0, 24);

  const logCache = {};
  await Promise.allSettled(players.map(async (p) => {
    logCache[p.id || p.name] = await fetchGameLogWithMock(sport, p.id, p);
  }));

  for (const player of players) {
    const logs = logCache[player.id || player.name] || {};
    const minutesLog = logs['MIN'] || logs['TMP'] || [];

    for (const propDef of propDefs) {
      if (propDef.positions && propDef.positions.length) {
        if (!propDef.positions.some(pos => (player.position || '').toUpperCase().includes(pos))) continue;
      }

      const statLog = logs[propDef.espnStat] || [];
      if (statLog.length < 3) continue;

      const last5Log  = statLog.slice(-5);
      const last10Log = statLog.slice(-10);

      const line = estimateLine(statLog);
      if (line === null || line <= 0) continue;

      const recentAvg  = weightedMean(statLog);
      const last5HR    = hitRate(last5Log, line);
      const last10HR   = hitRate(last10Log, line);
      const seasonHR   = hitRate(statLog, line);
      const tp         = trueProb(statLog, line, propDef.discrete);
      if (!tp) continue;

      const usageScore = usageTrendScore(minutesLog);
      const conf       = confidenceScore({ last5HR, last10HR, seasonHR, oppScore: 0.5, usageScore });
      if (conf < 60) continue;

      const risk  = riskLevel(conf, last10HR, propDef.highRisk);
      const label = confLabel(conf);
      const edge  = Math.round((tp - 0.524) * 100);

      // American odds from true prob with ~9% vig
      const decOdds = 1 / Math.max(0.01, tp) * 0.91;
      const am = decOdds >= 2
        ? '+' + Math.round((decOdds - 1) * 100)
        : '-' + Math.round(100 / (decOdds - 1));

      results.push({
        id: `${player.id || player.name}-${propDef.key}`,
        playerName:    player.name,
        team:          player.teamName,
        position:      player.position,
        propType:      propDef.label,
        propKey:       propDef.key,
        line,
        recentAvg:     parseFloat(recentAvg.toFixed(1)),
        last5HitRate:  parseFloat(last5HR.toFixed(3)),
        last10HitRate: parseFloat(last10HR.toFixed(3)),
        seasonHitRate: parseFloat(seasonHR.toFixed(3)),
        trueProb:      parseFloat(tp.toFixed(3)),
        decimalOdds:   parseFloat(decOdds.toFixed(3)),
        americanOdds:  am,
        edge,
        confidenceScore: Math.round(conf),
        riskLevel:     risk,
        label,
        trend5:        last5Log.map(v => v > line ? 1 : 0),
        trend10:       last10Log.map(v => v > line ? 1 : 0),
        streak:        calcStreak(statLog, line),
        explanation:   buildExplanation({
          playerName: player.name, propLabel: propDef.label, line,
          last5: last5HR, last10: last10HR, season: seasonHR,
          conf, risk, recentAvg,
        }),
        dataSource: player._mockLogs ? 'estimated' : 'espn-live',
        highRisk: !!propDef.highRisk,
      });
    }
  }

  results.sort((a, b) => b.confidenceScore - a.confidenceScore);
  return results.slice(0, maxProps);
}

module.exports = {
  generatePropsForGame,
  fetchSchedule,
};
