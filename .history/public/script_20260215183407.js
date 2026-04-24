(function () {
  // pickr shared script
  // exports window.PickrApp with loadPicks and loadWalletPage

  // --- Utilities ---
  const readJSON = (k, fallback = null) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // client-side user profile (authoritative values come from /api/me)
  let userProfile = null; // { uid, tokens, cash, xp, bets }
  // Keep parsed onboarding draft (if any) so we can apply it as a provisional
  // profile while waiting for /api/me. This draft is removed once an
  // authoritative profile that matches the draft is received.
  let onboardingDraft = null;
  try {
    const d = localStorage.getItem('LAST_PROFILE_DRAFT');
    if (d) onboardingDraft = JSON.parse(d);
    if (onboardingDraft) {
      // Apply draft as provisional userProfile so UI shows immediate values
      userProfile = Object.assign({}, userProfile || {}, onboardingDraft);
      try { window.userProfile = userProfile; } catch (e) {}
    }
  } catch (e) { onboardingDraft = null; }

  // --- Header / balances ---
  function refreshHeaders() {
    const tokens = userProfile && typeof userProfile.tokens !== 'undefined' ? String(userProfile.tokens) : '0';
    const cash = userProfile && typeof userProfile.cash !== 'undefined'
      ? Number(userProfile.cash)
      : (userProfile && typeof userProfile.cashBalance !== 'undefined' ? Number(userProfile.cashBalance) : 0);
    const xp = userProfile && typeof userProfile.xp !== 'undefined' ? String(userProfile.xp) : '0';
    document.querySelectorAll('.tokens').forEach(el => el.textContent = tokens);
    document.querySelectorAll('.cash').forEach(el => el.textContent = `$${Number(cash).toFixed(2)}`);
    document.querySelectorAll('.xp').forEach(el => el.textContent = xp);
    const xpEl = document.getElementById('xp'); if (xpEl) xpEl.textContent = xp;
    const walletTokensEl = document.getElementById('walletTokens'); if (walletTokensEl) walletTokensEl.textContent = tokens;
    const walletCashEl = document.getElementById('walletCash'); if (walletCashEl) walletCashEl.textContent = Number(cash).toFixed(2);
    // Also update header-specific elements (some pages use ids instead of classes)
    const headerTokensEl = document.getElementById('headerTokens'); if (headerTokensEl) headerTokensEl.textContent = tokens;
    const headerCashEl = document.getElementById('headerCash'); if (headerCashEl) headerCashEl.textContent = `$${Number(cash).toFixed(2)}`;

    const streakWinsEl = document.getElementById('streakWins');
    const bestStreakEl = document.getElementById('bestStreak');
    const streakMultiplierEl = document.getElementById('streakMultiplier');
    const levelNameEl = document.getElementById('levelName');
    const xpTotalEl = document.getElementById('xpTotal');
    if (streakWinsEl) streakWinsEl.textContent = String(userProfile && userProfile.streakWins ? userProfile.streakWins : 0);
    if (bestStreakEl) bestStreakEl.textContent = String(userProfile && userProfile.bestStreak ? userProfile.bestStreak : 0);
    if (streakMultiplierEl) streakMultiplierEl.textContent = `${Number(userProfile && userProfile.streakMultiplier ? userProfile.streakMultiplier : 1).toFixed(1)}x`;
    if (levelNameEl) levelNameEl.textContent = String(userProfile && userProfile.level ? userProfile.level : 'Bronze');
    if (xpTotalEl) xpTotalEl.textContent = String(userProfile && typeof userProfile.xp !== 'undefined' ? userProfile.xp : 0);
  }

  // Ensure this script refreshes headers when other modules broadcast balance updates
  try {
    window.addEventListener('pickr:balances-updated', () => {
      try { refreshHeaders(); } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }

  // --- Bet slip ---
  const betSlip = {}; // { matchId: { team, stake, odds, sportKey, startTime, homeTeam, awayTeam }}
  const pickMeta = {}; // matchId -> { sportKey, startTime, homeTeam, awayTeam }
  let betMode = 'parlay'; // 'parlay' | 'straight'
  let betCurrency = 'tokens'; // 'tokens' | 'cash'
  let parlayStake = 0;

  function computeParlayOdds(entries) {
    const legs = entries.map(([, info]) => Number(info.odds || 0)).filter((v) => Number.isFinite(v) && v > 1);
    if (legs.length === 0) return 0;
    return Number(legs.reduce((acc, v) => acc * v, 1).toFixed(2));
  }

  function renderBetSlip() {
    const betSlipList = document.getElementById('betSlipList');
    const confirmBtn = document.getElementById('confirmBet');
    if (!betSlipList) return;
    betSlipList.innerHTML = '';
    const entries = Object.entries(betSlip);
    if (entries.length === 0) {
      betSlipList.innerHTML = '<div class="text-gray-400 text-sm">No selections yet.</div>';
      if (confirmBtn) confirmBtn.classList.add('hidden');
      return;
    }
    const useParlay = entries.length > 1 && betMode === 'parlay';
    if (confirmBtn) confirmBtn.classList.remove('hidden');

    const currentCash = userProfile && typeof userProfile.cash !== 'undefined'
      ? Number(userProfile.cash)
      : (userProfile && typeof userProfile.cashBalance !== 'undefined' ? Number(userProfile.cashBalance) : 0);
    const cashAvailable = Number.isFinite(currentCash) && currentCash > 0;
    if (!cashAvailable && betCurrency === 'cash') betCurrency = 'tokens';
    const stakeLabel = betCurrency === 'cash' ? 'Cash' : 'Tokens';
    const switchLabel = betCurrency === 'cash' ? 'Switch to tokens' : 'Switch to cash';
    const stakePlaceholder = betCurrency === 'cash' ? 'Stake ($)' : 'Stake (tokens)';
    if (useParlay) {
      const combinedOdds = computeParlayOdds(entries);
      const summary = document.createElement('div');
      summary.className = 'flex flex-col gap-2 rounded-lg bg-gray-900/60 p-3 text-sm';
      const legs = entries.map(([, info]) => escapeHtml(info.team)).join(', ');
      summary.innerHTML = `
        <div class="text-xs text-gray-400">Parlay legs</div>
        <div class="text-gray-200">${legs}</div>
        <div class="flex items-center justify-between text-xs text-gray-400">
          <span>Combined odds</span>
          <span>${combinedOdds ? escapeHtml(String(combinedOdds)) + 'x' : '—'}</span>
        </div>
        <div class="flex items-center gap-2">
          <input id="parlayStake" type="number" min="0" step="0.01" class="w-full px-2 py-1 rounded bg-gray-700 text-white" value="${parlayStake || ''}" placeholder="${stakePlaceholder}" />
          <button id="toggleBetMode" type="button" class="px-2 py-1 rounded bg-gray-800 text-gray-200">Straight bets</button>
          <button id="toggleBetCurrency" type="button" class="px-2 py-1 rounded ${cashAvailable ? 'bg-gray-800 text-gray-200' : 'bg-gray-800/50 text-gray-500 cursor-not-allowed'}" ${cashAvailable ? '' : 'disabled'}>${switchLabel}</button>
        </div>
      `;
      betSlipList.appendChild(summary);
    } else {
      entries.forEach(([matchId, info]) => {
        const li = document.createElement('div'); li.className = 'flex items-center justify-between py-2';
        const oddsLabel = info.odds ? `${Number(info.odds).toFixed(2)}x` : '—';
        li.innerHTML = `
          <div class="flex-1">
            <div class="font-medium">${escapeHtml(info.team)}</div>
            <div class="text-xs text-gray-400">Odds ${escapeHtml(String(oddsLabel))}</div>
          </div>
          <div class="w-36 flex items-center gap-2">
            <input type="number" min="0" step="0.01" data-match="${escapeHtml(matchId)}" class="stake-input w-full px-2 py-1 rounded bg-gray-700 text-white" value="${info.stake || ''}" placeholder="${stakePlaceholder}" />
            <button data-match="${escapeHtml(matchId)}" class="remove-slip px-2 py-1 rounded bg-red-600 text-white">Remove</button>
          </div>
        `;
        betSlipList.appendChild(li);
      });

      const toggleWrap = document.createElement('div');
      toggleWrap.className = 'pt-2';
      toggleWrap.innerHTML = `
        <div class="flex flex-col gap-2">
          ${entries.length > 1 ? '<button id="toggleBetMode" type="button" class="w-full px-3 py-2 rounded bg-gray-800 text-gray-200 text-sm">Parlay these picks</button>' : ''}
          <button id="toggleBetCurrency" type="button" class="w-full px-3 py-2 rounded text-sm ${cashAvailable ? 'bg-gray-800 text-gray-200' : 'bg-gray-800/50 text-gray-500 cursor-not-allowed'}" ${cashAvailable ? '' : 'disabled'}>${switchLabel}</button>
        </div>
      `;
      betSlipList.appendChild(toggleWrap);
    }

    // Attach listeners
    betSlipList.querySelectorAll('.remove-slip').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-match'); delete betSlip[m];
        document.querySelectorAll(`.select-team[data-match="${m}"]`).forEach(s => { s.classList.remove('bg-red-600','text-white','opacity-50'); s.disabled = false; });
        renderBetSlip();
      });
    });
    betSlipList.querySelectorAll('.stake-input').forEach(input => {
      input.addEventListener('input', () => {
        const m = input.getAttribute('data-match'); const v = parseFloat(input.value); if (!betSlip[m]) betSlip[m] = { team: 'Unknown', stake: 0 }; betSlip[m].stake = isNaN(v) ? 0 : v;
      });
    });
    const parlayStakeInput = document.getElementById('parlayStake');
    if (parlayStakeInput) {
      parlayStakeInput.addEventListener('input', () => {
        const v = parseFloat(parlayStakeInput.value); parlayStake = isNaN(v) ? 0 : v;
      });
    }
    const toggleBtn = document.getElementById('toggleBetMode');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        betMode = betMode === 'parlay' ? 'straight' : 'parlay';
        renderBetSlip();
      });
    }
    const currencyBtn = document.getElementById('toggleBetCurrency');
    if (currencyBtn) {
      currencyBtn.addEventListener('click', () => {
        if (!cashAvailable) {
          alert('Add cash to your wallet to place cash bets.');
          return;
        }
        betCurrency = betCurrency === 'tokens' ? 'cash' : 'tokens';
        renderBetSlip();
      });
    }
  }

  function addSelection(matchId, team, odds, meta) {
    const resolvedMeta = meta && typeof meta === 'object' ? meta : (pickMeta[matchId] || {});
    betSlip[matchId] = betSlip[matchId] || { team, stake: 0, odds: null, sportKey: null, startTime: null, homeTeam: null, awayTeam: null };
    betSlip[matchId].team = team;
    if (resolvedMeta.sportKey) betSlip[matchId].sportKey = resolvedMeta.sportKey;
    if (resolvedMeta.startTime) betSlip[matchId].startTime = resolvedMeta.startTime;
    if (resolvedMeta.homeTeam) betSlip[matchId].homeTeam = resolvedMeta.homeTeam;
    if (resolvedMeta.awayTeam) betSlip[matchId].awayTeam = resolvedMeta.awayTeam;
    // preserve odds if provided by caller
    if (typeof odds !== 'undefined' && odds !== null) {
      betSlip[matchId].odds = (typeof odds === 'number' || !isNaN(Number(odds))) ? Number(odds) : betSlip[matchId].odds;
    }
    if (Object.keys(betSlip).length < 2) {
      betMode = 'straight';
    }
    renderBetSlip();
  }

  let betToastTimer = null;
  function ensureBetToast() {
    let toast = document.getElementById('betPlacedToast');
    if (!toast) {
      const style = document.createElement('style');
      style.textContent = `
        .bet-toast{position:fixed;left:50%;bottom:calc(1.5rem + env(safe-area-inset-bottom));transform:translate(-50%,20px) scale(0.98);background:rgba(15,23,42,0.95);border:1px solid rgba(255,255,255,0.12);box-shadow:0 18px 40px rgba(0,0,0,0.45);border-radius:999px;padding:0.75rem 1.25rem;display:inline-flex;align-items:center;gap:0.75rem;color:#f8fafc;font-weight:600;opacity:0;pointer-events:none;transition:opacity 0.25s ease,transform 0.25s ease;z-index:60;}
        .bet-toast.show{opacity:1;transform:translate(-50%,0) scale(1);}
        .bet-toast__spinner{width:22px;height:22px;border-radius:999px;border:3px solid rgba(255,255,255,0.2);border-top-color:#ff7a1a;animation:spin 0.8s linear infinite;}
        .bet-toast__success{width:22px;height:22px;border-radius:999px;background:rgba(64,217,181,0.2);display:inline-flex;align-items:center;justify-content:center;color:#40d9b5;font-size:0.9rem;}
        @keyframes spin{to{transform:rotate(360deg);}}
      `;
      document.head.appendChild(style);
      toast = document.createElement('div');
      toast.id = 'betPlacedToast';
      toast.className = 'bet-toast';
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = '<span class="bet-toast__spinner" aria-hidden="true"></span><span id="betPlacedToastText">Placing bet...</span>';
      document.body.appendChild(toast);
    }
    return toast;
  }
  function showBetToast(state = 'loading', message) {
    const toast = ensureBetToast();
    const text = document.getElementById('betPlacedToastText');
    if (!toast || !text) return;
    const icon = toast.querySelector('.bet-toast__spinner, .bet-toast__success');
    if (icon) {
      if (state === 'loading') {
        icon.className = 'bet-toast__spinner';
        icon.textContent = '';
      } else {
        icon.className = 'bet-toast__success';
        icon.textContent = '✓';
      }
    }
    if (message) {
      text.textContent = message;
    } else {
      text.textContent = state === 'loading' ? 'Placing bet...' : 'Bet placed successfully';
    }
    toast.classList.add('show');
    if (betToastTimer) clearTimeout(betToastTimer);
    if (state === 'success') {
      betToastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
    }
  }
  function hideBetToast() {
    const toast = document.getElementById('betPlacedToast');
    if (!toast) return;
    if (betToastTimer) clearTimeout(betToastTimer);
    toast.classList.remove('show');
  }

  // confirm bet flow
  function setupConfirmBet() {
    const confirmBtn = document.getElementById('confirmBet');
    if (!confirmBtn) return;
    confirmBtn.addEventListener('click', async () => {
      showBetToast('loading');
      const entries = Object.entries(betSlip);
      if (entries.length === 0) { hideBetToast(); alert('No selections to place.'); return; }
      // require authentication and server-side tokens (or allow dev header)
      const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);
      if (!window.firebase || !firebase.auth || !firebase.auth().currentUser) {
        if (!devUid) { hideBetToast(); alert('Please sign in to place bets.'); return; }
      }
      const useParlay = entries.length > 1 && betMode === 'parlay';
      let total = 0;
      if (useParlay) {
        if (!parlayStake || parlayStake <= 0) { hideBetToast(); alert('Please enter a parlay stake.'); return; }
        total = parlayStake;
      } else {
        for (const [, { stake }] of entries) { if (!stake || stake <= 0) { hideBetToast(); alert('Please set a stake for every selection.'); return; } total += stake; }
      }
      const currentTokens = userProfile && typeof userProfile.tokens !== 'undefined' ? Number(userProfile.tokens) : 0;
      const currentCash = userProfile && typeof userProfile.cash !== 'undefined'
        ? Number(userProfile.cash)
        : (userProfile && typeof userProfile.cashBalance !== 'undefined' ? Number(userProfile.cashBalance) : 0);
      if (betCurrency === 'tokens') {
        const totalTokens = Math.trunc(total);
        if (totalTokens > currentTokens) { hideBetToast(); alert('Insufficient token balance.'); return; }
      } else {
        const totalCash = Number(total) || 0;
        if (totalCash > currentCash) { hideBetToast(); alert('Insufficient cash balance.'); return; }
      }

      try {
        let rewardTokens = 0;
        const selections = entries.map(([matchId, info]) => ({
          eventId: matchId,
          marketType: 'h2h',
          pick: info.team,
          odds: info.odds || null,
          sportKey: info.sportKey || null,
          commenceTime: info.startTime || null,
          homeTeam: info.homeTeam || null,
          awayTeam: info.awayTeam || null
        }));
        const stakeTokens = Math.trunc(total);
        const stakeCash = Number(total);
        let headers = { 'Content-Type': 'application/json' };
        // If Firebase auth is available, use idToken; otherwise use dev header when present
        if (window.firebase && firebase.auth && firebase.auth().currentUser) {
          const idToken = await firebase.auth().currentUser.getIdToken();
          headers.Authorization = 'Bearer ' + idToken;
        } else if (devUid) {
          headers['x-dev-uid'] = devUid;
        }
        if (useParlay) {
          const resp = await fetch(getAPIBase() + '/api/bets/place', { method: 'POST', headers, body: JSON.stringify({ selections, stake: betCurrency === 'tokens' ? stakeTokens : stakeCash, type: 'parlay', currency: betCurrency, parlayIntent: true, parlayLegs: selections.length }) });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'unknown' }));
            throw new Error(err && err.error ? err.error : 'Failed to place bet on server');
          }
          const payload = await resp.json();
          const bet = payload && payload.bet ? payload.bet : null;
          const rewards = payload && payload.rewards ? payload.rewards : null;
          const balances = payload && payload.balances ? payload.balances : null;
          rewardTokens += Math.max(0, Number(rewards && rewards.tokens ? rewards.tokens : 0));
          if (balances && typeof updateBalances === 'function') {
            updateBalances(Number(balances.tokens || 0), Number(balances.cash || 0));
            if (userProfile) {
              userProfile.tokens = Number(balances.tokens || 0);
              userProfile.cash = Number(balances.cash || 0);
              userProfile.cashBalance = Number(balances.cash || 0);
              if (rewards && rewards.stats) userProfile.stats = rewards.stats;
              if (typeof updateQuestTasks === 'function') updateQuestTasks(userProfile);
            }
          }
          if (bet) pushLocalBet(bet);
          try {
            localStorage.setItem('PICKR_FIRST_BET_PLACED', '1');
            localStorage.setItem('PICKR_PARLAY_PLACED', '1');
          } catch (e) {}
        } else {
          for (const [matchId, info] of entries) {
            const resp = await fetch(getAPIBase() + '/api/bets/place', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                selections: [{
                  eventId: matchId,
                  marketType: 'h2h',
                  pick: info.team,
                  odds: info.odds || null,
                  sportKey: info.sportKey || null,
                  commenceTime: info.startTime || null,
                  homeTeam: info.homeTeam || null,
                  awayTeam: info.awayTeam || null
                }],
                stake: betCurrency === 'tokens' ? Math.trunc(info.stake || 0) : Number(info.stake || 0),
                type: 'single',
                currency: betCurrency,
                parlayIntent: betMode === 'parlay',
                parlayLegs: 1
              })
            });
            if (!resp.ok) {
              const err = await resp.json().catch(() => ({ error: 'unknown' }));
              throw new Error(err && err.error ? err.error : 'Failed to place bet on server');
            }
            const payload = await resp.json();
            const bet = payload && payload.bet ? payload.bet : null;
            const rewards = payload && payload.rewards ? payload.rewards : null;
            const balances = payload && payload.balances ? payload.balances : null;
            rewardTokens += Math.max(0, Number(rewards && rewards.tokens ? rewards.tokens : 0));
            if (balances && typeof updateBalances === 'function') {
              updateBalances(Number(balances.tokens || 0), Number(balances.cash || 0));
              if (userProfile) {
                userProfile.tokens = Number(balances.tokens || 0);
                userProfile.cash = Number(balances.cash || 0);
                userProfile.cashBalance = Number(balances.cash || 0);
                if (rewards && rewards.stats) userProfile.stats = rewards.stats;
                if (typeof updateQuestTasks === 'function') updateQuestTasks(userProfile);
              }
            }
            if (bet) pushLocalBet(bet);
            try { localStorage.setItem('PICKR_FIRST_BET_PLACED', '1'); } catch (e) {}
          }
        }
        // clear selections and UI
        Object.keys(betSlip).forEach(k => delete betSlip[k]);
        parlayStake = 0;
        document.querySelectorAll('.select-team').forEach(b => { b.classList.remove('bg-red-600', 'text-white', 'opacity-50'); b.disabled = false; });
        renderBetSlip();
        // Refresh authoritative profile and bets from server
        await syncUserProfile();
        if (typeof window.PickrApp.loadWalletPage === 'function') window.PickrApp.loadWalletPage();
        if (rewardTokens > 0) {
          showBetToast('success', `Quest complete: +${rewardTokens} Tokens`);
        } else {
          showBetToast('success');
        }
        return;
      } catch (err) {
        console.warn('Server bet placement failed:', err && err.message);
        hideBetToast();
        alert('Failed to place bet on server: ' + (err && err.message ? err.message : 'unknown error'));
        return;
      }
    });
  }

  // --- Picks loader / recommendation ---
  const getAPIBase = () => {
    const configured = window.PICKR_CONFIG && window.PICKR_CONFIG.API_BASE_URL;
    if (typeof configured === 'string') {
      if (configured.length > 0) return configured;
      const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      if (isLocalhost) return '';
    }
    return 'https://pickr-backend-972106331799.us-central1.run.app';
  };
  const API_PICKS = () => getAPIBase() + '/api/picks';
  const API_ME = () => getAPIBase() + '/api/me';

  function slugify(name = '') { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
  function fmtDate(iso = '') { try { return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso; } }

  function applyTeamLogo(imgEl, teamName) {
    if (!imgEl || !teamName) return;
    const fallback = '/images/logos/logo-placeholder.png';
    const apiBase = getAPIBase();
    const proxyUrl = `${apiBase}/api/teams/logo/image?name=${encodeURIComponent(teamName)}&league=12&season=2024`;
    imgEl.src = fallback;
    imgEl.onerror = () => { imgEl.src = fallback; };
    imgEl.src = proxyUrl;
  }

  function pushLocalBet(bet) {
    try {
      const history = readJSON('betHistory', []);
      const placedAt = toMillis(bet && (bet.placedAt || bet.date || bet.createdAt)) || Date.now();
      history.unshift({
        id: bet && (bet.betId || bet.id) ? String(bet.betId || bet.id) : String(Date.now()),
        stake: Number(bet && (bet.stake || bet.amount) || 0),
        type: bet && bet.type ? String(bet.type) : 'single',
        selections: bet && bet.selections ? bet.selections : [],
        date: placedAt
      });
      localStorage.setItem('betHistory', JSON.stringify(history.slice(0, 100)));
    } catch (e) {
      console.warn('Failed to persist local bet history:', e && e.message);
    }
  }

  function computeConfidence(pick) {
    if (typeof pick.confidence === 'number') return pick.confidence > 1 ? pick.confidence/100 : pick.confidence;
    const d = pick.displayOdds || pick.odds || {};
    const vals = [];
    if (d.home) vals.push(1/parseFloat(d.home));
    if (d.draw) vals.push(1/parseFloat(d.draw));
    if (d.away) vals.push(1/parseFloat(d.away));
    if (vals.length) {
      const sum = vals.reduce((s,v)=>s+ (isFinite(v)?v:0),0);
      const rec = pick.pickTeam || pick.recommended;
      if (rec && d.home && String(pick.home_team) === String(rec)) return (1/parseFloat(d.home))/sum;
      if (rec && d.away && String(pick.away_team) === String(rec)) return (1/parseFloat(d.away))/sum;
      return Math.max(...vals)/sum;
    }
    return 0.5;
  }

  // Sync the authenticated user's profile from the server and keep it in-memory.
  async function syncUserProfile() {
    try {
      // If Firebase Auth is available and a user is signed in, use their ID token.
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        const idToken = await firebase.auth().currentUser.getIdToken();
        const resp = await fetch(API_ME(), { headers: { Authorization: 'Bearer ' + idToken } });
        if (!resp.ok) return null;
        const data = await resp.json();
        // Keep authoritative profile in memory (do not persist tokens locally)
        userProfile = Object.assign({}, userProfile || {}, data);
        // expose for in-page scripts
        try { window.userProfile = userProfile; } catch (e) {}
        // Refresh UI headers
        refreshHeaders();
        updateQuestTasks(userProfile);
        // Broadcast authoritative balances so other pages/tabs update immediately
        try { if (typeof updateBalances === 'function') updateBalances(Number(userProfile.tokens || userProfile.tokenBalance || 0), Number(userProfile.cash || userProfile.cashBalance || 0)); } catch (e) {}
        // Clear any local onboarding draft once we have authoritative profile
        try {
          if (onboardingDraft) {
            const draft = onboardingDraft || null;
            const draftMatches = (draft && data && ((draft.email && data.email && String(draft.email).toLowerCase() === String(data.email).toLowerCase()) || (draft.fullName && data.fullName && String(draft.fullName) === String(data.fullName) && draft.dateOfBirth && data.dateOfBirth && String(draft.dateOfBirth) === String(data.dateOfBirth))));
            if (draftMatches) localStorage.removeItem('LAST_PROFILE_DRAFT');
          }
        } catch (e) { /* ignore */ }
        onboardingDraft = null;
        refreshHeaders();
        return data;
      }

      // Developer / local mode: allow calls to server using a dev UID header so
      // you can run without configuring the Auth emulator or a service account.
      // The dev UID is read from localStorage.DEV_AUTH_UID or defaults to
      // 'test-user-123' when running on localhost.
      const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);
      if (devUid) {
        const resp = await fetch(API_ME(), { headers: { 'x-dev-uid': devUid } });
        if (!resp.ok) return null;
        const data = await resp.json();
        userProfile = Object.assign({}, userProfile || {}, data);
        try { window.userProfile = userProfile; } catch (e) {}
        refreshHeaders();
        updateQuestTasks(userProfile);
        try { if (typeof updateBalances === 'function') updateBalances(Number(userProfile.tokens || userProfile.tokenBalance || 0), Number(userProfile.cash || userProfile.cashBalance || 0)); } catch (e) {}
        try {
          if (onboardingDraft) {
            const draft = onboardingDraft || null;
            const draftMatches = (draft && data && ((draft.email && data.email && String(draft.email).toLowerCase() === String(data.email).toLowerCase()) || (draft.fullName && data.fullName && String(draft.fullName) === String(data.fullName) && draft.dateOfBirth && data.dateOfBirth && String(draft.dateOfBirth) === String(data.dateOfBirth))));
            if (draftMatches) localStorage.removeItem('LAST_PROFILE_DRAFT');
          }
        } catch (e) {}
        onboardingDraft = null;
        refreshHeaders();
        return data;
      }
      return null;
    } catch (e) {
      console.warn('Failed to sync user profile:', e && e.message);
      return null;
    }
  }

  // Expose syncUserProfile globally so pages that include only `script.js`
  // (like leaderboard.html and tasks.html) can request an authoritative
  // profile sync on load.
  try { window.syncUserProfile = syncUserProfile; } catch (e) {}

  function confidenceLabel(score) { if (score >= 0.66) return { text: 'High', color: 'bg-green-500' }; if (score >= 0.4) return { text: 'Medium', color: 'bg-yellow-500' }; return { text: 'Low', color: 'bg-red-500' }; }

  // flexible container id for different pages
  function getPicksContainer() { return document.getElementById('dailyPicksContainer') || document.getElementById('picksContainer'); }

  function renderSkeletons(container, count = 6) {
    if (!container) return; container.innerHTML = '';
    for (let i=0;i<count;i++) { const s = document.createElement('div'); s.className = 'animate-pulse bg-gray-800 rounded-lg p-4 h-36 mb-4'; container.appendChild(s); }
  }

  function createPickCard(pick) {
    const conf = computeConfidence(pick); const confBadge = confidenceLabel(conf);
    const card = document.createElement('article'); card.className = 'bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-sm';
    const matchId = pick.id || pick.matchId || '';
    const sportKey = pick.sport_key || pick.sportKey || '';
    const startTime = pick.commence_time || pick.startTime || pick.date || '';
    pickMeta[matchId] = {
      sportKey,
      startTime,
      homeTeam: pick.home_team || '',
      awayTeam: pick.away_team || ''
    };

    // top
    const top = document.createElement('div'); top.className = 'flex items-center justify-between mb-3';
    const league = document.createElement('div'); league.className = 'text-xs text-gray-400'; league.textContent = pick.league || pick.sport || '';
    const time = document.createElement('div'); time.className = 'text-xs text-gray-400'; time.textContent = fmtDate(pick.commence_time || pick.startTime || pick.date || '');
    top.appendChild(league); top.appendChild(time); card.appendChild(top);

    // matchup
    const matchup = document.createElement('div'); matchup.className = 'flex items-center justify-between gap-4';
    const left = document.createElement('div'); left.className = 'text-sm text-gray-200';
    left.innerHTML = `<div class="font-medium">${escapeHtml(pick.away_team || '')}</div><div class="text-xs text-gray-400">vs</div><div class="font-medium">${escapeHtml(pick.home_team || '')}</div>`;

    const right = document.createElement('div'); right.className = 'text-right';
    const oddsText = pick.pickTeamValue || (pick.displayOdds && (pick.displayOdds.home || pick.displayOdds.away)) || '';
    const oddsLabel = oddsText ? `${Number(oddsText).toFixed(2)}x` : '—';
    right.innerHTML = `<div class="text-xs text-gray-400">Best odds</div><div class="font-semibold">${escapeHtml(String(oddsLabel))}</div>`;

    matchup.appendChild(left); matchup.appendChild(right); card.appendChild(matchup);

    // selection buttons
    const btns = document.createElement('div'); btns.className = (pick.displayOdds && pick.displayOdds.draw) ? 'grid grid-cols-3 gap-2 mt-3' : 'grid grid-cols-2 gap-2 mt-3';
    const makeBtn = (team, odds) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'select-team py-3 px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm flex flex-col items-center gap-2';
      b.setAttribute('data-match', matchId);
      b.setAttribute('data-team', team);
      b.setAttribute('data-odds', typeof odds !== 'undefined' && odds !== null ? String(odds) : '');
      b.setAttribute('data-sport', sportKey);
      b.setAttribute('data-start', startTime);
      b.setAttribute('data-home', pick.home_team || '');
      b.setAttribute('data-away', pick.away_team || '');

      const img = document.createElement('img');
      img.className = 'w-16 h-16 object-contain';
      applyTeamLogo(img, team);
      const name = document.createElement('div');
      name.className = 'text-xs text-gray-200 text-center';
      name.textContent = team;
      const oddsEl = document.createElement('div');
      oddsEl.className = 'text-xs text-gray-400';
      oddsEl.textContent = odds ? `${Number(odds).toFixed(2)}x` : '';

      b.appendChild(img);
      b.appendChild(name);
      b.appendChild(oddsEl);
      b.addEventListener('click', () => {
        // mark selection
        document.querySelectorAll(`.select-team[data-match="${b.getAttribute('data-match')}"]`).forEach(s=>{ s.classList.remove('bg-red-600','text-white','opacity-50'); s.disabled = false; });
        b.classList.add('bg-red-600','text-white');
        document.querySelectorAll(`.select-team[data-match="${b.getAttribute('data-match')}"]`).forEach(s=>{ if (s!==b && s.getAttribute('data-team')!==team){ s.disabled = true; s.classList.add('opacity-50'); }});
        const oddsVal = b.getAttribute('data-odds');
        addSelection(b.getAttribute('data-match'), team, oddsVal ? Number(oddsVal) : null, {
          sportKey: b.getAttribute('data-sport') || '',
          startTime: b.getAttribute('data-start') || '',
          homeTeam: b.getAttribute('data-home') || '',
          awayTeam: b.getAttribute('data-away') || ''
        });
      });
      return b;
    };
    btns.appendChild(makeBtn(pick.home_team || '', pick.displayOdds && pick.displayOdds.home));
    if (pick.displayOdds && pick.displayOdds.draw) btns.appendChild(makeBtn('Draw', pick.displayOdds.draw));
    btns.appendChild(makeBtn(pick.away_team || '', pick.displayOdds && pick.displayOdds.away));
    card.appendChild(btns);

    // recommended bar
    const options = [];
    if (pick.displayOdds && pick.displayOdds.home) options.push({ team: pick.home_team, odds: parseFloat(pick.displayOdds.home) });
    if (pick.displayOdds && pick.displayOdds.draw) options.push({ team: 'Draw', odds: parseFloat(pick.displayOdds.draw) });
    if (pick.displayOdds && pick.displayOdds.away) options.push({ team: pick.away_team, odds: parseFloat(pick.displayOdds.away) });
    if (options.length) {
      const inv = options.map(o => ({ ...o, imp: o.odds ? 1/o.odds : 0 }));
      const sumImp = inv.reduce((s,x)=>s+(x.imp||0),0) || 1;
      inv.forEach(x => x.prob = x.imp / sumImp);
      inv.sort((a,b)=>b.prob - a.prob);
      const rec = inv[0];
      const recBar = document.createElement('div'); recBar.className = 'mt-3 flex items-center justify-between bg-gray-900/50 p-2 rounded';
      recBar.innerHTML = `<div class="text-sm text-gray-200">Pickr recommends: <strong>${escapeHtml(rec.team)}</strong> <span class="text-xs text-gray-400">(${Math.round(rec.prob*100)}% confidence)</span></div>`;
      const recBtn = document.createElement('button'); recBtn.type = 'button'; recBtn.className = 'py-1 px-3 bg-blue-600 text-white rounded'; recBtn.textContent = 'Select recommendation';
      recBtn.addEventListener('click', () => { const selector = `.select-team[data-match="${pick.id || pick.matchId}"][data-team="${rec.team}"]`; const el = document.querySelector(selector); if (el) el.click(); });
      recBar.appendChild(recBtn);
      card.appendChild(recBar);
    }

  // meta
  const meta = document.createElement('div'); meta.className = 'mt-3 flex items-center justify-between';
  meta.innerHTML = `<div class="flex items-center gap-2"><span class="text-xs ${confBadge.color} text-white px-2 py-1 rounded-full">${confBadge.text}</span><span class="text-xs text-gray-300">Confidence ${Math.round(conf*100)}%</span></div><div class="text-xs text-gray-300">Value ${(pick.value || pick.pickTeamValue || 0)}</div>`;
    card.appendChild(meta);

    return card;
  }

  async function getAuthHeaders() {
    const headers = {};
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        const idToken = await firebase.auth().currentUser.getIdToken();
        headers.Authorization = 'Bearer ' + idToken;
        return headers;
      }
    } catch (e) {
      // ignore and fall back to dev header
    }

    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);
    if (devUid) headers['x-dev-uid'] = devUid;
    return headers;
  }

  async function waitForAuthReady(timeoutMs = 5000) {
    if (window.firebase && firebase.auth) {
      if (firebase.auth().currentUser) return firebase.auth().currentUser;
      return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          resolve(null);
        }, timeoutMs);
        const unsub = firebase.auth().onAuthStateChanged((user) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { unsub && unsub(); } catch (e) {}
          resolve(user || null);
        });
      });
    }
    return null;
  }

  async function loadPicks(sport = 'all', containerOverride = null) {
    const container = containerOverride || getPicksContainer();
    if (!container) return;
    renderSkeletons(container, 6);
    try {
      const qs = sport && sport !== 'all' ? `?sport=${encodeURIComponent(sport)}` : '';
      let headers = await getAuthHeaders();
      if (!headers.Authorization && !headers['x-dev-uid']) {
        await waitForAuthReady();
        headers = await getAuthHeaders();
      }
      const res = await fetch(API_PICKS() + qs, { headers });
      if (res.status === 401) {
        container.innerHTML = '<div class="text-red-600 p-4">Please sign in again to load picks.</div>';
        return;
      }
      const data = await res.json();
      let picks = Array.isArray(data) ? data.slice(0, 50) : (Array.isArray(data.picks) ? data.picks.slice(0, 50) : []);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
      const dayAfterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime();
      const withTimes = picks
        .map(p => ({
          pick: p,
          ts: toMillis(p.commence_time || p.startTime || p.date || null)
        }))
        .filter(p => p.ts && p.ts >= todayStart && p.ts < dayAfterStart)
        .sort((a, b) => a.ts - b.ts);
      const todayGames = withTimes.filter(p => p.ts >= todayStart && p.ts < tomorrowStart).map(p => p.pick);
      const nextGames = withTimes.filter(p => p.ts >= tomorrowStart && p.ts < dayAfterStart).map(p => p.pick);
      const maxGames = 10;
      picks = todayGames.length >= maxGames
        ? todayGames.slice(0, maxGames)
        : todayGames.concat(nextGames.slice(0, maxGames - todayGames.length));
      if (sport === 'nba') {
        picks = picks.filter(p => !(String(p.away_team || '').toLowerCase() === 'player prop' || String(p.id || '').includes('_prop_')));
      }
      container.innerHTML = '';
      if (!picks || picks.length === 0) {
        container.innerHTML = '<div class="text-gray-400 p-6">No games today.</div>';
        return;
      }
      picks.forEach(p => container.appendChild(createPickCard(p)));
    } catch (e) {
      console.error('loadPicks error', e);
      container.innerHTML = '<div class="text-red-600 p-4">Failed to load picks. Try again later.</div>';
    }
  }

  async function loadNbaStatsSection() {
    const section = document.getElementById('nbaStatsSection');
    if (!section) return;

    const apiBase = (window.PICKR_CONFIG && window.PICKR_CONFIG.API_BASE_URL) || '';
    const teamsEl = document.getElementById('nbaTeams');
    const playersEl = document.getElementById('nbaPlayers');
    const statsEl = document.getElementById('nbaStatsPanel');
    const statusEl = document.getElementById('nbaStatsStatus');
    if (!teamsEl || !playersEl || !statsEl) return;

    const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
    const fetchJson = async (path) => {
      let headers = await getAuthHeaders();
      if (!headers.Authorization && !headers['x-dev-uid']) {
        await waitForAuthReady();
        headers = await getAuthHeaders();
      }
      const res = await fetch(apiBase + path, { headers });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    };

    const formatTeamName = (team = {}) => {
      if (team.teamCity && team.teamName) return `${team.teamCity} ${team.teamName}`;
      if (team.name) return team.name;
      if (team.teamName) return team.teamName;
      return 'Team';
    };

    const clearActive = (root) => {
      if (!root) return;
      root.querySelectorAll('.active').forEach((el) => el.classList.remove('active'));
    };

    const renderStats = (payload) => {
      if (!payload || !payload.player) {
        statsEl.textContent = 'No stats available.';
        return;
      }
      const player = payload.player;
      const season = payload.season || 'Current season';
      const totals = payload.seasonTotals || {};
      const perGame = payload.perGame || {};
      const last5 = Array.isArray(payload.last5) ? payload.last5 : [];

      const safe = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : (v || '—');
      const pct = (v) => (typeof v === 'number' && Number.isFinite(v)) ? `${(v * 100).toFixed(1)}%` : '—';

      const lastRows = last5.map((g) => {
        return `<tr class="border-t border-white/5">
          <td class="py-2 pr-2 text-xs text-slate-400">${escapeHtml(g.date || '')}</td>
          <td class="py-2 pr-2 text-xs">${escapeHtml(g.matchup || '')}</td>
          <td class="py-2 text-xs">${escapeHtml(String(safe(g.pts)))}</td>
          <td class="py-2 text-xs">${escapeHtml(String(safe(g.reb)))}</td>
          <td class="py-2 text-xs">${escapeHtml(String(safe(g.ast)))}</td>
        </tr>`;
      }).join('');

      statsEl.innerHTML = `
        <div class="text-base font-semibold mb-2">${escapeHtml(player.name || 'Player')}</div>
        <div class="text-xs text-slate-400 mb-4">Season: ${escapeHtml(season)}</div>
        <div class="grid grid-cols-2 gap-3 text-xs mb-4">
          <div class="rounded-lg bg-slate-900/70 p-3">
            <div class="text-slate-400 uppercase tracking-widest text-[10px]">Season totals</div>
            <div class="mt-2 flex flex-col gap-1">
              <div>GP: <span class="text-slate-100">${escapeHtml(String(safe(totals.gp)))}</span></div>
              <div>PTS: <span class="text-slate-100">${escapeHtml(String(safe(totals.pts)))}</span></div>
              <div>REB: <span class="text-slate-100">${escapeHtml(String(safe(totals.reb)))}</span></div>
              <div>AST: <span class="text-slate-100">${escapeHtml(String(safe(totals.ast)))}</span></div>
            </div>
          </div>
          <div class="rounded-lg bg-slate-900/70 p-3">
            <div class="text-slate-400 uppercase tracking-widest text-[10px]">Per game</div>
            <div class="mt-2 flex flex-col gap-1">
              <div>PTS: <span class="text-slate-100">${escapeHtml(String(safe(perGame.pts)))}</span></div>
              <div>REB: <span class="text-slate-100">${escapeHtml(String(safe(perGame.reb)))}</span></div>
              <div>AST: <span class="text-slate-100">${escapeHtml(String(safe(perGame.ast)))}</span></div>
              <div>FG%: <span class="text-slate-100">${escapeHtml(String(pct(perGame.fg_pct)))}</span></div>
              <div>3P%: <span class="text-slate-100">${escapeHtml(String(pct(perGame.fg3_pct)))}</span></div>
            </div>
          </div>
        </div>
        <div class="text-xs text-slate-400 uppercase tracking-widest">Last 5 games</div>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-left">
            <thead class="text-[10px] uppercase text-slate-500">
              <tr>
                <th class="py-1 pr-2">Date</th>
                <th class="py-1 pr-2">Matchup</th>
                <th class="py-1">PTS</th>
                <th class="py-1">REB</th>
                <th class="py-1">AST</th>
              </tr>
            </thead>
            <tbody>
              ${lastRows || '<tr><td class="py-2 text-xs text-slate-500" colspan="5">No recent games.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    };

    setStatus('Loading today’s games…');
    teamsEl.innerHTML = '';
    playersEl.innerHTML = '<div class="text-xs text-slate-400">Select a team to load the roster.</div>';
    statsEl.textContent = 'Select a player to view stats.';

    let games = [];
    try {
      const data = await fetchJson('/api/nba/today');
      games = Array.isArray(data.games) ? data.games : (Array.isArray(data) ? data : []);
    } catch (e) {
      setStatus('Failed to load today’s NBA games.');
      teamsEl.innerHTML = '<div class="text-xs text-slate-400">No teams available.</div>';
      return;
    }

    const teamMap = new Map();
    games.forEach((game) => {
      const home = game.homeTeam || game.home || {};
      const away = game.awayTeam || game.away || {};
      if (home.teamId && !teamMap.has(home.teamId)) teamMap.set(home.teamId, home);
      if (away.teamId && !teamMap.has(away.teamId)) teamMap.set(away.teamId, away);
    });

    const teams = Array.from(teamMap.values());
    if (!teams.length) {
      setStatus('No NBA games today.');
      teamsEl.innerHTML = '<div class="text-xs text-slate-400">No teams available.</div>';
      return;
    }

    setStatus(`Loaded ${teams.length} teams playing today.`);
    teams.forEach((team) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-chip px-3 py-2 rounded-full text-xs font-semibold';
      btn.textContent = formatTeamName(team);
      btn.dataset.teamId = team.teamId;
      btn.addEventListener('click', async () => {
        clearActive(teamsEl);
        btn.classList.add('active');
        playersEl.innerHTML = '<div class="text-xs text-slate-400">Loading roster…</div>';
        statsEl.textContent = 'Select a player to view stats.';
        try {
          const roster = await fetchJson(`/api/nba/roster?teamId=${encodeURIComponent(team.teamId)}`);
          const players = Array.isArray(roster.players) ? roster.players : [];
          playersEl.innerHTML = '';
          if (!players.length) {
            playersEl.innerHTML = '<div class="text-xs text-slate-400">No roster data available.</div>';
            return;
          }
          players.forEach((player) => {
            const pBtn = document.createElement('button');
            pBtn.type = 'button';
            pBtn.className = 'flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900/70 text-sm hover:bg-slate-800';
            pBtn.innerHTML = `<span>${escapeHtml(player.fullName || player.name || 'Player')}</span><span class="text-xs text-slate-400">${escapeHtml(player.position || '')}</span>`;
            pBtn.addEventListener('click', async () => {
              clearActive(playersEl);
              pBtn.classList.add('active');
              statsEl.textContent = 'Loading stats…';
              try {
                const nameParam = player.fullName ? `&playerName=${encodeURIComponent(player.fullName)}` : '';
                const stats = await fetchJson(`/api/nba/player-stats?playerId=${encodeURIComponent(player.playerId)}${nameParam}`);
                if (stats && stats.error) {
                  statsEl.textContent = stats.error || 'Stats temporarily unavailable.';
                } else {
                  renderStats(stats);
                }
              } catch (err) {
                statsEl.textContent = 'Stats temporarily unavailable.';
              }
            });
            playersEl.appendChild(pBtn);
          });
        } catch (err) {
          playersEl.innerHTML = '<div class="text-xs text-slate-400">Failed to load roster.</div>';
        }
      });
      teamsEl.appendChild(btn);
    });
  }

  // --- Wallet helpers ---
  function updateBalances(tokens, cash) {
    // Update in-memory profile and refresh UI. Do NOT persist tokens to localStorage.
    userProfile = userProfile || {};
    if (typeof tokens !== 'undefined') userProfile.tokens = tokens;
    if (typeof cash !== 'undefined') userProfile.cash = cash;
    try { window.userProfile = userProfile; } catch (e) {}
    refreshHeaders();
    // Broadcast a cross-module event so other scripts/pages can react
    try {
      const ev = new CustomEvent('pickr:balances-updated', { detail: { tokens: userProfile.tokens, cash: userProfile.cash } });
      window.dispatchEvent(ev);
    } catch (e) { /* ignore environments that don't support CustomEvent */ }
  }

  // Expose the canonical updateBalances globally so other scripts can call it.
  try { window.updateBalances = updateBalances; } catch (e) {}

  async function loadWalletPage() {
    refreshHeaders();
    const historyContainer = document.getElementById('betHistory');
    if (!historyContainer) return;
    historyContainer.innerHTML = '';
    // Require authenticated user to view wallet (authoritative bets). Support dev mode via x-dev-uid.
    // Ensure profile is up-to-date
    await syncUserProfile();
    try {
      let headers = {};
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        const idToken = await firebase.auth().currentUser.getIdToken();
        headers.Authorization = 'Bearer ' + idToken;
      } else {
        const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);
        if (!devUid) { historyContainer.innerHTML = '<div class="text-gray-500">Please sign in to view your bets and wallet.</div>'; return; }
        headers['x-dev-uid'] = devUid;
      }
      const betsUrl = getAPIBase() + '/api/bets?ts=' + Date.now();
      const resp = await fetch(betsUrl, { headers, cache: 'no-store' });
      if (!resp.ok) { historyContainer.innerHTML = '<div class="text-gray-500">No bets yet.</div>'; return; }
      const data = await resp.json();
      const bets = Array.isArray(data.bets) ? data.bets : [];
      if (bets.length === 0) { historyContainer.innerHTML = '<div class="text-gray-500">No bets yet.</div>'; return; }
      bets.forEach(item => {
        const d = document.createElement('div'); d.className = 'py-2 flex justify-between items-start';
        const stake = Number(item.stake || item.amount || 0).toFixed(2);
        const placedAt = toMillis(item.placedAt || item.date || Date.now());
        d.innerHTML = `<div><strong>${escapeHtml(stake)}</strong> &ndash; ${escapeHtml((item.selections && item.selections.map(s=>s.pick).join(', ')) || item.team || item.description || 'Selection')}</div><div class="text-xs text-gray-400">${escapeHtml(new Date(placedAt || Date.now()).toLocaleString())}</div>`;
        historyContainer.appendChild(d);
      });
    } catch (e) {
      console.warn('Failed to load wallet bets:', e && e.message);
      historyContainer.innerHTML = '<div class="text-gray-500">Failed to load bets.</div>';
    }
  }

  function formatRelativeTime(ts) {
    const deltaMs = Date.now() - ts;
    if (deltaMs < 60 * 1000) return 'Just now';
    const mins = Math.floor(deltaMs / (60 * 1000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
  function toMillis(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof value === 'object') {
      const seconds = value.seconds ?? value._seconds;
      const nanos = value.nanoseconds ?? value._nanoseconds;
      if (typeof seconds === 'number') return seconds * 1000 + Math.floor((nanos || 0) / 1e6);
    }
    return 0;
  }

  function renderBetSkeletons(container, count = 4) {
    container.innerHTML = '';
    for (let i = 0; i < count; i += 1) {
      const card = document.createElement('div');
      card.className = 'bet-card skeleton';
      card.innerHTML = `
        <div class="skeleton-line w-24"></div>
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-32"></div>
      `;
      container.appendChild(card);
    }
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function getDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getBalanceFromDom(selector, fallback = 0) {
    const el = document.querySelector(selector);
    if (!el) return fallback;
    const value = Number(String(el.textContent || '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(value) ? value : fallback;
  }

  function updateQuestTasks(profile) {
    const betStatus = document.getElementById('firstBetTaskStatus');
    const betButton = document.getElementById('firstBetTaskButton');
    const parlayStatus = document.getElementById('firstParlayTaskStatus');
    const parlayButton = document.getElementById('firstParlayTaskButton');
    if (!betStatus && !parlayStatus) return;

    const data = profile || userProfile || null;
    const stats = data && data.stats ? data.stats : {};
    const totalBets = Number(stats.totalBets || 0);
    const totalParlays = Number(stats.totalParlays || 0);
    const hasProfile = !!data;
    const localBetPlaced = localStorage.getItem('PICKR_FIRST_BET_PLACED') === '1';
    const localParlayPlaced = localStorage.getItem('PICKR_PARLAY_PLACED') === '1';
    const betEligible = hasProfile && (totalBets > 0 || localBetPlaced || !!data.firstBetEligible);
    const parlayEligible = hasProfile && (totalParlays > 0 || localParlayPlaced || !!data.firstParlayEligible);
    const betClaimed = hasProfile && !!data.firstBetRewarded;
    const parlayClaimed = hasProfile && !!data.firstParlayRewarded;

    const setState = (statusEl, actionEl, eligible, claimed, idleLabel, readyLabel, doneLabel, claimLabel, defaultLabel) => {
      if (!statusEl || !actionEl) return;
      if (!hasProfile) {
        statusEl.textContent = 'Sign in to start';
        statusEl.classList.remove('quest-status--done');
        actionEl.textContent = defaultLabel;
        actionEl.classList.remove('quest-cta--claim');
        actionEl.removeAttribute('data-claim-ready');
        return;
      }
      if (claimed) {
        statusEl.textContent = doneLabel;
        statusEl.classList.add('quest-status--done');
        actionEl.textContent = 'Completed';
        actionEl.classList.add('quest-cta--disabled');
        actionEl.setAttribute('aria-disabled', 'true');
        actionEl.setAttribute('tabindex', '-1');
        actionEl.removeAttribute('data-claim-ready');
        return;
      }
      if (eligible) {
        statusEl.textContent = readyLabel;
        statusEl.classList.remove('quest-status--done');
        actionEl.textContent = claimLabel;
        actionEl.classList.add('quest-cta--claim');
        actionEl.classList.remove('quest-cta--disabled');
        actionEl.setAttribute('aria-disabled', 'false');
        actionEl.removeAttribute('tabindex');
        actionEl.setAttribute('data-claim-ready', 'true');
        return;
      }
      statusEl.textContent = idleLabel;
      statusEl.classList.remove('quest-status--done');
      actionEl.textContent = defaultLabel;
      actionEl.classList.remove('quest-cta--claim');
      actionEl.classList.remove('quest-cta--disabled');
      actionEl.setAttribute('aria-disabled', 'false');
      actionEl.removeAttribute('tabindex');
      actionEl.removeAttribute('data-claim-ready');
    };

    setState(betStatus, betButton, betEligible, betClaimed, 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Place a bet');
    setState(parlayStatus, parlayButton, parlayEligible, parlayClaimed, 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Build a parlay');
  }

  async function claimQuestReward(taskKey) {
    try {
      showBetToast('loading', 'Claiming reward...');
      const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);
      if (!window.firebase || !firebase.auth || !firebase.auth().currentUser) {
        if (!devUid) throw new Error('Please sign in to claim rewards.');
      }

      let headers = { 'Content-Type': 'application/json' };
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        const idToken = await firebase.auth().currentUser.getIdToken();
        headers.Authorization = 'Bearer ' + idToken;
      } else if (devUid) {
        headers['x-dev-uid'] = devUid;
      }

      const apiBase = getAPIBase();
      const resp = await fetch(apiBase + '/api/tasks/claim', {
        method: 'POST',
        headers,
        body: JSON.stringify({ task: taskKey })
      });
      const rawText = await resp.text();
      let payload = {};
      try { payload = rawText ? JSON.parse(rawText) : {}; } catch (e) { payload = { error: rawText }; }
      if (!resp.ok) throw new Error(payload && payload.error ? payload.error : 'Claim failed');
      const reward = Number(payload.reward || 0);
      const balances = payload.balances || null;
      if (balances && typeof updateBalances === 'function') {
        updateBalances(Number(balances.tokens || 0), Number(balances.cash || 0));
        if (userProfile) {
          userProfile.tokens = Number(balances.tokens || 0);
          userProfile.cash = Number(balances.cash || 0);
          userProfile.cashBalance = Number(balances.cash || 0);
        }
      }
      if (userProfile) {
        if (payload.stats) userProfile.stats = payload.stats;
        if (typeof payload.firstBetRewarded !== 'undefined') userProfile.firstBetRewarded = !!payload.firstBetRewarded;
        if (typeof payload.firstParlayRewarded !== 'undefined') userProfile.firstParlayRewarded = !!payload.firstParlayRewarded;
      }
      updateQuestTasks(userProfile);
      if (reward > 0) {
        showBetToast('success', `Reward claimed: +${reward} Tokens`);
      } else {
        showBetToast('success', 'Reward already claimed');
      }
      return payload;
    } catch (err) {
      hideBetToast();
      alert(err && err.message ? err.message : 'Failed to claim reward');
      return null;
    }
  }

  function initDailySpin() {
    const wheel = document.getElementById('spinWheel');
    const button = document.getElementById('spinTaskButton');
    const status = document.getElementById('spinTaskStatus');
    const timer = document.getElementById('spinTaskTimer');
    const modal = document.getElementById('spinModal');
    const modalClose = document.getElementById('spinModalClose');
    const modalStatus = document.getElementById('spinModalStatus');
    const modalResult = document.getElementById('spinModalResult');
    if (!wheel || !button || !status || !timer || !modal || !modalClose || !modalStatus || !modalResult) return;

    const rewards = [100, 250, 100, 50, 100, 500, 250];
    const slice = 360 / rewards.length;
    let spinning = false;
    let currentRotation = Number(readJSON('PICKR_SPIN_ROT', 0)) || 0;
    wheel.style.transform = `rotate(${currentRotation}deg)`;
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);

    const getTodayNoon = (now) => {
      const noon = new Date(now);
      noon.setHours(12, 0, 0, 0);
      return noon;
    };
    const getNextNoon = (now) => {
      const next = getTodayNoon(now);
      if (now >= next) next.setDate(next.getDate() + 1);
      return next;
    };

    const openModal = () => {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    };
    const closeModal = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    };
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    const updateAvailability = () => {
      const now = new Date();
      const lockUntilRaw = localStorage.getItem('PICKR_SPIN_LOCK_UNTIL') || '';
      const lockUntil = lockUntilRaw ? new Date(lockUntilRaw) : null;
      if (lockUntil && Number.isFinite(lockUntil.getTime()) && now < lockUntil) {
        timer.textContent = `Resets in ${formatCountdown(lockUntil - now)} (12:00 PM)`;
        status.textContent = 'Completed for this window';
        button.textContent = 'Come back later';
        button.disabled = true;
        return false;
      }
      if (lockUntil && Number.isFinite(lockUntil.getTime()) && now >= lockUntil) {
        localStorage.removeItem('PICKR_SPIN_LOCK_UNTIL');
      }

      const nextReset = getNextNoon(now);
      timer.textContent = `Resets at ${nextReset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      status.textContent = 'Ready to spin';
      button.textContent = 'Spin now';
      button.disabled = false;
      return true;
    };

    const awardTokens = (amount) => {
      const currentTokens = userProfile && typeof userProfile.tokens !== 'undefined'
        ? Number(userProfile.tokens)
        : getBalanceFromDom('.tokens', 0);
      const currentCash = userProfile && typeof userProfile.cash !== 'undefined'
        ? Number(userProfile.cash)
        : getBalanceFromDom('.cash', 0);
      const nextTokens = (Number.isFinite(currentTokens) ? currentTokens : 0) + amount;
      if (typeof updateBalances === 'function') {
        updateBalances(nextTokens, currentCash);
      } else {
        document.querySelectorAll('.tokens').forEach(el => { el.textContent = String(nextTokens); });
      }
    };

    button.addEventListener('click', async () => {
      if (spinning) return;
      if (!updateAvailability()) return;
      spinning = true;
      button.disabled = true;
      openModal();
      modalStatus.textContent = 'Spinning...';
      modalResult.textContent = 'Let the wheel decide.';
      try {
        let headers = { 'Content-Type': 'application/json' };
        if (window.firebase && firebase.auth) {
          try { await waitForAuthReady(); } catch (e) {}
        }
        if (window.firebase && firebase.auth && firebase.auth().currentUser) {
          const idToken = await firebase.auth().currentUser.getIdToken();
          headers.Authorization = 'Bearer ' + idToken;
        } else if (devUid) {
          headers['x-dev-uid'] = devUid;
        } else {
          modalStatus.textContent = 'Please sign in to spin.';
          modalResult.textContent = 'Sign in required for daily rewards.';
          status.textContent = 'Sign in required';
          button.disabled = false;
          spinning = false;
          return;
        }
        const resp = await fetch(getAPIBase() + '/api/spin/claim', { method: 'POST', headers, body: JSON.stringify({}) });
        const rawText = await resp.text();
        let data = {};
        try { data = rawText ? JSON.parse(rawText) : {}; } catch (e) { data = { error: rawText || 'Spin unavailable' }; }
        if (!resp.ok) {
          const nextAt = data && data.nextAvailableAt ? new Date(data.nextAvailableAt) : null;
          const errMsg = data && data.error ? data.error : 'Spin unavailable';
          if (nextAt && Number.isFinite(nextAt.getTime())) {
            timer.textContent = `Resets in ${formatCountdown(nextAt - Date.now())} (12:00 PM)`;
            localStorage.setItem('PICKR_SPIN_LOCK_UNTIL', nextAt.toISOString());
          }
          status.textContent = errMsg;
          modalStatus.textContent = errMsg;
          modalResult.textContent = 'Daily spin not available.';
          button.textContent = 'Come back later';
          button.disabled = true;
          spinning = false;
          return;
        }

        const reward = Number(data.reward || 0);
        const matching = rewards.map((value, idx) => value === reward ? idx : -1).filter(idx => idx >= 0);
        const pickIndex = matching.length ? matching[Math.floor(Math.random() * matching.length)] : 0;
        const centerAngle = (pickIndex * slice) + (slice / 2);
        const extraSpins = 4 + Math.floor(Math.random() * 2);
        const targetRotation = currentRotation + (extraSpins * 360) + (360 - centerAngle);
        currentRotation = targetRotation % 360;
        wheel.style.transform = `rotate(${targetRotation}deg)`;
        writeJSON('PICKR_SPIN_ROT', currentRotation);

        setTimeout(() => {
          spinning = false;
          const spinDate = data && data.spinDate ? String(data.spinDate) : getDateKey(new Date());
          localStorage.setItem('PICKR_SPIN_DATE', spinDate);
          const nextAvailable = data && data.nextAvailableAt ? new Date(data.nextAvailableAt) : getNextNoon(new Date());
          if (nextAvailable && Number.isFinite(nextAvailable.getTime())) {
            localStorage.setItem('PICKR_SPIN_LOCK_UNTIL', nextAvailable.toISOString());
            timer.textContent = `Resets in ${formatCountdown(nextAvailable - Date.now())} (12:00 PM)`;
          }
          if (Number.isFinite(reward) && reward > 0) awardTokens(reward);
          modalStatus.textContent = 'Reward confirmed';
          modalResult.textContent = `You won ${reward} Tokens!`;
          status.textContent = 'Reward added to your balance';
          button.textContent = 'Come back tomorrow';
          button.disabled = true;
          if (!nextAvailable || !Number.isFinite(nextAvailable.getTime())) {
            timer.textContent = 'Completed for today';
          }
        }, 4800);
      } catch (err) {
        console.warn('Spin claim failed:', err && err.message);
        status.textContent = 'Spin failed. Try again.';
        modalStatus.textContent = 'Spin failed. Try again.';
        modalResult.textContent = 'We could not complete your spin.';
        button.disabled = false;
        spinning = false;
      }
    });

    updateAvailability();
    setInterval(updateAvailability, 30000);
  }

  async function loadRecentBets(options = {}) {
    const { containerId = 'betHistoryContainer', days = 30, attempt = 0 } = options;
    const container = document.getElementById(containerId);
    const loader = document.getElementById('betHistoryLoader');
    if (!container) return;
    container.innerHTML = '';

    const summaryCount = document.getElementById('recentBetsCount');
    const summaryStake = document.getElementById('recentStakeTotal');
    const summaryRange = document.getElementById('recentTimeRange');
    if (summaryRange) summaryRange.textContent = `${days} days`;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    if (loader) loader.classList.remove('hidden');

    try {
      if (window.firebase && firebase.auth) {
        await waitForAuthReady();
      }
      await syncUserProfile();
      let headers = {};
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        const idToken = await firebase.auth().currentUser.getIdToken();
        headers.Authorization = 'Bearer ' + idToken;
      } else {
        const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);
        if (!devUid) {
          container.innerHTML = '<div class="empty-state">Please sign in to view your recent bets.</div>';
          if (summaryCount) summaryCount.textContent = '0';
          if (summaryStake) summaryStake.textContent = '$0.00';
          return;
        }
        headers['x-dev-uid'] = devUid;
      }

      const resp = await fetch(getAPIBase() + '/api/bets', { headers });
      if (resp.status === 401 || resp.status === 403) {
        container.innerHTML = '<div class="empty-state">Session expired. Please sign in again to view your bets.</div>';
        if (summaryCount) summaryCount.textContent = '0';
        if (summaryStake) summaryStake.textContent = '$0.00';
        return;
      }
      if (!resp.ok) {
        container.innerHTML = '<div class="empty-state">No bets found in the last 72 hours.</div>';
        if (summaryCount) summaryCount.textContent = '0';
        if (summaryStake) summaryStake.textContent = '$0.00';
        return;
      }

      const data = await resp.json();
      const bets = Array.isArray(data.bets) ? data.bets : [];
      const recent = bets
        .map((item) => {
          const placedAt = toMillis(item.placedAt || item.date || 0);
          return {
            item,
            placedAt: placedAt || Date.now()
          };
        })
        .filter((b) => b.placedAt >= cutoff)
        .sort((a, b) => b.placedAt - a.placedAt);

      const totalStake = recent.reduce((sum, b) => sum + Number(b.item.stake || b.item.amount || 0), 0);
      if (summaryCount) summaryCount.textContent = String(recent.length);
      if (summaryStake) summaryStake.textContent = `$${totalStake.toFixed(2)}`;

      if (recent.length === 0) {
        const totalBets = window.userProfile && window.userProfile.stats && typeof window.userProfile.stats.totalBets !== 'undefined'
          ? Number(window.userProfile.stats.totalBets)
          : null;
        if (totalBets && attempt < 1) {
          setTimeout(() => {
            loadRecentBets({ containerId, days, attempt: attempt + 1 });
          }, 1200);
          container.innerHTML = '<div class="empty-state">Syncing your bets. One moment...</div>';
          return;
        }
        const emptyMessage = 'No bets in the last 30 days. Try the Sports tab to place a new one.';
        container.innerHTML = `
          <div class="empty-state">
            <div>${emptyMessage}</div>
            <button id="betsRefresh" class="toggle-button" style="margin-top:1rem;">Refresh</button>
          </div>
        `;
        const refreshBtn = document.getElementById('betsRefresh');
        if (refreshBtn) {
          refreshBtn.addEventListener('click', () => {
            loadRecentBets({ containerId, days, attempt: 0 });
          });
        }
        return;
      }

      recent.forEach(({ item, placedAt }) => {
        const stakeCurrency = String(item.stakeCurrency || 'tokens').toLowerCase();
        const stakeTokens = Number(item.stakeTokens || 0);
        const stakeCash = Number(item.stakeCash || 0);
        const stakeValue = Number(item.stake || 0);
        const tokenToCashRate = Number(item.tokenToCashRate || 0.01);
        const isToken = stakeCurrency === 'tokens';
        const stakeTokensValue = stakeTokens || (isToken ? stakeValue : 0);
        const stakeCashValue = stakeCash || (!isToken ? stakeValue : Math.round(stakeTokensValue * tokenToCashRate * 100) / 100);
        const stakeDisplay = isToken
          ? `${stakeTokensValue.toFixed(0)} Tokens`
          : `$${stakeCashValue.toFixed(2)} Cash`;
        const selectionItems = (item.selections && item.selections.length)
          ? item.selections
          : [{ pick: item.team || item.description || 'Selection' }];
        const picks = selectionItems.map((s) => s.pick).filter(Boolean).join(', ');
        const placedLabel = new Date(placedAt || Date.now()).toLocaleString();
        const settledAtMs = item.settledAt ? toMillis(item.settledAt) : 0;
        const statusRaw = String(item.status || (settledAtMs ? 'settled' : 'pending')).toLowerCase();
        const statusLabel = statusRaw === 'won'
          ? 'WON'
          : statusRaw === 'lost'
            ? 'LOST'
            : statusRaw === 'void'
              ? 'VOID'
              : statusRaw === 'settled'
                ? 'SETTLED'
                : 'PENDING';
        const statusClass = statusRaw === 'won'
          ? 'bet-card--won'
          : statusRaw === 'lost'
            ? 'bet-card--lost'
            : statusRaw === 'void'
              ? 'bet-card--void'
              : 'bet-card--pending';
        const statusPillClass = statusRaw === 'won'
          ? 'bet-card__pill--won'
          : statusRaw === 'lost'
            ? 'bet-card__pill--lost'
            : statusRaw === 'void'
              ? 'bet-card__pill--void'
              : statusRaw === 'settled'
                ? 'bet-card__pill--settled'
                : 'bet-card__pill--pending';
        const statusDetail = settledAtMs
          ? `Settled ${new Date(settledAtMs).toLocaleString()}`
          : 'Awaiting results';
        const combinedOdds = Number(item.combinedOdds || 0);
        const oddsLabel = combinedOdds > 0 ? `${combinedOdds.toFixed(2)}x` : '—';
        const stakeLabel = isToken ? 'Tokens' : 'Cash';
        const potentialRaw = Number(item.potentialPayout || 0);
        const potentialWin = potentialRaw > 0
          ? potentialRaw
          : (combinedOdds > 1 ? stakeCashValue * combinedOdds : 0);
        const potentialDisplay = potentialWin ? `$${potentialWin.toFixed(2)}` : '—';
        const isParlay = String(item.type || '').toLowerCase() === 'parlay' || selectionItems.length > 1;
        const typeLabel = isParlay ? `PARLAY ${selectionItems.length}-LEG` : 'SINGLE';
        const cashNote = isToken
          ? `<div class="bet-card__sub"><span>Token value</span><span>$${escapeHtml(stakeCashValue.toFixed(2))} cash</span></div>`
          : '';
        const card = document.createElement('article');
        card.className = `bet-card ${statusClass}`;
        card.innerHTML = `
          <div class="bet-card__meta">
            <div class="bet-card__amount">${escapeHtml(stakeDisplay)}</div>
            <div class="bet-card__time">${escapeHtml(formatRelativeTime(placedAt))}</div>
          </div>
          <div class="bet-card__title">${escapeHtml(picks)}</div>
          <div class="bet-card__status">
            <span class="bet-card__pill ${statusPillClass}">${escapeHtml(statusLabel)}</span>
            <span class="bet-card__status-text">${escapeHtml(statusDetail)}</span>
          </div>
          <div class="bet-card__sub">
            <span>${escapeHtml(placedLabel)}</span>
            <span class="bet-card__pill-row">
              <span class="bet-card__pill bet-card__pill--type">${escapeHtml(typeLabel)}</span>
            </span>
          </div>
          <div class="bet-card__sub">
            <span>Placed with</span>
            <span>${escapeHtml(stakeLabel)}</span>
          </div>
          <div class="bet-card__sub">
            <span>Odds</span>
            <span>${escapeHtml(oddsLabel)}</span>
          </div>
          ${cashNote}
          <div class="bet-card__sub">
            <span>Potential win</span>
            <span>${escapeHtml(potentialDisplay)}</span>
          </div>
        `;
        const legsWrap = document.createElement('div');
        legsWrap.className = isParlay ? 'bet-legs bet-legs--stack' : 'bet-legs';
        selectionItems.forEach((selection, index) => {
          const leg = document.createElement('div');
          leg.className = 'bet-leg';
          const name = String(selection.pick || selection.team || selection.name || 'Selection');
          const homeTeam = selection.homeTeam || selection.home || '';
          const awayTeam = selection.awayTeam || selection.away || '';
          const matchup = homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : '';
          const marketType = String(selection.marketType || selection.market || '').toLowerCase();
          const marketLabel = marketType && marketType !== 'h2h'
            ? `Prop: ${marketType.replace(/_/g, ' ').toUpperCase()}`
            : '';
          const oddsLabel = typeof selection.odds !== 'undefined' && selection.odds !== null
            ? `Odds ${Number(selection.odds).toFixed(2)}x`
            : '';
          const metaParts = [matchup, marketLabel, oddsLabel].filter(Boolean);
          const logo = document.createElement('img');
          logo.className = 'bet-leg__logo';
          logo.alt = name;
          applyTeamLogo(logo, name);
          const textWrap = document.createElement('div');
          textWrap.className = 'bet-leg__text';
          const title = document.createElement('div');
          title.className = 'bet-leg__name';
          title.textContent = name;
          const meta = document.createElement('div');
          meta.className = 'bet-leg__meta';
          meta.textContent = metaParts.join(' • ');
          textWrap.appendChild(title);
          if (metaParts.length) textWrap.appendChild(meta);
          if (isParlay) {
            const idx = document.createElement('div');
            idx.className = 'bet-leg__index';
            idx.textContent = String(index + 1);
            leg.appendChild(idx);
          }
          leg.appendChild(logo);
          leg.appendChild(textWrap);
          legsWrap.appendChild(leg);
        });
        const titleEl = card.querySelector('.bet-card__title');
        if (titleEl) titleEl.insertAdjacentElement('afterend', legsWrap);
        container.appendChild(card);
      });
      if (loader) loader.classList.add('hidden');
    } catch (e) {
      console.warn('Failed to load recent bets:', e && e.message);
      container.innerHTML = '<div class="empty-state">Failed to load bets. Try again shortly.</div>';
      if (summaryCount) summaryCount.textContent = '0';
      if (summaryStake) summaryStake.textContent = '$0.00';
      if (loader) loader.classList.add('hidden');
    }
  }

  // --- Utilities ---
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }

  function setupBetSlipMobile() {
    const slip = document.getElementById('betSlipContainer');
    const overlay = document.getElementById('betSlipOverlay');
    const toggle = document.getElementById('betSlipToggle');
    if (!slip || !overlay || !toggle) return;

    const openSlip = () => {
      overlay.classList.remove('hidden');
      slip.classList.add('open');
    };
    const closeSlip = () => {
      overlay.classList.add('hidden');
      slip.classList.remove('open');
    };
    const toggleSlip = () => {
      if (slip.classList.contains('open')) {
        closeSlip();
      } else {
        openSlip();
      }
    };

    toggle.addEventListener('click', toggleSlip);
    overlay.addEventListener('click', closeSlip);
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) closeSlip();
    });
  }

  // make functions available for pages that call them
  window.PickrApp = {
    loadPicks, loadWalletPage, loadRecentBets, refreshHeaders, addSelection
  };

  // Setup page interactions when DOM ready
  document.addEventListener('DOMContentLoaded', async () => {
    // Ensure we synchronise the authoritative profile first so token/cash
    // values are available to all pages (sports, wallet, picks).
    try { await syncUserProfile(); } catch (e) { console.warn('syncUserProfile failed on load', e); }
    refreshHeaders(); updateQuestTasks(userProfile); renderBetSlip(); setupConfirmBet(); setupBetSlipMobile();
    // If Firebase is available, sync the user's token balance from server
    if (window.firebase && firebase.auth) {
      // Sync once on load if already signed in
      if (firebase.auth().currentUser) syncUserProfile();
      // Also react to auth state changes to keep client in sync
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          syncUserProfile();
        } else {
          userProfile = null;
          refreshHeaders();
          updateQuestTasks(null);
        }
      });
    } else {
      // no firebase — just refresh headers (will show zeroed balance until user signs in)
      refreshHeaders();
      updateQuestTasks(null);
    }

    // bind dynamic pick buttons (if picks are already on the page)
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.select-team'); if (!btn) return;
      // handled in createPickCard; the global handler ensures existing markup works too
      const match = btn.getAttribute('data-match');
      const team = btn.getAttribute('data-team');
      const oddsAttr = btn.getAttribute('data-odds');
      const oddsVal = oddsAttr ? Number(oddsAttr) : null;
      addSelection(match, team, oddsVal, {
        sportKey: btn.getAttribute('data-sport') || '',
        startTime: btn.getAttribute('data-start') || '',
        homeTeam: btn.getAttribute('data-home') || '',
        awayTeam: btn.getAttribute('data-away') || ''
      });
      btn.classList.add('bg-red-600','text-white');
      document.querySelectorAll(`.select-team[data-match="${match}"]`).forEach(s=>{ if (s!==btn){ s.disabled = true; s.classList.add('opacity-50'); }});
    });

    // If the page has sport category tabs (index.html), wire them to load picks
    const sportTabsContainer = document.getElementById('sportTabs');
      if (sportTabsContainer) {
      const tabs = sportTabsContainer.querySelectorAll('.sport-tab');
      tabs.forEach(t => t.addEventListener('click', () => {
        tabs.forEach(x => x.classList.remove('bg-red-600'));
        t.classList.add('bg-red-600');
        const s = t.dataset.sport || 'all';
        // load picks for this sport into the page's picksContainer
        loadPicks(s);
        try { localStorage.setItem('PICKR_LAST_PICKS_REFRESH', String(Date.now())); } catch (e) {}
      }));
      // load default (first) tab immediately
      const first = sportTabsContainer.querySelector('.sport-tab');
      if (first) {
        first.classList.add('bg-red-600');
        const s = first.dataset.sport || 'all';
        const lastRefresh = Number(localStorage.getItem('PICKR_LAST_PICKS_REFRESH') || 0);
        if (!lastRefresh || (Date.now() - lastRefresh) > 24 * 60 * 60 * 1000) {
          loadPicks(s);
          try { localStorage.setItem('PICKR_LAST_PICKS_REFRESH', String(Date.now())); } catch (e) {}
        } else {
          loadPicks(s);
        }
      }
    }

    const betHistoryEl = document.getElementById('betHistory');
    if (betHistoryEl) {
      setInterval(() => { loadWalletPage(); }, 60 * 60 * 1000);
    }
    const recentBetsEl = document.getElementById('betHistoryContainer');
    if (recentBetsEl) {
      setInterval(() => { loadRecentBets({ containerId: 'betHistoryContainer', days: 30, attempt: 0 }); }, 60 * 60 * 1000);
    }

    const betAction = document.getElementById('firstBetTaskButton');
    if (betAction) {
      betAction.addEventListener('click', (event) => {
        if (betAction.getAttribute('data-claim-ready') === 'true') {
          event.preventDefault();
          claimQuestReward('first-bet');
        }
      });
    }
    const parlayAction = document.getElementById('firstParlayTaskButton');
    if (parlayAction) {
      parlayAction.addEventListener('click', (event) => {
        if (parlayAction.getAttribute('data-claim-ready') === 'true') {
          event.preventDefault();
          claimQuestReward('first-parlay');
        }
      });
    }

    initDailySpin();
    loadNbaStatsSection();
  });

})();