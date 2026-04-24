(function () {
  // pickr shared script
  // exports window.PickrApp with loadPicks and loadWalletPage

  // --- Swipe-from-left-edge → back (app-like gesture) ---
  (function () {
    if (!('ontouchstart' in window)) return;
    let startX = 0, startY = 0, startTime = 0, tracking = false;
    const EDGE = 30, MIN_DIST = 60, MAX_Y = 80, MAX_MS = 400;
    document.addEventListener('touchstart', function (e) {
      const t = e.touches[0];
      if (t.clientX <= EDGE) { startX = t.clientX; startY = t.clientY; startTime = Date.now(); tracking = true; }
      else { tracking = false; }
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX, dy = Math.abs(t.clientY - startY), dt = Date.now() - startTime;
      if (dx >= MIN_DIST && dy <= MAX_Y && dt <= MAX_MS && history.length > 1) {
        history.back();
      }
    }, { passive: true });
  })();

  // --- Utilities ---
  const readJSON = (k, fallback = null) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  function getCurrentUid() {
    if (userProfile && userProfile.uid) return String(userProfile.uid);
    try {
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        return String(firebase.auth().currentUser.uid);
      }
    } catch (e) { /* ignore */ }
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);
    return devUid ? String(devUid) : null;
  }

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

  const AVATAR_PRESETS = {
    'avatar-1': { skin: '#f8d7c1', hair: '#5a2a18', lip: '#c2410c', hairStyle: 'short', jersey: '#0ea5e9', accent: '#082f49' },
    'avatar-2': { skin: '#f2c8a0', hair: '#1f2937', lip: '#b45309', hairStyle: 'fade', jersey: '#22c55e', accent: '#064e3b' },
    'avatar-3': { skin: '#f4d6b0', hair: '#0f172a', lip: '#c2410c', hairStyle: 'spike', jersey: '#f97316', accent: '#7c2d12' },
    'avatar-4': { skin: '#efc9a2', hair: '#334155', lip: '#c2410c', hairStyle: 'cap', jersey: '#a855f7', accent: '#4c1d95' },
    'avatar-5': { skin: '#f5d3c8', hair: '#7f1d1d', lip: '#be185d', hairStyle: 'long', jersey: '#ef4444', accent: '#7f1d1d' },
    'avatar-6': { skin: '#f2d1b3', hair: '#312e81', lip: '#be185d', hairStyle: 'bob', jersey: '#facc15', accent: '#713f12' }
  };
  const AVATAR_ALIASES = {
    rockstar: 'avatar-3',
    'rock-star': 'avatar-3',
    spike: 'avatar-3'
  };
  const AVATAR_HAIR_CLASSES = ['hair-short', 'hair-fade', 'hair-spike', 'hair-cap', 'hair-long', 'hair-bob'];

  function ensureAvatarStyles() {
    if (document.getElementById('pickr-avatar-styles')) return;
    const style = document.createElement('style');
    style.id = 'pickr-avatar-styles';
    style.textContent = `
      .pickr-avatar{--size:40px;--skin:#f8d7c1;--hair:#1f2937;--lip:#c2410c;--jersey:#0ea5e9;--accent:#0f172a;width:var(--size);height:var(--size);min-width:var(--size);min-height:var(--size);max-width:var(--size);max-height:var(--size);aspect-ratio:1/1;display:inline-flex;flex:0 0 var(--size);align-items:center;justify-content:center;border-radius:999px;background:var(--skin);position:relative;overflow:hidden;box-sizing:border-box;border:1px solid rgba(255,255,255,0.18);box-shadow:0 8px 16px rgba(0,0,0,0.25);transform:translateZ(0);will-change:transform;contain:layout style size;isolation:isolate;} 
      .pickr-avatar .hair{position:absolute;left:-6%;top:-10%;width:112%;height:48%;background:var(--hair);border-bottom-left-radius:60% 80%;border-bottom-right-radius:60% 80%;transform:translateZ(0);}
      .pickr-avatar.hair-long .hair{height:62%;border-bottom-left-radius:70% 90%;border-bottom-right-radius:70% 90%;}
      .pickr-avatar.hair-bob .hair{height:58%;border-bottom-left-radius:70% 80%;border-bottom-right-radius:70% 80%;}
      .pickr-avatar.hair-cap .hair{height:44%;border-bottom-left-radius:90% 100%;border-bottom-right-radius:90% 100%;}
      .pickr-avatar.hair-fade .hair{height:42%;}
      .pickr-avatar.hair-spike .hair{height:46%;-webkit-clip-path:polygon(0 100%,12% 42%,24% 100%,38% 40%,50% 100%,62% 42%,76% 100%,90% 40%,100% 100%);clip-path:polygon(0 100%,12% 42%,24% 100%,38% 40%,50% 100%,62% 42%,76% 100%,90% 40%,100% 100%);} 
      .pickr-avatar.avatar-compact .hair{top:-12%;}
      .pickr-avatar.avatar-compact.hair-spike .hair{height:46%;-webkit-clip-path:none;clip-path:none;border-bottom-left-radius:60% 80%;border-bottom-right-radius:60% 80%;} 
      .pickr-avatar .eye{position:absolute;top:46%;width:10%;height:10%;background:#111827;border-radius:999px;}
      .pickr-avatar .eye.left{left:30%;}
      .pickr-avatar .eye.right{right:30%;}
      .pickr-avatar .mouth{position:absolute;top:63%;left:35%;width:30%;height:6%;border-radius:999px;background:var(--lip);opacity:0.8;}
      .pickr-avatar .jersey{position:absolute;left:-10%;right:-10%;bottom:-8%;height:40%;background:var(--jersey);border-top:2px solid rgba(255,255,255,0.35);box-shadow:inset 0 10px 18px rgba(0,0,0,0.2);} 
      .pickr-avatar .jersey::after{content:'';position:absolute;left:50%;top:10%;width:30%;height:22%;transform:translateX(-50%);border-radius:999px;background:rgba(255,255,255,0.2);} 
      .pickr-avatar .badge{position:absolute;right:6%;bottom:6%;min-width:34%;padding:2px 4px;border-radius:999px;background:var(--accent);color:#f8fafc;font-size:0.46rem;font-weight:700;letter-spacing:0.12em;text-align:center;border:1px solid rgba(255,255,255,0.2);}
    `;
    document.head.appendChild(style);
  }

  function normalizeAvatarId(avatarId) {
    if (!avatarId) return '';
    const raw = String(avatarId).trim();
    if (!raw) return '';
    if (AVATAR_PRESETS[raw]) return raw;
    const lower = raw.toLowerCase();
    if (AVATAR_PRESETS[lower]) return lower;
    if (AVATAR_ALIASES[lower]) return AVATAR_ALIASES[lower];
    return raw;
  }

  function getAvatarPreset(avatarId) {
    const normalized = normalizeAvatarId(avatarId);
    return AVATAR_PRESETS[normalized] || AVATAR_PRESETS['avatar-1'];
  }

  function renderAvatar(el, avatarId) {
    if (!el) return;
    ensureAvatarStyles();
    const preset = getAvatarPreset(avatarId);
    const sizeAttr = el.getAttribute('data-size');
    let size = sizeAttr ? Number(sizeAttr) : 40;
    if (!Number.isFinite(size) || size <= 0) size = 40;
    AVATAR_HAIR_CLASSES.forEach((cls) => el.classList.remove(cls));
    el.classList.remove('avatar-compact');
    el.classList.add('pickr-avatar', `hair-${preset.hairStyle}`);
    el.style.setProperty('--size', `${size}px`);
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.minWidth = `${size}px`;
    el.style.minHeight = `${size}px`;
    el.style.flexShrink = '0';
    if (Number.isFinite(size) && size <= 32) el.classList.add('avatar-compact');
    el.style.setProperty('--skin', preset.skin);
    el.style.setProperty('--hair', preset.hair);
    el.style.setProperty('--lip', preset.lip);
    el.style.setProperty('--jersey', preset.jersey);
    el.style.setProperty('--accent', preset.accent);
    el.innerHTML = '<span class="hair"></span><span class="eye left"></span><span class="eye right"></span><span class="mouth"></span><span class="jersey"></span>';
  }

  function refreshAvatars() {
    const fallbackAvatar = userProfile && userProfile.avatarId ? String(userProfile.avatarId) : 'avatar-1';
    document.querySelectorAll('.pickr-avatar').forEach((el) => {
      const explicit = el.getAttribute('data-avatar-id');
      const avatarId = explicit || fallbackAvatar;
      renderAvatar(el, avatarId);
    });
  }

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

    const screenName = userProfile && userProfile.screenName
      ? String(userProfile.screenName)
      : (userProfile && userProfile.fullName ? String(userProfile.fullName) : 'Player');
    document.querySelectorAll('.header-screen-name').forEach(el => { el.textContent = screenName; });
    refreshAvatars();
  }

  const ONBOARDING_BYPASS_PREFIXES = [
    '/onboarding',
    '/login',
    '/profile',
    '/terms',
    '/faq',
    '/contact',
    '/about',
    '/careers',
    '/maintenance',
    '/signout'
  ];

  function normalizePath(pathname) {
    if (!pathname) return '';
    let out = String(pathname).toLowerCase();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  }

  function shouldBypassOnboardingGuard() {
    const path = normalizePath(window.location && window.location.pathname);
    if (!path) return false;
    return ONBOARDING_BYPASS_PREFIXES.some((prefix) => {
      return path === prefix || path === `${prefix}.html` || path.startsWith(`${prefix}/`);
    });
  }

  function enforceOnboarding(profile) {
    if (!profile || profile.profileComplete) return;
    if (shouldBypassOnboardingGuard()) return;
    window.location.replace('/onboarding.html');
  }

  // Ensure this script refreshes headers when other modules broadcast balance updates
  try {
    window.addEventListener('pickr:balances-updated', () => {
      try { refreshHeaders(); } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }

  // --- Bet slip ---
  const betSlip = {}; // { matchId: { team, stake, odds, sportKey, startTime, homeTeam, awayTeam, marketType, propTitle, propLine }}
  const pickMeta = {}; // matchId -> { sportKey, startTime, homeTeam, awayTeam }
  let betMode = 'parlay'; // 'parlay' | 'straight'
  let betCurrency = 'tokens'; // 'tokens' | 'cash'
  try {
    const savedCurrency = localStorage.getItem('PICKR_BET_CURRENCY');
    if (savedCurrency === 'cash' || savedCurrency === 'tokens') {
      betCurrency = savedCurrency;
    }
  } catch (e) { /* ignore */ }
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
      : (userProfile && typeof userProfile.cashBalance !== 'undefined' ? Number(userProfile.cashBalance) : getBalanceFromDom('.cash', 0));
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
        try { localStorage.setItem('PICKR_BET_CURRENCY', betCurrency); } catch (e) { /* ignore */ }
        renderBetSlip();
      });
    }
  }

  function addSelection(matchId, team, odds, meta) {
    const resolvedMeta = meta && typeof meta === 'object' ? meta : (pickMeta[matchId] || {});
    betSlip[matchId] = betSlip[matchId] || { team, stake: 0, odds: null, sportKey: null, startTime: null, homeTeam: null, awayTeam: null, marketType: null, propTitle: null, propLine: null };
    betSlip[matchId].team = team;
    if (resolvedMeta.sportKey) betSlip[matchId].sportKey = resolvedMeta.sportKey;
    if (resolvedMeta.startTime) betSlip[matchId].startTime = resolvedMeta.startTime;
    if (resolvedMeta.homeTeam) betSlip[matchId].homeTeam = resolvedMeta.homeTeam;
    if (resolvedMeta.awayTeam) betSlip[matchId].awayTeam = resolvedMeta.awayTeam;
    if (resolvedMeta.marketType) betSlip[matchId].marketType = resolvedMeta.marketType;
    if (resolvedMeta.propTitle) betSlip[matchId].propTitle = resolvedMeta.propTitle;
    if (resolvedMeta.propLine) betSlip[matchId].propLine = resolvedMeta.propLine;
    if (typeof odds === 'undefined' || odds === null) {
      console.warn('Missing odds for selection', { matchId, team });
      showBetToast('error', 'Missing odds for this selection.');
      return;
    }
    const sanitizedOdds = sanitizeOddsValue(odds, { matchId, team, source: 'selection' });
    if (!sanitizedOdds) {
      showBetToast('error', 'Invalid odds for this selection.');
      return;
    }
    betSlip[matchId].odds = sanitizedOdds;
    if (Object.keys(betSlip).length < 2) {
      betMode = 'straight';
    }
    renderBetSlip();
  }

  const BET_MIN_SPINNER_MS = 1500;
  const BET_RESULT_HOLD_MS = 1000;
  const BET_TOAST_DURATION_MS = 3000;
  let betToastTimer = null;

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getBetOverlayNodes() {
    const overlay = document.getElementById('betPlacementOverlay');
    if (!overlay) return null;
    return {
      overlay,
      iconWrap: document.getElementById('betPlacementIcon'),
      spinner: document.getElementById('betPlacementSpinner'),
      check: document.getElementById('betPlacementCheck'),
      cross: document.getElementById('betPlacementCross'),
      text: document.getElementById('betPlacementText')
    };
  }

  function showBetOverlay(state = 'loading') {
    const nodes = getBetOverlayNodes();
    if (!nodes) return;
    const { overlay, iconWrap, spinner, check, cross, text } = nodes;

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    requestAnimationFrame(() => overlay.classList.add('is-visible'));

    if (spinner) spinner.classList.toggle('hidden', state !== 'loading');
    if (check) check.classList.toggle('hidden', state !== 'success');
    if (cross) cross.classList.toggle('hidden', state !== 'error');

    if (text) {
      text.textContent = state === 'success' ? 'Bet Confirmed' : state === 'error' ? 'Bet Failed' : 'Placing Bet...';
    }

    if (iconWrap) {
      iconWrap.classList.remove('bet-pop');
      if (state !== 'loading') {
        void iconWrap.offsetWidth;
        iconWrap.classList.add('bet-pop');
      }
    }
  }

  function hideBetOverlay() {
    const nodes = getBetOverlayNodes();
    if (!nodes) return;
    const { overlay } = nodes;
    overlay.classList.add('is-fading');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('flex', 'is-visible', 'is-fading');
    }, 250);
  }

  function ensureBetToast() {
    let toast = document.getElementById('betPlacedToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'betPlacedToast';
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.className = 'fixed left-1/2 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-[70] inline-flex items-center gap-3 rounded-full border border-white/10 px-4 py-3 text-sm font-semibold shadow-2xl transition-all duration-300 -translate-x-1/2 translate-y-4 opacity-0 pointer-events-none';
    toast.innerHTML = '<span id="betPlacedToastIcon" class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-sm"></span><span id="betPlacedToastText"></span>';
    return toast;
  }

  function showBetToast(state = 'success', message) {
    const toast = ensureBetToast();
    const icon = document.getElementById('betPlacedToastIcon');
    const text = document.getElementById('betPlacedToastText');
    if (!toast || !icon || !text) return;
    toast.classList.remove('bg-emerald-500/90', 'bg-rose-500/90', 'text-white');
    if (state === 'error') {
      toast.classList.add('bg-rose-500/90', 'text-white');
      icon.textContent = '✖';
    } else {
      toast.classList.add('bg-emerald-500/90', 'text-white');
      icon.textContent = '✔';
    }
    text.textContent = message || (state === 'error' ? 'Bet Failed' : 'Bet Successfully Placed ✔');
    toast.classList.add('opacity-100', 'translate-y-0');
    toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
    if (betToastTimer) clearTimeout(betToastTimer);
    betToastTimer = setTimeout(() => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
    }, BET_TOAST_DURATION_MS);
  }

  function hideBetToast() {
    const toast = document.getElementById('betPlacedToast');
    if (!toast) return;
    if (betToastTimer) clearTimeout(betToastTimer);
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
  }

  // confirm bet flow
  function setupConfirmBet() {
    const confirmBtn = document.getElementById('confirmBet');
    if (!confirmBtn) return;
    confirmBtn.addEventListener('click', async () => {
      const startedAt = Date.now();
      confirmBtn.disabled = true;
      confirmBtn.classList.add('opacity-60', 'cursor-not-allowed');
      showBetOverlay('loading');
      const entries = Object.entries(betSlip);
      const failFlow = async (reason, alertMessage) => {
        const elapsed = Date.now() - startedAt;
        await wait(Math.max(0, BET_MIN_SPINNER_MS - elapsed));
        showBetOverlay('error');
        await wait(BET_RESULT_HOLD_MS);
        hideBetOverlay();
        showBetToast('error', 'Bet Failed');
        if (alertMessage) alert(alertMessage);
      };
      const successFlow = async () => {
        const elapsed = Date.now() - startedAt;
        await wait(Math.max(0, BET_MIN_SPINNER_MS - elapsed));
        showBetOverlay('success');
        await wait(BET_RESULT_HOLD_MS);
        hideBetOverlay();
      };

      if (entries.length === 0) {
        await failFlow('empty', 'No selections to place.');
        confirmBtn.disabled = false;
        confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        return;
      }
      // Check if any selected game has already started
      const nowCheck = Date.now();
      for (const [matchId, info] of entries) {
        const st = info.startTime ? new Date(info.startTime).getTime() : NaN;
        if (Number.isFinite(st) && st <= nowCheck) {
          // Remove the started game from the bet slip
          delete betSlip[matchId];
          renderBetSlip();
          await failFlow('started', 'One or more games have already started. They have been removed from your bet slip.');
          confirmBtn.disabled = false;
          confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
          return;
        }
      }
      // require authentication and server-side tokens (or allow dev header)
      const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);
      if (!window.firebase || !firebase.auth || !firebase.auth().currentUser) {
        if (!devUid) {
          await failFlow('auth', 'Please sign in to place bets.');
          confirmBtn.disabled = false;
          confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
          return;
        }
      }
      const useParlay = entries.length > 1 && betMode === 'parlay';
      let total = 0;
      if (useParlay) {
        if (!parlayStake || parlayStake <= 0) {
          await failFlow('stake', 'Please enter a parlay stake.');
          confirmBtn.disabled = false;
          confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
          return;
        }
        total = parlayStake;
      } else {
        for (const [, { stake }] of entries) {
          if (!stake || stake <= 0) {
            await failFlow('stake', 'Please set a stake for every selection.');
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
            return;
          }
          total += stake;
        }
      }
      const currentTokens = userProfile && typeof userProfile.tokens !== 'undefined'
        ? Number(userProfile.tokens)
        : getBalanceFromDom('.tokens', 0);
      const currentCash = userProfile && typeof userProfile.cash !== 'undefined'
        ? Number(userProfile.cash)
        : (userProfile && typeof userProfile.cashBalance !== 'undefined' ? Number(userProfile.cashBalance) : getBalanceFromDom('.cash', 0));
      if (betCurrency === 'tokens') {
        const totalTokens = Math.trunc(total);
        if (totalTokens > currentTokens) {
          await failFlow('balance', 'Insufficient token balance.');
          confirmBtn.disabled = false;
          confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
          return;
        }
      } else {
        const totalCash = Number(total) || 0;
        if (totalCash > currentCash) {
          await failFlow('balance', 'Insufficient cash balance.');
          confirmBtn.disabled = false;
          confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
          return;
        }
      }

      try {
        let rewardTokens = 0;
        const selections = entries.map(([matchId, info]) => ({
          eventId: matchId,
          marketType: info.marketType || 'h2h',
          pick: info.team,
          odds: info.odds || null,
          sportKey: info.sportKey || null,
          commenceTime: info.startTime || null,
          homeTeam: info.homeTeam || null,
          awayTeam: info.awayTeam || null,
          propTitle: info.propTitle || null,
          propLine: info.propLine || null
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
          const resp = await fetch(getAPIBase() + '/api/bets/place', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              selections,
              stake: betCurrency === 'tokens' ? stakeTokens : stakeCash,
              type: 'parlay',
              currency: betCurrency,
              stakeCurrency: betCurrency,
              stakeCash: betCurrency === 'cash' ? stakeCash : undefined,
              stakeTokens: betCurrency === 'tokens' ? stakeTokens : undefined,
              parlayIntent: true,
              parlayLegs: selections.length
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
          try {
            const uid = getCurrentUid();
            if (uid) {
              localStorage.setItem('PICKR_FIRST_BET_UID', uid);
              localStorage.setItem('PICKR_PARLAY_UID', uid);
            }
          } catch (e) {}
        } else {
          for (const [matchId, info] of entries) {
            const resp = await fetch(getAPIBase() + '/api/bets/place', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                selections: [{
                  eventId: matchId,
                  marketType: info.marketType || 'h2h',
                  pick: info.team,
                  odds: info.odds || null,
                  sportKey: info.sportKey || null,
                  commenceTime: info.startTime || null,
                  homeTeam: info.homeTeam || null,
                  awayTeam: info.awayTeam || null,
                  propTitle: info.propTitle || null,
                  propLine: info.propLine || null
                }],
                stake: betCurrency === 'tokens' ? Math.trunc(info.stake || 0) : Number(info.stake || 0),
                type: 'single',
                currency: betCurrency,
                stakeCurrency: betCurrency,
                stakeCash: betCurrency === 'cash' ? Number(info.stake || 0) : undefined,
                stakeTokens: betCurrency === 'tokens' ? Math.trunc(info.stake || 0) : undefined,
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
            try {
              const uid = getCurrentUid();
              if (uid) localStorage.setItem('PICKR_FIRST_BET_UID', uid);
            } catch (e) {}
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
        await successFlow();
        confirmBtn.disabled = false;
        confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        return;
      } catch (err) {
        console.warn('Server bet placement failed:', err && err.message);
        await failFlow('server', 'Failed to place bet on server: ' + (err && err.message ? err.message : 'unknown error'));
        confirmBtn.disabled = false;
        confirmBtn.classList.remove('opacity-60', 'cursor-not-allowed');
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
  const API_SPORTSDATA_ODDS = () => getAPIBase() + '/api/sportsdata/odds';
  const SPORTSDATA_SPORTS = new Set(['nba', 'nfl', 'nhl', 'mlb', 'soccer']);

  function slugify(name = '') { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
  function fmtDate(iso = '') { try { return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso; } }

  function normalizeLogoSportKey(sportKey) {
    const key = String(sportKey || '').toLowerCase();
    if (key.includes('nba')) return 'nba';
    if (key.includes('nfl') || key.includes('football')) return 'nfl';
    if (key.includes('nhl') || key.includes('hockey')) return 'nhl';
    if (key.includes('mlb') || key.includes('baseball')) return 'mlb';
    if (key.includes('soccer') || key.includes('fifa')) return 'soccer';
    return '';
  }

  function applyTeamLogo(imgEl, teamName, sportKey) {
    if (!imgEl || !teamName) return;
    const fallback = '/images/logos/logo-placeholder.png';
    const apiBase = getAPIBase();
    const sportParam = normalizeLogoSportKey(sportKey);
    const sportQuery = sportParam ? `&sport=${encodeURIComponent(sportParam)}` : '';
    const proxyUrl = `${apiBase}/api/teams/logo/image?name=${encodeURIComponent(teamName)}&league=12&season=2024${sportQuery}&ts=${Date.now()}`;
    imgEl.src = fallback;
    imgEl.onerror = () => { imgEl.src = fallback; };
    imgEl.src = proxyUrl;
  }

  const ODDS_MIN = 1.01;
  const ODDS_MAX = 20;

  function logInvalidOdds(raw, context, reason) {
    const payload = Object.assign({ raw, reason }, context || {});
    console.warn('Invalid odds value', payload);
  }

  function sanitizeOddsValue(raw, context) {
    if (raw === null || typeof raw === 'undefined' || raw === '') return null;
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      logInvalidOdds(raw, context, 'not-finite');
      return null;
    }

    let decimal = null;
    if (Math.abs(num) >= 100 || num <= -100) {
      decimal = num > 0 ? (1 + num / 100) : (1 + 100 / Math.abs(num));
    } else if (num > 1) {
      decimal = num;
    } else {
      logInvalidOdds(raw, context, 'non-positive');
      return null;
    }

    if (!Number.isFinite(decimal)) {
      logInvalidOdds(raw, context, 'conversion');
      return null;
    }
    if (decimal < ODDS_MIN || decimal > ODDS_MAX) {
      logInvalidOdds(raw, context, 'out-of-range');
      return null;
    }
    return Number(decimal.toFixed(2));
  }

  function normalizeOddsValue(raw, context) {
    return sanitizeOddsValue(raw, context);
  }

  function readStat(obj, keys) {
    for (const key of keys) {
      if (obj && typeof obj[key] !== 'undefined' && obj[key] !== null) return obj[key];
    }
    return null;
  }

  function readMoneyline(obj, keys) {
    for (const key of keys) {
      if (obj && typeof obj[key] !== 'undefined' && obj[key] !== null) return obj[key];
    }
    return null;
  }

  function pickBestDecimalOdds(game, side) {
    const sideKeys = side === 'home'
      ? ['HomeMoneyLine', 'HomeTeamMoneyLine', 'HomeMoneyline', 'HomeTeamMoneyline']
      : side === 'away'
        ? ['AwayMoneyLine', 'AwayTeamMoneyLine', 'AwayMoneyline', 'AwayTeamMoneyline']
        : ['DrawMoneyLine', 'TieMoneyLine', 'DrawMoneyline', 'TieMoneyline'];

    const direct = readMoneyline(game, sideKeys);
    const directVal = normalizeOddsValue(direct, { source: 'sportsdata', side, eventId: readStat(game, ['GameID', 'GameId', 'GameKey']) || null });
    if (directVal) return directVal;

    const arrays = ['PregameOdds', 'Odds', 'GameOdds', 'Books', 'Bookmakers', 'BookmakerOdds'];
    let best = null;
    arrays.forEach((field) => {
      const list = game && game[field];
      if (!Array.isArray(list)) return;
      list.forEach((entry) => {
        const val = normalizeOddsValue(readMoneyline(entry, sideKeys), { source: 'sportsdata', side, eventId: readStat(game, ['GameID', 'GameId', 'GameKey']) || null });
        if (val && (!best || val > best)) best = val;
      });
    });
    return best;
  }

  function buildSportsDataEvent(game, sport) {
    if (!game) return null;
    const homeName = readStat(game, ['HomeTeamName', 'HomeTeam', 'HomeTeamKey', 'HomeTeamAbbreviation']);
    const awayName = readStat(game, ['AwayTeamName', 'AwayTeam', 'AwayTeamKey', 'AwayTeamAbbreviation']);
    if (!homeName || !awayName) return null;

    const startRaw = readStat(game, ['DateTime', 'DateTimeUTC', 'Day', 'GameDate', 'DateTimeLocal']);
    const startDate = startRaw ? new Date(startRaw) : null;
    const startIso = startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null;

    const displayOdds = {
      home: pickBestDecimalOdds(game, 'home'),
      away: pickBestDecimalOdds(game, 'away')
    };
    const drawOdd = pickBestDecimalOdds(game, 'draw');
    if (drawOdd) displayOdds.draw = drawOdd;
    if (!displayOdds.home && !displayOdds.away && !displayOdds.draw) return null;

    const id = String(readStat(game, ['GameID', 'GameId', 'GameKey']) || `${sport}-${homeName}-${awayName}-${startIso || ''}`);

    return {
      id,
      match_id: id,
      commence_time: startIso,
      start_time: startIso,
      home_team: String(homeName),
      away_team: String(awayName),
      sport_key: sport,
      displayOdds
    };
  }

  async function fetchSportsDataOddsWithLookahead(sport, headers, maxDays = 7) {
    const today = new Date();
    for (let offset = 0; offset <= maxDays; offset += 1) {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
      const dateKey = getUtcDateKey(date);
      const url = `${API_SPORTSDATA_ODDS()}?sport=${encodeURIComponent(sport)}&date=${encodeURIComponent(dateKey)}&ts=${Date.now()}`;
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.status === 401) throw new Error('auth');
      if (!res.ok) continue;
      const payload = await res.json();
      const list = Array.isArray(payload) ? payload : [];
      if (list.length) return { list, dateKey };
    }
    return { list: [], dateKey: null };
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
    const home = sanitizeOddsValue(d.home, { source: 'confidence', side: 'home', matchId: pick.id || pick.matchId || null });
    const draw = sanitizeOddsValue(d.draw, { source: 'confidence', side: 'draw', matchId: pick.id || pick.matchId || null });
    const away = sanitizeOddsValue(d.away, { source: 'confidence', side: 'away', matchId: pick.id || pick.matchId || null });
    if (home) vals.push(1/parseFloat(home));
    if (draw) vals.push(1/parseFloat(draw));
    if (away) vals.push(1/parseFloat(away));
    if (vals.length) {
      const sum = vals.reduce((s,v)=>s+ (isFinite(v)?v:0),0);
      const rec = pick.pickTeam || pick.recommended;
      if (rec && home && String(pick.home_team) === String(rec)) return (1/parseFloat(home))/sum;
      if (rec && away && String(pick.away_team) === String(rec)) return (1/parseFloat(away))/sum;
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
        enforceOnboarding(data);
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
        enforceOnboarding(data);
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

  try {
    window.addEventListener('pageshow', (event) => {
      if (event && event.persisted && !shouldBypassOnboardingGuard()) {
        window.location.reload();
        return;
      }
      syncUserProfile();
    });
  } catch (e) { /* ignore */ }

  function confidenceLabel(score) { if (score >= 0.66) return { text: 'High', color: 'bg-green-500' }; if (score >= 0.4) return { text: 'Medium', color: 'bg-yellow-500' }; return { text: 'Low', color: 'bg-red-500' }; }

  // flexible container id for different pages
  function getPicksContainer() { return document.getElementById('dailyPicksContainer') || document.getElementById('picksContainer'); }

  function renderSkeletons(container, count = 6) {
    if (!container) return; container.innerHTML = '';
    for (let i=0;i<count;i++) { const s = document.createElement('div'); s.className = 'animate-pulse bg-gray-800 rounded-lg p-4 h-36 mb-4'; container.appendChild(s); }
  }

  function renderPicksError(container, message) {
    if (!container) return;
    container.innerHTML = `<div class="bg-red-900/40 border border-red-700 text-red-200 p-4 rounded-lg">${escapeHtml(message || 'Failed to load bets. Try again later.')}</div>`;
  }

  const SPORT_TAB_KEYS = ['nba', 'nfl', 'nhl', 'mlb', 'soccer'];
  const PICKS_CACHE_TTL = 60 * 60 * 1000;
  const MAX_PICKS_PER_SPORT = 35;
  const MAX_PICKS_ALL = 35;
  let picksCache = { data: null, ts: 0 };

  function filterPicksByWindow(picks, windowMs, minTs = null, allowMissingTs = false) {
    const now = Date.now();
    const floorTs = Number.isFinite(minTs) ? minTs : now;
    return (picks || [])
      .map(p => {
        let ts = toMillis(p.commence_time || p.startTime || p.date || null);
        if ((!Number.isFinite(ts) || ts === 0) && allowMissingTs) ts = floorTs;
        return { pick: p, ts };
      })
      // Only show games that haven't started yet (ts > now) and are within the window
      .filter(p => Number.isFinite(p.ts) && p.ts > now && p.ts <= now + windowMs)
      .sort((a, b) => a.ts - b.ts)
      .map(p => p.pick);
  }

  function filterPicksByWindowWithSport(picks, defaultWindowMs, sportWindows) {
    const now = Date.now();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    return (picks || [])
      .map(p => {
        let ts = toMillis(p.commence_time || p.startTime || p.date || null);
        const sportKey = String(p.sport_key || p.sportKey || '').toLowerCase();
        let windowMs = defaultWindowMs;
        let minTs = now;
        let allowMissingTs = false;
        if (sportKey.includes('nba') && sportWindows && sportWindows.nba) {
          windowMs = sportWindows.nba;
          minTs = dayStartMs;
          allowMissingTs = true;
        }
        if ((!Number.isFinite(ts) || ts === 0) && allowMissingTs) ts = minTs;
        return { pick: p, ts, windowMs, minTs };
      })
      .filter(p => {
        // Only show games that haven't started yet
        if (!Number.isFinite(p.ts)) return false;
        if (p.ts <= now) return false;
        return p.ts <= now + p.windowMs;
      })
      .sort((a, b) => a.ts - b.ts)
      .map(p => p.pick);
  }

  function matchSportKey(pick, sport) {
    const key = String(pick.sport_key || pick.sportKey || '').toLowerCase();
    return key.includes(String(sport).toLowerCase());
  }

  function normalizeMoneyline(value, context) {
    return sanitizeOddsValue(value, context);
  }

  function normalizeGameToPick(game) {
    if (!game) return null;
    const sportKey = String(game.sport || '').toLowerCase();
    const displayOdds = {
      home: normalizeMoneyline(game.odds && game.odds.moneyline && game.odds.moneyline.home, { source: 'api-sports', side: 'home', eventId: game.gameId || null }),
      away: normalizeMoneyline(game.odds && game.odds.moneyline && game.odds.moneyline.away, { source: 'api-sports', side: 'away', eventId: game.gameId || null })
    };
    const drawOdd = normalizeMoneyline(game.odds && game.odds.moneyline && game.odds.moneyline.draw, { source: 'api-sports', side: 'draw', eventId: game.gameId || null });
    if (drawOdd) displayOdds.draw = drawOdd;
    return {
      id: String(game.gameId || ''),
      matchId: String(game.gameId || ''),
      commence_time: game.startTime || null,
      startTime: game.startTime || null,
      home_team: game.homeTeam || '',
      away_team: game.awayTeam || '',
      sport_key: sportKey,
      league: game.league || game.sport || '',
      displayOdds
    };
  }

  async function getAllPicksData() {
    if (picksCache.data && (Date.now() - picksCache.ts) < PICKS_CACHE_TTL) {
      return picksCache.data;
    }
    let headers = await getAuthHeaders();
    if (!headers.Authorization && !headers['x-dev-uid']) {
      await waitForAuthReady();
      headers = await getAuthHeaders();
    }
    const cacheBuster = `ts=${Date.now()}`;
    const fetchSport = async (sport) => {
      const res = await fetch(`${getAPIBase()}/api/games/${sport}?${cacheBuster}`, { headers, cache: 'no-store' });
      if (res.status === 401) throw new Error('auth');
      if (!res.ok) throw new Error(`fetch:${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    };
    const results = await Promise.allSettled(SPORT_TAB_KEYS.map((sport) => fetchSport(sport)));
    const successes = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!successes.length) throw new Error('fetch:all');
    const rawGames = successes.flat();
    const seen = new Set();
    const raw = rawGames.reduce((acc, game) => {
      const id = String(game && game.gameId ? game.gameId : '');
      if (!id || seen.has(id)) return acc;
      seen.add(id);
      const pick = normalizeGameToPick(game);
      if (pick) acc.push(pick);
      return acc;
    }, []);
    const windowed = filterPicksByWindowWithSport(raw, 24 * 60 * 60 * 1000, { nba: 7 * 24 * 60 * 60 * 1000 });
    const picksBySport = {};
    SPORT_TAB_KEYS.forEach((sport) => {
      const baseList = raw.filter(p => matchSportKey(p, sport));
      const windowMs = sport === 'nba'
        ? 7 * 24 * 60 * 60 * 1000
        : sport === 'nhl'
          ? 14 * 24 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;
      const minTs = sport === 'nba' ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : null;
      const list = filterPicksByWindow(baseList, windowMs, minTs, sport === 'nba');
      picksBySport[sport] = list.slice(0, MAX_PICKS_PER_SPORT);
    });
    const all = windowed.slice(0, MAX_PICKS_ALL);
    const payload = { all, picksBySport };
    picksCache = { data: payload, ts: Date.now() };
    return payload;
  }

  function createPickCard(pick) {
    const conf = computeConfidence(pick); const confBadge = confidenceLabel(conf);
    const card = document.createElement('article'); card.className = 'bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-sm';
    const matchId = pick.id || pick.matchId || '';
    const sportKey = pick.sport_key || pick.sportKey || '';
    const startTime = pick.commence_time || pick.startTime || pick.date || '';
    // Check if the game has already started
    const startMs = startTime ? new Date(startTime).getTime() : NaN;
    const gameStarted = Number.isFinite(startMs) && startMs <= Date.now();
    // Tag the card with start time so the live ticker can update it
    if (Number.isFinite(startMs)) card.setAttribute('data-game-start', String(startMs));
    card.setAttribute('data-match-id', matchId);
    const marketType = pick.marketType || pick.market || 'h2h';
    const isProp = marketType && String(marketType).toLowerCase() !== 'h2h';
    const propTitle = pick.propTitle || pick.playerName || pick.prop || '';
    const propLine = pick.propLine || pick.line || '';
    const oddsContext = { matchId, sportKey, marketType };
    const oddsHome = sanitizeOddsValue(pick.displayOdds && pick.displayOdds.home, Object.assign({ side: 'home' }, oddsContext));
    const oddsAway = sanitizeOddsValue(pick.displayOdds && pick.displayOdds.away, Object.assign({ side: 'away' }, oddsContext));
    const oddsDraw = sanitizeOddsValue(pick.displayOdds && pick.displayOdds.draw, Object.assign({ side: 'draw' }, oddsContext));
    if (!Number.isFinite(oddsHome) && !Number.isFinite(oddsAway) && !Number.isFinite(oddsDraw)) {
      return null;
    }
    pickMeta[matchId] = {
      sportKey,
      startTime,
      homeTeam: pick.home_team || '',
      awayTeam: pick.away_team || '',
      marketType,
      propTitle,
      propLine
    };

    // top
    const top = document.createElement('div'); top.className = 'flex items-center justify-between mb-3';
    const league = document.createElement('div'); league.className = 'text-xs text-gray-400'; league.textContent = pick.league || pick.sport || '';
    const time = document.createElement('div'); time.className = 'text-xs text-gray-400'; time.textContent = fmtDate(pick.commence_time || pick.startTime || pick.date || '');
    top.appendChild(league); top.appendChild(time); card.appendChild(top);

    // matchup
    const matchup = document.createElement('div'); matchup.className = 'flex items-center justify-between gap-4';
    const left = document.createElement('div'); left.className = 'text-sm text-gray-200';
    if (isProp) {
      const label = marketType ? String(marketType).replace(/_/g, ' ').toUpperCase() : 'PROP';
      const lineLabel = propLine ? `Line ${propLine}` : '';
      left.innerHTML = `
        <div class="font-medium">${escapeHtml(propTitle || 'Player Prop')}</div>
        <div class="text-xs text-gray-400">${escapeHtml(label)}${lineLabel ? ` • ${escapeHtml(lineLabel)}` : ''}</div>
      `;
    } else {
      left.innerHTML = `<div class="font-medium">${escapeHtml(pick.away_team || '')}</div><div class="text-xs text-gray-400">vs</div><div class="font-medium">${escapeHtml(pick.home_team || '')}</div>`;
    }

    matchup.appendChild(left); card.appendChild(matchup);

    const timeRow = document.createElement('div');
    timeRow.className = 'mt-2 text-xs text-gray-400';
    const timeLabel = fmtDate(pick.commence_time || pick.startTime || pick.date || '');
    timeRow.textContent = timeLabel ? `Game time: ${timeLabel}` : 'Game time: TBD';
    card.appendChild(timeRow);

    // selection buttons
    const allowDraw = !!(oddsDraw && String(sportKey || '').toLowerCase().includes('soccer'));
    const btns = document.createElement('div'); btns.className = allowDraw ? 'grid grid-cols-3 gap-2 mt-3' : 'grid grid-cols-2 gap-2 mt-3';
    const makeBtn = (team, odds, isDraw = false) => {
      if (!Number.isFinite(odds) || odds <= 1) return null;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'select-team py-3 px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm flex flex-col items-center gap-2';
      // Disable the button if the game has already started
      if (gameStarted) {
        b.disabled = true;
        b.classList.add('opacity-40', 'cursor-not-allowed');
        b.classList.remove('hover:bg-gray-600');
      }
      b.setAttribute('data-match', matchId);
      b.setAttribute('data-team', team);
      b.setAttribute('data-odds', typeof odds !== 'undefined' && odds !== null ? String(odds) : '');
      b.setAttribute('data-sport', sportKey);
      b.setAttribute('data-start', startTime);
      b.setAttribute('data-home', pick.home_team || '');
      b.setAttribute('data-away', pick.away_team || '');
      b.setAttribute('data-market', marketType || 'h2h');
      if (propTitle) b.setAttribute('data-prop-title', propTitle);
      if (propLine) b.setAttribute('data-prop-line', propLine);

      let iconEl = null;
      if (isProp) {
        iconEl = document.createElement('div');
        iconEl.className = 'w-12 h-12 rounded-full bg-slate-700 text-xs font-semibold flex items-center justify-center text-slate-200';
        iconEl.textContent = isDraw ? 'DRAW' : (team && team.toLowerCase().includes('over') ? 'O' : (team && team.toLowerCase().includes('under') ? 'U' : (team && team.toLowerCase() === 'yes' ? 'Y' : (team && team.toLowerCase() === 'no' ? 'N' : 'P'))));
      } else {
        const img = document.createElement('img');
        img.className = 'w-16 h-16 object-contain';
        applyTeamLogo(img, team, sportKey);
        iconEl = img;
      }
      const name = document.createElement('div');
      name.className = 'text-xs text-gray-200 text-center';
      name.textContent = team;
      const oddsEl = document.createElement('div');
      oddsEl.className = 'text-xs text-gray-400';
      oddsEl.textContent = odds ? `${Number(odds).toFixed(2)}x` : '';

      if (iconEl) b.appendChild(iconEl);
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
          awayTeam: b.getAttribute('data-away') || '',
          marketType: b.getAttribute('data-market') || 'h2h',
          propTitle: b.getAttribute('data-prop-title') || '',
          propLine: b.getAttribute('data-prop-line') || ''
        });
      });
      return b;
    };
    const homeBtn = makeBtn(pick.home_team || '', oddsHome);
    const drawBtn = allowDraw ? makeBtn('Draw', oddsDraw, true) : null;
    const awayBtn = makeBtn(pick.away_team || '', oddsAway);
    if (homeBtn) btns.appendChild(homeBtn);
    if (drawBtn) btns.appendChild(drawBtn);
    if (awayBtn) btns.appendChild(awayBtn);
    if (!btns.children.length) {
      const note = document.createElement('div');
      note.className = 'mt-3 text-xs text-gray-400';
      note.textContent = 'Odds unavailable for this game right now.';
      card.appendChild(note);
    } else {
      // Show a "STARTED" banner over the buttons if game is live
      if (gameStarted) {
        const startedBanner = document.createElement('div');
        startedBanner.className = 'mt-3 mb-1 text-center text-xs font-bold uppercase tracking-widest text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg py-2';
        startedBanner.textContent = '\u26A0 Game started \u2014 betting closed';
        card.appendChild(startedBanner);
      }
      card.appendChild(btns);
    }

    // recommended bar
    const options = [];
    if (oddsHome) options.push({ team: pick.home_team, odds: oddsHome });
    if (allowDraw && oddsDraw) options.push({ team: 'Draw', odds: oddsDraw });
    if (oddsAway) options.push({ team: pick.away_team, odds: oddsAway });
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
  meta.innerHTML = `<div class="flex items-center gap-2"><span class="text-xs ${confBadge.color} text-white px-2 py-1 rounded-full">${confBadge.text}</span><span class="text-xs text-gray-300">Confidence ${Math.round(conf*100)}%</span></div>`;
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

  async function loadPicks(sport = 'all', containerOverride = null, presetList = null) {
    const container = containerOverride || getPicksContainer();
    if (!container) return;
    renderSkeletons(container, 6);
    try {
      const { all, picksBySport } = await getAllPicksData();
      let picks = [];
      if (presetList) {
        picks = presetList.slice();
      } else if (!sport || sport === 'all') {
        picks = all.slice();
      } else {
        picks = (picksBySport && picksBySport[sport]) ? picksBySport[sport].slice() : [];
      }
      container.innerHTML = '';
      if (!picks || picks.length === 0) {
        container.innerHTML = '<div class="text-gray-400 p-6">No bets available atm.</div>';
        return;
      }
      let rendered = 0;
      picks.forEach(p => {
        const card = createPickCard(p);
        if (card) {
          container.appendChild(card);
          rendered += 1;
        }
      });
      if (!rendered) {
        container.innerHTML = '<div class="text-gray-400 p-6">No valid odds available atm.</div>';
      }
    } catch (e) {
      console.error('loadPicks error', e);
      renderPicksError(container, 'Failed to load bets. Try again later.');
    }
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

  function getUtcDateKey(date) {
    const d = date || new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getIsoWeekKey(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  const TASK_HIDE_AFTER_MS = 60 * 60 * 1000;
  function parseClaimTime(value) {
    if (!value) return null;
    if (typeof value === 'string' || typeof value === 'number') {
      const t = Date.parse(String(value));
      return Number.isFinite(t) ? t : null;
    }
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value && typeof value.seconds === 'number') return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
    return null;
  }
  function shouldHideTask(claimed, claimAt) {
    if (!claimed) return false;
    const ts = parseClaimTime(claimAt);
    if (!ts) return true;
    return (Date.now() - ts) >= TASK_HIDE_AFTER_MS;
  }
  function setTaskVisibility(taskKey, hide) {
    const card = document.querySelector(`.quest-card[data-task="${taskKey}"]`);
    if (!card) return;
    card.style.display = hide ? 'none' : '';
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
    const dailyPicksStatus = document.getElementById('dailyPicksStatus');
    const dailyPicksButton = document.getElementById('dailyPicksButton');
    const dailyPicksProgress = document.getElementById('dailyPicksProgress');
    const dailyWinsStatus = document.getElementById('dailyWinsStatus');
    const dailyWinsButton = document.getElementById('dailyWinsButton');
    const dailyWinsProgress = document.getElementById('dailyWinsProgress');
    const dailyInsightsStatus = document.getElementById('dailyInsightsStatus');
    const dailyInsightsButton = document.getElementById('dailyInsightsButton');
    const dailyInsightsProgress = document.getElementById('dailyInsightsProgress');
    const dailySportsStatus = document.getElementById('dailySportsStatus');
    const dailySportsButton = document.getElementById('dailySportsButton');
    const dailySportsProgress = document.getElementById('dailySportsProgress');
    const weeklyStreakStatus = document.getElementById('weeklyStreakStatus');
    const weeklyStreakButton = document.getElementById('weeklyStreakButton');
    const weeklyStreakProgress = document.getElementById('weeklyStreakProgress');
    const weeklyWinrateStatus = document.getElementById('weeklyWinrateStatus');
    const weeklyWinrateButton = document.getElementById('weeklyWinrateButton');
    const weeklyWinrateProgress = document.getElementById('weeklyWinrateProgress');
    const weeklyParlayStatus = document.getElementById('weeklyParlayStatus');
    const weeklyParlayButton = document.getElementById('weeklyParlayButton');
    const weeklyParlayProgress = document.getElementById('weeklyParlayProgress');
    const weeklyLevelStatus = document.getElementById('weeklyLevelStatus');
    const weeklyLevelButton = document.getElementById('weeklyLevelButton');
    const weeklyLevelProgress = document.getElementById('weeklyLevelProgress');
    if (!betStatus && !parlayStatus && !dailyPicksStatus && !weeklyStreakStatus) return;

    const data = profile || userProfile || null;
    const stats = data && data.stats ? data.stats : {};
    const totalBets = Number(stats.totalBets || 0);
    const totalParlays = Number(stats.totalParlays || 0);
    const hasProfile = !!data;
    const currentUid = getCurrentUid();
    const localBetPlaced = !!currentUid && localStorage.getItem('PICKR_FIRST_BET_UID') === currentUid;
    const localParlayPlaced = !!currentUid && localStorage.getItem('PICKR_PARLAY_UID') === currentUid;
    const betEligible = hasProfile && (totalBets > 0 || localBetPlaced || !!data.firstBetEligible);
    const parlayEligible = hasProfile && (totalParlays > 0 || localParlayPlaced || !!data.firstParlayEligible);
    const betClaimed = hasProfile && !!data.firstBetRewarded;
    const parlayClaimed = hasProfile && !!data.firstParlayRewarded;

    const todayKey = getUtcDateKey(new Date());
    const weekKey = getIsoWeekKey(new Date());
    const dailyTasks = data && data.dailyTasks && data.dailyTasks.dateKey === todayKey ? data.dailyTasks : { dateKey: todayKey, betsPlaced: 0, wins: 0, sports: [], claims: {} };
    const weeklyTasks = data && data.weeklyTasks && data.weeklyTasks.weekKey === weekKey
      ? data.weeklyTasks
      : { weekKey, claims: {}, eligibleParlay: false };
    const dailyInsights = data && data.dailyInsights && data.dailyInsights.dateKey === todayKey ? data.dailyInsights : { dateKey: todayKey, count: 0 };

    const dailyClaims = dailyTasks.claims || {};
    const weeklyClaims = weeklyTasks.claims || {};
    const dailyEligible = {
      'daily-3-picks': Number(dailyTasks.betsPlaced || 0) >= 3,
      'daily-2-wins': Number(dailyTasks.wins || 0) >= 2,
      'daily-5-insights': Number(dailyInsights.count || 0) >= 5,
      'daily-2-sports': Array.isArray(dailyTasks.sports) && dailyTasks.sports.length >= 2
    };
    const wins = Number(stats.wins || 0);
    const total = Number(stats.totalBets || 0);
    const weeklyEligible = {
      'weekly-5-streak': Number(data && data.streakWins || 0) >= 5,
      'weekly-60-winrate': total >= 10 && (wins / total) >= 0.6,
      'weekly-3-leg-parlay': !!weeklyTasks.eligibleParlay,
      'weekly-level-up': String(data && data.level ? data.level : 'Bronze') !== 'Bronze'
    };

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

    const setProgress = (el, value, fallback) => {
      if (!el) return;
      if (!hasProfile) {
        el.textContent = fallback || '--';
        return;
      }
      el.textContent = value;
    };

    setState(betStatus, betButton, betEligible, betClaimed, 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Place a bet');
    setState(parlayStatus, parlayButton, parlayEligible, parlayClaimed, 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Build a parlay');

    setState(dailyPicksStatus, dailyPicksButton, dailyEligible['daily-3-picks'], !!dailyClaims['daily-3-picks'], 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Make picks');
    setState(dailyWinsStatus, dailyWinsButton, dailyEligible['daily-2-wins'], !!dailyClaims['daily-2-wins'], 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'View my bets');
    setState(dailyInsightsStatus, dailyInsightsButton, dailyEligible['daily-5-insights'], !!dailyClaims['daily-5-insights'], 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Read insights');
    setState(dailySportsStatus, dailySportsButton, dailyEligible['daily-2-sports'], !!dailyClaims['daily-2-sports'], 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Pick another sport');

    setState(weeklyStreakStatus, weeklyStreakButton, weeklyEligible['weekly-5-streak'], !!weeklyClaims['weekly-5-streak'], 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Check streak');
    setState(weeklyWinrateStatus, weeklyWinrateButton, weeklyEligible['weekly-60-winrate'], !!weeklyClaims['weekly-60-winrate'], 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Track results');
    setState(weeklyParlayStatus, weeklyParlayButton, weeklyEligible['weekly-3-leg-parlay'], !!weeklyClaims['weekly-3-leg-parlay'], 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Build a parlay');
    setState(weeklyLevelStatus, weeklyLevelButton, weeklyEligible['weekly-level-up'], !!weeklyClaims['weekly-level-up'], 'Not completed', 'Ready to claim', 'Reward added', 'Claim reward', 'Check level');

    const picksPlaced = Math.min(3, Number(dailyTasks.betsPlaced || 0));
    setProgress(dailyPicksProgress, `${picksPlaced}/3`, '0/3');
    const winsToday = Math.min(2, Number(dailyTasks.wins || 0));
    setProgress(dailyWinsProgress, `${winsToday}/2`, '0/2');
    const insightsCount = Math.min(5, Number(dailyInsights.count || 0));
    setProgress(dailyInsightsProgress, `${insightsCount}/5`, '0/5');
    const sportsCount = Math.min(2, (Array.isArray(dailyTasks.sports) ? dailyTasks.sports.length : 0));
    setProgress(dailySportsProgress, `${sportsCount}/2`, '0/2');

    const streakWins = Math.min(5, Number(data && data.streakWins || 0));
    setProgress(weeklyStreakProgress, `${streakWins}/5`, '0/5');
    const winratePct = total > 0 ? Math.round((wins / total) * 100) : 0;
    setProgress(weeklyWinrateProgress, `${Math.min(total, 10)}/10 · ${winratePct}%`, '0/10 · 0%');
    setProgress(weeklyParlayProgress, weeklyTasks.eligibleParlay ? '1/1' : '0/1', '0/1');
    const levelLabel = String(data && data.level ? data.level : 'Bronze');
    setProgress(weeklyLevelProgress, `Level: ${levelLabel}`, 'Level: Bronze');

    const firstBetClaimAt = data && data.firstBetClaimedAt ? data.firstBetClaimedAt : null;
    const firstParlayClaimAt = data && data.firstParlayClaimedAt ? data.firstParlayClaimedAt : null;
    setTaskVisibility('first-bet', shouldHideTask(!!betClaimed, firstBetClaimAt));
    setTaskVisibility('first-parlay', shouldHideTask(!!parlayClaimed, firstParlayClaimAt));

    setTaskVisibility('daily-3-picks', shouldHideTask(!!dailyClaims['daily-3-picks'], dailyClaims['daily-3-picks']));
    setTaskVisibility('daily-2-wins', shouldHideTask(!!dailyClaims['daily-2-wins'], dailyClaims['daily-2-wins']));
    setTaskVisibility('daily-5-insights', shouldHideTask(!!dailyClaims['daily-5-insights'], dailyClaims['daily-5-insights']));
    setTaskVisibility('daily-2-sports', shouldHideTask(!!dailyClaims['daily-2-sports'], dailyClaims['daily-2-sports']));

    setTaskVisibility('weekly-5-streak', shouldHideTask(!!weeklyClaims['weekly-5-streak'], weeklyClaims['weekly-5-streak']));
    setTaskVisibility('weekly-60-winrate', shouldHideTask(!!weeklyClaims['weekly-60-winrate'], weeklyClaims['weekly-60-winrate']));
    setTaskVisibility('weekly-3-leg-parlay', shouldHideTask(!!weeklyClaims['weekly-3-leg-parlay'], weeklyClaims['weekly-3-leg-parlay']));
    setTaskVisibility('weekly-level-up', shouldHideTask(!!weeklyClaims['weekly-level-up'], weeklyClaims['weekly-level-up']));
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
      if (payload && payload.awarded === false && payload.reason === 'not-eligible') {
        throw new Error('Not eligible yet. Complete the task to claim this reward.');
      }
      const reward = Number(payload.reward || 0);
      const rewardType = payload.rewardType || 'tokens';
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
        if (typeof payload.firstBetClaimedAt !== 'undefined') userProfile.firstBetClaimedAt = payload.firstBetClaimedAt;
        if (typeof payload.firstParlayClaimedAt !== 'undefined') userProfile.firstParlayClaimedAt = payload.firstParlayClaimedAt;
        if (payload.dailyTasks) userProfile.dailyTasks = payload.dailyTasks;
        if (payload.weeklyTasks) userProfile.weeklyTasks = payload.weeklyTasks;
        if (payload.dailyInsights) userProfile.dailyInsights = payload.dailyInsights;
        if (typeof payload.xp !== 'undefined') userProfile.xp = Number(payload.xp || 0);
        if (payload.level) userProfile.level = payload.level;
        if (typeof payload.points !== 'undefined') userProfile.points = Number(payload.points || 0);
      }
      updateQuestTasks(userProfile);
      if (reward > 0) {
        const label = rewardType === 'xp' ? 'XP' : 'Tokens';
        showBetToast('success', `Reward claimed: +${reward} ${label}`);
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
        status.textContent = 'Come back tomorrow';
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

  let recentBetsRequestId = 0;

  async function loadRecentBets(options = {}) {
    const { containerId = 'betHistoryContainer', days = 30, range = null, attempt = 0 } = options;
    const requestId = ++recentBetsRequestId;
    const container = document.getElementById(containerId);
    const loader = document.getElementById('betHistoryLoader');
    if (!container) return;
    container.innerHTML = '';

    const summaryCount = document.getElementById('recentBetsCount');
    const summaryRange = document.getElementById('recentTimeRange');
    const summaryWins = document.getElementById('recentWins');
    const summaryLosses = document.getElementById('recentLosses');
    const summaryCash = document.getElementById('recentCashWagered');
    const summaryTokens = document.getElementById('recentTokensWagered');
    const summaryText = document.getElementById('recentSummaryText');
    const summaryChip = document.getElementById('recentChip');

    const now = new Date();
    const resolveRangeStart = () => {
      if (range === 'week') {
        const start = new Date(now);
        const day = start.getDay();
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - day);
        return start.getTime();
      }
      if (range === 'month') {
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      }
      if (range === 'year') {
        return new Date(now.getFullYear(), 0, 1).getTime();
      }
      return Date.now() - days * 24 * 60 * 60 * 1000;
    };
    const cutoff = resolveRangeStart();
    const label = range === 'month' ? 'This month' : range === 'year' ? 'This year' : 'This week';
    if (summaryRange) summaryRange.textContent = label;
    if (summaryText) summaryText.textContent = `Showing your bets from ${label.toLowerCase()}.`;
    if (summaryChip) summaryChip.textContent = label;

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

      const resp = await fetch(getAPIBase() + '/api/bets?settle=1', { headers });
      if (requestId !== recentBetsRequestId) return;
      if (resp.status === 401 || resp.status === 403) {
        if (requestId !== recentBetsRequestId) return;
        container.innerHTML = '<div class="empty-state">Session expired. Please sign in again to view your bets.</div>';
        if (summaryCount) summaryCount.textContent = '0';
        if (summaryWins) summaryWins.textContent = '0';
        if (summaryLosses) summaryLosses.textContent = '0';
        if (summaryCash) summaryCash.textContent = '$0.00';
        if (summaryTokens) summaryTokens.textContent = '0';
        return;
      }
      if (!resp.ok) {
        if (requestId !== recentBetsRequestId) return;
        container.innerHTML = `<div class="empty-state">No bets found for ${label.toLowerCase()}.</div>`;
        if (summaryCount) summaryCount.textContent = '0';
        if (summaryWins) summaryWins.textContent = '0';
        if (summaryLosses) summaryLosses.textContent = '0';
        if (summaryCash) summaryCash.textContent = '$0.00';
        if (summaryTokens) summaryTokens.textContent = '0';
        return;
      }

      const data = await resp.json();
      if (requestId !== recentBetsRequestId) return;
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

      let wins = 0;
      let losses = 0;
      let cashWagered = 0;
      let tokensWagered = 0;
      recent.forEach(({ item }) => {
        const status = String(item.status || '').toLowerCase();
        if (status === 'won') wins += 1;
        if (status === 'lost') losses += 1;
        const stakeCurrency = String(item.stakeCurrency || 'tokens').toLowerCase();
        const stakeTokens = Number(item.stakeTokens || 0);
        const stakeCash = Number(item.stakeCash || 0);
        const stakeValue = Number(item.stake || 0);
        const tokenToCashRate = Number(item.tokenToCashRate || 0.01);
        const isToken = stakeCurrency === 'tokens';
        const stakeTokensValue = stakeTokens || (isToken ? stakeValue : 0);
        const stakeCashValue = stakeCash || (!isToken ? stakeValue : Math.round(stakeTokensValue * tokenToCashRate * 100) / 100);
        if (isToken) tokensWagered += stakeTokensValue;
        else cashWagered += stakeCashValue;
      });
      if (summaryCount) summaryCount.textContent = String(recent.length);
      if (summaryWins) summaryWins.textContent = String(wins);
      if (summaryLosses) summaryLosses.textContent = String(losses);
      if (summaryCash) summaryCash.textContent = `$${cashWagered.toFixed(2)}`;
      if (summaryTokens) summaryTokens.textContent = `${Math.round(tokensWagered)}`;

      if (recent.length === 0) {
        if (requestId !== recentBetsRequestId) return;
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
        const emptyMessage = `No bets for ${label.toLowerCase()}. Try the Sports tab to place a new one.`;
        container.innerHTML = `
          <div class="empty-state">
            <div>${emptyMessage}</div>
            <button id="betsRefresh" class="toggle-button" style="margin-top:1rem;">Refresh</button>
          </div>
        `;
        const refreshBtn = document.getElementById('betsRefresh');
        if (refreshBtn) {
          refreshBtn.addEventListener('click', () => {
            loadRecentBets({ containerId, days, range, attempt: 0 });
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
          let legStatus = null;
          if (isParlay) {
            const rawStatus = String(selection.status || selection.result || selection.outcome || selection.settledStatus || '').toLowerCase();
            legStatus = rawStatus === 'won' || rawStatus === 'win'
              ? 'won'
              : rawStatus === 'lost' || rawStatus === 'lose'
                ? 'lost'
                : rawStatus === 'void'
                  ? 'void'
                  : 'pending';
            leg.classList.add(`bet-leg--${legStatus}`);
          }
          const logo = document.createElement('img');
          logo.className = 'bet-leg__logo';
          logo.alt = name;
          const legSport = selection.sportKey || selection.sport_key || '';
          applyTeamLogo(logo, name, legSport);
          const textWrap = document.createElement('div');
          textWrap.className = 'bet-leg__text';
          const title = document.createElement('div');
          title.className = 'bet-leg__name';
          title.textContent = name;
          const meta = document.createElement('div');
          meta.className = 'bet-leg__meta';
          meta.textContent = metaParts.join(' • ');
          const statusPill = document.createElement('span');
          if (isParlay && legStatus) {
            statusPill.className = `bet-leg__status bet-leg__status--${legStatus}`;
            statusPill.textContent = legStatus === 'won'
              ? 'WON'
              : legStatus === 'lost'
                ? 'LOST'
                : legStatus === 'void'
                  ? 'VOID'
                  : 'PENDING';
          }
          textWrap.appendChild(title);
          if (metaParts.length) textWrap.appendChild(meta);
          if (isParlay && legStatus) textWrap.appendChild(statusPill);
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
      if (requestId !== recentBetsRequestId) return;
      if (loader) loader.classList.add('hidden');
    } catch (e) {
      console.warn('Failed to load recent bets:', e && e.message);
      if (requestId !== recentBetsRequestId) return;
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
    loadPicks, loadWalletPage, loadRecentBets, refreshHeaders, refreshAvatars, renderAvatar, addSelection
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
        awayTeam: btn.getAttribute('data-away') || '',
        marketType: btn.getAttribute('data-market') || 'h2h',
        propTitle: btn.getAttribute('data-prop-title') || '',
        propLine: btn.getAttribute('data-prop-line') || ''
      });
      btn.classList.add('bg-red-600','text-white');
      document.querySelectorAll(`.select-team[data-match="${match}"]`).forEach(s=>{ if (s!==btn){ s.disabled = true; s.classList.add('opacity-50'); }});
    });

    // If the page has sport category tabs (index.html), wire them to load picks
    const sportTabsContainer = document.getElementById('sportTabs');
    if (sportTabsContainer) {
      const tabs = Array.from(sportTabsContainer.querySelectorAll('.sport-tab'));
      const soccerLeagueTabs = document.getElementById('soccerLeagueTabs');
      const leagueButtons = soccerLeagueTabs ? Array.from(soccerLeagueTabs.querySelectorAll('.sport-tab')) : [];
      const refreshButton = document.getElementById('picksRefreshButton');
      const helpModal = document.getElementById('bettingHelpModal');
      const helpClose = document.getElementById('bettingHelpClose');
      const helpCloseFooter = document.getElementById('bettingHelpCloseFooter');
      const openHelpModal = () => {
        if (!helpModal) return;
        helpModal.classList.remove('hidden');
        helpModal.classList.add('flex');
        document.body.style.overflow = 'hidden';
      };
      const closeHelpModal = () => {
        if (!helpModal) return;
        helpModal.classList.add('hidden');
        helpModal.classList.remove('flex');
        document.body.style.overflow = '';
      };
      let selectedLeague = 'all';
      const setTabState = (tab, enabled) => {
        tab.classList.toggle('is-disabled', !enabled);
        tab.disabled = !enabled;
        tab.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        if (!enabled) tab.classList.remove('bg-red-600');
      };

      const refreshTabs = async () => {
        let data = null;
        let hadError = false;
        try {
          data = await getAllPicksData();
        } catch (err) {
          data = { all: [], picksBySport: {} };
          hadError = true;
        }
        const picksBySport = data.picksBySport || {};
        let firstAvailable = null;
        tabs.forEach((tab) => {
          const s = tab.dataset.sport || 'all';
          const has = s === 'all'
            ? (data.all && data.all.length > 0)
            : (picksBySport[s] && picksBySport[s].length > 0);
          setTabState(tab, !!has);
          if (!firstAvailable && has) firstAvailable = tab;
        });
        return { data, firstAvailable, hadError };
      };

      const applyLeagueFilter = (list) => {
        if (!list || !list.length) return [];
        if (!selectedLeague || selectedLeague === 'all') return list;
        return list.filter((pick) => String(pick.league || '').toLowerCase() === String(selectedLeague).toLowerCase());
      };

      const refreshActivePicks = async () => {
        picksCache = { data: null, ts: 0 };
        try { localStorage.setItem('PICKR_LAST_PICKS_REFRESH', '0'); } catch (e) {}
        const activeTab = tabs.find(t => t.classList.contains('bg-red-600')) || tabs[0];
        if (!activeTab) return;
        const s = activeTab.dataset.sport || 'all';
        if (s === 'soccer') {
          try {
            const { data } = await getAllPicksData();
            const list = applyLeagueFilter((data.picksBySport && data.picksBySport.soccer) || []);
            loadPicks(s, list);
          } catch (err) {
            loadPicks(s);
          }
          return;
        }
        loadPicks(s);
      };

      if (refreshButton) {
        refreshButton.addEventListener('click', () => {
          openHelpModal();
        });
      }
      if (helpModal) {
        helpModal.addEventListener('click', (event) => {
          if (event.target === helpModal) closeHelpModal();
        });
      }
      if (helpClose) helpClose.addEventListener('click', closeHelpModal);
      if (helpCloseFooter) helpCloseFooter.addEventListener('click', closeHelpModal);
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeHelpModal();
      });

      tabs.forEach(t => t.addEventListener('click', () => {
        if (t.classList.contains('is-disabled')) return;
        tabs.forEach(x => x.classList.remove('bg-red-600'));
        t.classList.add('bg-red-600');
        const s = t.dataset.sport || 'all';
        if (soccerLeagueTabs) {
          soccerLeagueTabs.classList.toggle('hidden', s !== 'soccer');
        }
        loadPicks(s);
        try { localStorage.setItem('PICKR_LAST_PICKS_REFRESH', String(Date.now())); } catch (e) {}
      }));

      leagueButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          leagueButtons.forEach((b) => b.classList.remove('bg-red-600'));
          btn.classList.add('bg-red-600');
          selectedLeague = btn.dataset.league || 'all';
          loadPicks('soccer');
        });
      });

      (async () => {
        const { data, firstAvailable, hadError } = await refreshTabs();
        if (!firstAvailable) {
          const container = getPicksContainer();
          if (container) {
            if (hadError) {
              renderPicksError(container, 'Failed to load bets. Try again later.');
            } else {
              container.innerHTML = '<div class="text-gray-400 p-6">No bets available atm.</div>';
            }
          }
          return;
        }
        firstAvailable.classList.add('bg-red-600');
        const s = firstAvailable.dataset.sport || 'all';
        if (soccerLeagueTabs) {
          soccerLeagueTabs.classList.toggle('hidden', s !== 'soccer');
          const defaultLeague = leagueButtons[0];
          if (defaultLeague) {
            leagueButtons.forEach((b) => b.classList.remove('bg-red-600'));
            defaultLeague.classList.add('bg-red-600');
            selectedLeague = defaultLeague.dataset.league || 'all';
          }
        }
        const lastRefresh = Number(localStorage.getItem('PICKR_LAST_PICKS_REFRESH') || 0);
        if (!lastRefresh || (Date.now() - lastRefresh) > 24 * 60 * 60 * 1000) {
          if (s === 'soccer') {
            try {
              const { data } = await getAllPicksData();
              const list = applyLeagueFilter((data.picksBySport && data.picksBySport.soccer) || []);
              loadPicks(s, list);
            } catch (err) {
              loadPicks(s);
            }
          } else {
            loadPicks(s);
          }
          try { localStorage.setItem('PICKR_LAST_PICKS_REFRESH', String(Date.now())); } catch (e) {}
        } else {
          if (s === 'soccer') {
            try {
              const { data } = await getAllPicksData();
              const list = applyLeagueFilter((data.picksBySport && data.picksBySport.soccer) || []);
              loadPicks(s, list);
            } catch (err) {
              loadPicks(s);
            }
          } else {
            loadPicks(s);
          }
        }
      })();

      setInterval(() => {
        refreshActivePicks();
      }, 2 * 60 * 1000);

      // Live ticker: every 30 seconds, disable pick cards for games that just started
      setInterval(() => {
        const now = Date.now();
        document.querySelectorAll('article[data-game-start]').forEach((card) => {
          const startMs = Number(card.getAttribute('data-game-start'));
          if (!Number.isFinite(startMs) || startMs > now) return;
          // Game has started — disable all bet buttons on this card
          const btns = card.querySelectorAll('.select-team');
          if (!btns.length) return;
          let alreadyDisabled = true;
          btns.forEach((btn) => {
            if (!btn.disabled) { alreadyDisabled = false; btn.disabled = true; btn.classList.add('opacity-40', 'cursor-not-allowed'); btn.classList.remove('hover:bg-gray-600', 'bg-red-600', 'text-white'); }
          });
          // Add the started banner if not already there
          if (!alreadyDisabled && !card.querySelector('.game-started-banner')) {
            const banner = document.createElement('div');
            banner.className = 'game-started-banner mt-2 text-center text-xs font-bold uppercase tracking-widest text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg py-2';
            banner.textContent = '\u26A0 Game started \u2014 betting closed';
            const btnsContainer = card.querySelector('.grid');
            if (btnsContainer) btnsContainer.parentNode.insertBefore(banner, btnsContainer);
          }
          // Remove from bet slip if it was selected
          const matchId = card.getAttribute('data-match-id');
          if (matchId && betSlip[matchId]) {
            delete betSlip[matchId];
            renderBetSlip();
          }
        });
      }, 30 * 1000);
    }

    const betHistoryEl = document.getElementById('betHistory');
    if (betHistoryEl) {
      setInterval(() => { loadWalletPage(); }, 15 * 60 * 1000);
    }
    const recentBetsEl = document.getElementById('betHistoryContainer');
    if (recentBetsEl) {
      setInterval(() => {
        const savedRange = localStorage.getItem('PICKR_BETS_RANGE') || 'week';
        loadRecentBets({ containerId: 'betHistoryContainer', range: savedRange, attempt: 0 });
      }, 15 * 60 * 1000);
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

    const bindTaskClaim = (buttonId, taskKey) => {
      const el = document.getElementById(buttonId);
      if (!el) return;
      el.addEventListener('click', (event) => {
        if (el.getAttribute('data-claim-ready') === 'true') {
          event.preventDefault();
          claimQuestReward(taskKey);
        }
      });
    };

    bindTaskClaim('dailyPicksButton', 'daily-3-picks');
    bindTaskClaim('dailyWinsButton', 'daily-2-wins');
    bindTaskClaim('dailyInsightsButton', 'daily-5-insights');
    bindTaskClaim('dailySportsButton', 'daily-2-sports');
    bindTaskClaim('weeklyStreakButton', 'weekly-5-streak');
    bindTaskClaim('weeklyWinrateButton', 'weekly-60-winrate');
    bindTaskClaim('weeklyParlayButton', 'weekly-3-leg-parlay');
    bindTaskClaim('weeklyLevelButton', 'weekly-level-up');

    initDailySpin();
    // NBA stats feature removed.

    const rangeWeek = document.getElementById('rangeWeek');
    const rangeMonth = document.getElementById('rangeMonth');
    const rangeYear = document.getElementById('rangeYear');
    if (rangeWeek || rangeMonth || rangeYear) {
      const setActive = (rangeKey) => {
        [rangeWeek, rangeMonth, rangeYear].forEach((btn) => {
          if (!btn) return;
          const isActive = btn.id === `range${rangeKey.charAt(0).toUpperCase()}${rangeKey.slice(1)}`;
          btn.classList.toggle('active', isActive);
        });
      };
      const applyRange = (rangeKey) => {
        localStorage.setItem('PICKR_BETS_RANGE', rangeKey);
        setActive(rangeKey);
        loadRecentBets({ containerId: 'betHistoryContainer', range: rangeKey, attempt: 0 });
      };
      const initial = localStorage.getItem('PICKR_BETS_RANGE') || 'week';
      applyRange(initial);
      if (rangeWeek) rangeWeek.addEventListener('click', () => applyRange('week'));
      if (rangeMonth) rangeMonth.addEventListener('click', () => applyRange('month'));
      if (rangeYear) rangeYear.addEventListener('click', () => applyRange('year'));
    }
  });

})();