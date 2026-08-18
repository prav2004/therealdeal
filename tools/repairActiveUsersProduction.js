#!/usr/bin/env node
const { execSync } = require('child_process');

const projectId = process.argv[2] || 'pickr-d4d9b';
const prefix = process.argv[3] || 'active-';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function token() {
  return sh('gcloud auth print-access-token');
}

function headers(t) {
  return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function fromFsValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue || 0);
  if ('doubleValue' in v) return Number(v.doubleValue || 0);
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    const out = {};
    const fields = (v.mapValue && v.mapValue.fields) || {};
    Object.keys(fields).forEach((k) => { out[k] = fromFsValue(fields[k]); });
    return out;
  }
  if ('arrayValue' in v) {
    const vals = (v.arrayValue && v.arrayValue.values) || [];
    return vals.map(fromFsValue);
  }
  return null;
}

function fsValue(v) {
  if (v === null || typeof v === 'undefined') return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: Number(v) };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map((x) => fsValue(x)) } };
  if (isObj(v)) {
    const fields = {};
    Object.keys(v).forEach((k) => { fields[k] = fsValue(v[k]); });
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const txt = await res.text();
  let data = {};
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} :: ${txt.slice(0, 300)}`);
  return data;
}

function normalizeScreenName(name, fallbackSeed) {
  const raw = String(name || '').toUpperCase().replace(/[^A-Z0-9_.]/g, '');
  if (raw.length >= 3 && raw.length <= 18) return raw;
  return `PLAYER${String(fallbackSeed).padStart(4, '0')}`;
}

function validAvatar(avatarId) {
  return /^avatar-[1-6]$/.test(String(avatarId || ''));
}

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

(async function main() {
  try {
    const t = token();
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users`;

    let pageToken = '';
    const docs = [];
    do {
      const url = `${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const data = await fetchJson(url, { headers: headers(t) });
      const arr = data.documents || [];
      docs.push(...arr);
      pageToken = data.nextPageToken || '';
    } while (pageToken);

    const active = docs.filter((d) => {
      const f = d.fields || {};
      const uid = (f.uid && f.uid.stringValue) ? f.uid.stringValue : String(d.name || '').split('/').pop();
      return String(uid).startsWith(prefix);
    });

    if (!active.length) {
      console.log('No active users found to repair.');
      process.exit(0);
    }

    const now = new Date();
    const today = dateKey(now);
    const week = isoWeekKey(now);
    const sportsPool = ['nba', 'nfl', 'nhl', 'mlb', 'soccer'];

    let repaired = 0;
    for (let i = 0; i < active.length; i += 1) {
      const doc = active[i];
      const f = doc.fields || {};
      const obj = {};
      Object.keys(f).forEach((k) => { obj[k] = fromFsValue(f[k]); });

      const uid = String(obj.uid || String(doc.name || '').split('/').pop());
      const profilePoints = clamp(Number(obj.points || rand(100, 5000)), 100, 5000);
      const profileXp = clamp(Number(obj.xp || rand(100, 5000)), 100, 5000);
      const streakWins = Math.max(0, Number(obj.streakWins || 0));

      const statsObj = isObj(obj.stats) ? obj.stats : {};
      const wins = Math.max(0, Number(statsObj.wins || rand(1, 25)));
      const losses = Math.max(0, Number(statsObj.losses || rand(0, 18)));
      const pending = Math.max(0, Number(statsObj.pending || 0));
      const totalBets = Math.max(wins + losses, Number(statsObj.totalBets || wins + losses));
      const totalParlays = Math.max(0, Number(statsObj.totalParlays || rand(0, 6)));

      const normalized = {
        uid,
        email: String(obj.email || `${uid}@pickr-users.test`),
        authProvider: String(obj.authProvider || 'google'),
        fullName: String(obj.fullName || `Player ${i + 1}`),
        screenName: normalizeScreenName(obj.screenName, i + 1),
        avatarId: validAvatar(obj.avatarId) ? String(obj.avatarId) : `avatar-${(i % 6) + 1}`,
        dateOfBirth: /^\d{4}-\d{2}-\d{2}$/.test(String(obj.dateOfBirth || '')) ? String(obj.dateOfBirth) : `${rand(1980, 2005)}-${String(rand(1,12)).padStart(2, '0')}-${String(rand(1,28)).padStart(2, '0')}`,
        ageVerified: true,
        address: {
          street: String((obj.address && obj.address.street) || `${rand(10, 999)} Plumbrook Crescent`),
          city: String((obj.address && obj.address.city) || 'Toronto'),
          region: String((obj.address && obj.address.region) || 'ON'),
          postalCode: String((obj.address && obj.address.postalCode) || 'M1S 3Z9'),
          country: String((obj.address && obj.address.country) || 'Canada')
        },
        termsAccepted: true,
        profileComplete: true,
        createdAt: obj.createdAt && String(obj.createdAt).includes('T') ? String(obj.createdAt) : new Date(now.getTime() - rand(7, 180) * 86400000).toISOString(),
        lastLogin: new Date(now.getTime() - rand(1, 48) * 3600000).toISOString(),
        tokenBalance: Math.max(100, Number(obj.tokenBalance || rand(400, 2200))),
        cashBalance: Math.round(Number((typeof obj.cashBalance !== 'undefined' ? obj.cashBalance : (obj.cash || 0))) * 100) / 100,
        xp: profileXp,
        level: ['Bronze', 'Silver', 'Gold', 'Platinum'][Math.min(3, Math.floor(profilePoints / 1250))],
        points: profilePoints,
        streakWins,
        bestStreak: Math.max(streakWins, Number(obj.bestStreak || 0)),
        streakMultiplier: Math.max(1, Number(obj.streakMultiplier || 1)),
        stats: {
          wins,
          losses,
          pending,
          totalBets,
          totalParlays
        },
        firstBetRewarded: typeof obj.firstBetRewarded === 'boolean' ? obj.firstBetRewarded : true,
        firstParlayRewarded: typeof obj.firstParlayRewarded === 'boolean' ? obj.firstParlayRewarded : true,
        firstBetEligible: typeof obj.firstBetEligible === 'boolean' ? obj.firstBetEligible : false,
        firstParlayEligible: typeof obj.firstParlayEligible === 'boolean' ? obj.firstParlayEligible : false,
        firstBetClaimedAt: (typeof obj.firstBetClaimedAt !== 'undefined') ? obj.firstBetClaimedAt : null,
        firstParlayClaimedAt: (typeof obj.firstParlayClaimedAt !== 'undefined') ? obj.firstParlayClaimedAt : null,
        dailyTasks: {
          dateKey: String((obj.dailyTasks && obj.dailyTasks.dateKey) || today),
          betsPlaced: Math.max(0, Number(obj.dailyTasks && obj.dailyTasks.betsPlaced || 0)),
          wins: Math.max(0, Number(obj.dailyTasks && obj.dailyTasks.wins || 0)),
          sports: Array.isArray(obj.dailyTasks && obj.dailyTasks.sports) ? obj.dailyTasks.sports : [sportsPool[i % sportsPool.length]],
          claims: isObj(obj.dailyTasks && obj.dailyTasks.claims) ? obj.dailyTasks.claims : { dateKey: today }
        },
        weeklyTasks: {
          weekKey: String((obj.weeklyTasks && obj.weeklyTasks.weekKey) || week),
          claims: isObj(obj.weeklyTasks && obj.weeklyTasks.claims) ? obj.weeklyTasks.claims : {},
          eligibleParlay: !!(obj.weeklyTasks && obj.weeklyTasks.eligibleParlay)
        },
        dailyInsights: {
          dateKey: String((obj.dailyInsights && obj.dailyInsights.dateKey) || today),
          count: Math.max(0, Number(obj.dailyInsights && obj.dailyInsights.count || 0))
        }
      };

      const body = {
        fields: {
          uid: fsValue(normalized.uid),
          email: fsValue(normalized.email),
          authProvider: fsValue(normalized.authProvider),
          fullName: fsValue(normalized.fullName),
          screenName: fsValue(normalized.screenName),
          avatarId: fsValue(normalized.avatarId),
          dateOfBirth: fsValue(normalized.dateOfBirth),
          ageVerified: fsValue(normalized.ageVerified),
          address: fsValue(normalized.address),
          termsAccepted: fsValue(normalized.termsAccepted),
          profileComplete: fsValue(normalized.profileComplete),
          createdAt: { timestampValue: normalized.createdAt },
          lastLogin: { timestampValue: normalized.lastLogin },
          tokenBalance: fsValue(normalized.tokenBalance),
          cashBalance: fsValue(normalized.cashBalance),
          xp: fsValue(normalized.xp),
          level: fsValue(normalized.level),
          points: fsValue(normalized.points),
          streakWins: fsValue(normalized.streakWins),
          bestStreak: fsValue(normalized.bestStreak),
          streakMultiplier: fsValue(normalized.streakMultiplier),
          stats: fsValue(normalized.stats),
          firstBetRewarded: fsValue(normalized.firstBetRewarded),
          firstParlayRewarded: fsValue(normalized.firstParlayRewarded),
          firstBetEligible: fsValue(normalized.firstBetEligible),
          firstParlayEligible: fsValue(normalized.firstParlayEligible),
          firstBetClaimedAt: fsValue(normalized.firstBetClaimedAt),
          firstParlayClaimedAt: fsValue(normalized.firstParlayClaimedAt),
          dailyTasks: fsValue(normalized.dailyTasks),
          weeklyTasks: fsValue(normalized.weeklyTasks),
          dailyInsights: fsValue(normalized.dailyInsights)
        }
      };

      const fieldPaths = [
        'uid','email','authProvider','fullName','screenName','avatarId','dateOfBirth','ageVerified','address','termsAccepted','profileComplete',
        'createdAt','lastLogin','tokenBalance','cashBalance','xp','level','points','streakWins','bestStreak','streakMultiplier','stats',
        'firstBetRewarded','firstParlayRewarded','firstBetEligible','firstParlayEligible','firstBetClaimedAt','firstParlayClaimedAt',
        'dailyTasks','weeklyTasks','dailyInsights'
      ];
      const query = fieldPaths.map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');

      await fetchJson(`${base}/${encodeURIComponent(uid)}?${query}`, {
        method: 'PATCH',
        headers: headers(t),
        body: JSON.stringify(body)
      });

      repaired += 1;
      if (repaired % 25 === 0 || repaired === active.length) {
        console.log(`Repaired ${repaired}/${active.length}`);
      }
    }

    console.log(JSON.stringify({ ok: true, projectId, repairedUsers: repaired, prefix }, null, 2));
  } catch (err) {
    console.error('Repair failed:', err && err.message);
    process.exit(1);
  }
})();
