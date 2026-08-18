(function () {
  // pickr shared script
  // exports window.PickrApp with loadPicks and loadWalletPage

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
    'avatar-1': { skin: '#f4c7a7', hair: '#3b2219', lip: '#b65b4a', hairStyle: 'short', jersey: '#38bdf8', accent: '#0c4a6e', detail: '#bae6fd', accessory: 'none' },
    'avatar-2': { skin: '#9c624a', hair: '#16181d', lip: '#7b3f31', hairStyle: 'fade', jersey: '#34d399', accent: '#064e3b', detail: '#a7f3d0', accessory: 'stud' },
    'avatar-3': { skin: '#c98764', hair: '#171717', lip: '#944735', hairStyle: 'spike', jersey: '#fb923c', accent: '#7c2d12', detail: '#fed7aa', accessory: 'band' },
    'avatar-4': { skin: '#70412e', hair: '#20242d', lip: '#522b25', hairStyle: 'cap', jersey: '#a78bfa', accent: '#4c1d95', detail: '#ddd6fe', accessory: 'cap' },
    'avatar-5': { skin: '#efb18f', hair: '#681f2a', lip: '#b54b63', hairStyle: 'long', jersey: '#fb7185', accent: '#881337', detail: '#fecdd3', accessory: 'hoop' },
    'avatar-6': { skin: '#d49a73', hair: '#322547', lip: '#92536a', hairStyle: 'bob', jersey: '#fbbf24', accent: '#713f12', detail: '#fef3c7', accessory: 'visor' }
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
      .pickr-avatar{--size:40px;width:var(--size);height:var(--size);min-width:var(--size);min-height:var(--size);max-width:var(--size);max-height:var(--size);aspect-ratio:1/1;display:inline-flex;flex:0 0 var(--size);align-items:center;justify-content:center;border-radius:999px;background:#162135;position:relative;overflow:hidden;box-sizing:border-box;border:1px solid rgba(255,255,255,0.25);box-shadow:0 8px 18px rgba(0,0,0,0.3),inset 0 1px 0 rgba(255,255,255,0.25);transform:translateZ(0);will-change:transform;contain:layout style size;isolation:isolate;}
      .pickr-avatar::before{content:'';position:absolute;inset:1px;border-radius:inherit;border:1px solid rgba(255,255,255,0.08);pointer-events:none;z-index:2;}
      .pickr-avatar .avatar-art,.pickr-avatar .avatar-portrait{display:block;width:100%;height:100%;}
      .pickr-avatar .avatar-portrait{object-fit:cover;transform:scale(1.04);}
      .pickr-avatar:not(.avatar-compact):hover{transform:translateY(-1px) scale(1.025);box-shadow:0 11px 24px rgba(0,0,0,0.36),0 0 0 3px rgba(122,167,255,0.1);}
      @media (prefers-reduced-motion:reduce){.pickr-avatar:not(.avatar-compact):hover{transform:none;}}
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

  function buildAvatarArt(preset) {
    const hairStyles = {
      short: '<path d="M22 45c0-19 12-31 29-31 16 0 28 10 29 29-9-8-17-11-29-11-11 0-20 4-29 13Z" fill="{hair}"/><path d="M28 28c8-10 24-13 38-5" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="3" stroke-linecap="round"/>',
      fade: '<path d="M24 45c0-18 11-30 27-30 17 0 28 11 28 29-7-8-16-12-28-12-12 0-20 4-27 13Z" fill="{hair}"/><path d="M23 36c-4 3-6 9-6 15 5-1 8-4 10-9M77 36c4 3 6 9 6 15-5-1-8-4-10-9" fill="{hair}" opacity=".75"/>',
      spike: '<path d="M22 43 27 24l7 8 5-17 8 13 10-17 4 18 11-9 3 22c-7-6-16-10-27-10-11 0-20 4-26 11Z" fill="{hair}"/><path d="M31 29 36 35M49 22l1 12M66 29l-4 7" stroke="rgba(255,255,255,.16)" stroke-width="2" stroke-linecap="round"/>',
      cap: '<path d="M20 38c2-17 14-26 31-26 15 0 26 8 30 23-12-4-22-6-31-4-10 1-19 5-30 10Z" fill="{hair}"/><path d="M18 37c17-8 38-11 63-1-6 5-21 7-36 5-12-1-21-2-27-4Z" fill="{detail}"/><path d="M69 34c10 1 16 5 20 9-11 1-20-1-27-5Z" fill="{detail}" opacity=".92"/>',
      long: '<path d="M21 50c-1-22 10-36 29-36 18 0 31 14 29 37l-2 31H65l-1-37c-5-6-12-8-20-8-8 0-14 3-18 9l-2 36H12l1-32c0-8 3-15 8-20Z" fill="{hair}"/><path d="M27 31c7-12 26-15 40-3" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="3" stroke-linecap="round"/>',
      bob: '<path d="M19 51c0-23 12-37 31-37 19 0 31 14 31 37v29H68V47c-5-7-11-10-18-10-8 0-14 3-19 10v33H19Z" fill="{hair}"/><path d="M25 33c7-12 28-16 48-2" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="3" stroke-linecap="round"/>'
    };
    const accessories = {
      none: '',
      stud: '<circle cx="76" cy="58" r="2.6" fill="#fef3c7" stroke="#f59e0b" stroke-width="1"/>',
      band: '<path d="M24 35c16-9 38-9 54 0" fill="none" stroke="{detail}" stroke-width="4" opacity=".9"/>',
      cap: '',
      hoop: '<circle cx="76" cy="61" r="4.5" fill="none" stroke="#fbbf24" stroke-width="1.5"/>',
      visor: '<path d="M20 37c16-10 44-11 61 0" fill="none" stroke="{detail}" stroke-width="5"/><path d="M65 38c9 0 16 3 20 7-11 2-21 1-29-2Z" fill="{detail}"/>'
    };
    const replace = (value) => value.replace(/\{hair\}/g, preset.hair).replace(/\{detail\}/g, preset.detail);
    const hair = replace(hairStyles[preset.hairStyle] || hairStyles.short);
    const accessory = replace(accessories[preset.accessory] || '');
    return '<svg class="avatar-art" viewBox="0 0 100 100" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="100" height="100" fill="' + preset.accent + '"/>' +
      '<path d="M0 0h100v58C78 49 23 49 0 58Z" fill="' + preset.detail + '" opacity=".13"/>' +
      '<circle cx="17" cy="54" r="8" fill="' + preset.skin + '"/><circle cx="83" cy="54" r="8" fill="' + preset.skin + '"/>' +
      '<path d="M31 43c0-15 8-25 19-25s19 10 19 25v20c0 13-8 22-19 22S31 76 31 63Z" fill="' + preset.skin + '"/>' +
      '<path d="M32 58c4 5 10 7 18 7s14-2 18-7v10c0 11-8 18-18 18s-18-7-18-18Z" fill="rgba(95,45,35,.08)"/>' +
      hair +
      '<path d="M37 49c3-2 7-2 10 0M54 49c3-2 7-2 10 0" fill="none" stroke="rgba(44,26,22,.66)" stroke-width="1.7" stroke-linecap="round"/>' +
      '<ellipse cx="42" cy="55" rx="2.2" ry="2.8" fill="#1f1720"/><ellipse cx="58" cy="55" rx="2.2" ry="2.8" fill="#1f1720"/>' +
      '<circle cx="42.7" cy="54.2" r=".7" fill="#fff" opacity=".85"/><circle cx="58.7" cy="54.2" r=".7" fill="#fff" opacity=".85"/>' +
      '<path d="M49 56.5 47.5 63h3" fill="none" stroke="rgba(83,45,36,.38)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M44 70c3 2 9 2 12 0" fill="none" stroke="' + preset.lip + '" stroke-width="1.8" stroke-linecap="round"/>' +
      '<ellipse cx="35" cy="63" rx="4" ry="2.4" fill="#e98b8b" opacity=".18"/><ellipse cx="65" cy="63" rx="4" ry="2.4" fill="#e98b8b" opacity=".18"/>' +
      accessory +
      '<path d="M15 102V91c3-14 16-20 35-20s32 6 35 20v11Z" fill="' + preset.jersey + '"/>' +
      '<path d="M32 75c3 10 9 14 18 14s15-4 18-14l-6-4H38Z" fill="' + preset.skin + '"/>' +
      '<path d="M32 82c5 8 11 11 18 11s13-3 18-11" fill="none" stroke="' + preset.detail + '" stroke-width="3" opacity=".75"/>' +
      '<path d="M22 91c9-5 17-6 28-6s19 1 28 6" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2"/>' +
      '<circle cx="22" cy="22" r="13" fill="rgba(255,255,255,.12)"/><path d="M16 23h12" stroke="rgba(255,255,255,.28)" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';
  }

  function getIllustratedAvatarUrl(avatarId) {
    const normalized = normalizeAvatarId(avatarId) || 'avatar-1';
    const options = {
      'avatar-1': { seed: 'pickr-skyline', bg: 'b6e3f4' },
      'avatar-2': { seed: 'pickr-evergreen', bg: 'c0f2d8' },
      'avatar-3': { seed: 'pickr-ember', bg: 'ffd5b5' },
      'avatar-4': { seed: 'pickr-violet', bg: 'e6d8ff' },
      'avatar-5': { seed: 'pickr-rose', bg: 'ffd6e2' },
      'avatar-6': { seed: 'pickr-gold', bg: 'fff0b6' }
    };
    const option = options[normalized] || options['avatar-1'];
    return 'https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=' + encodeURIComponent(option.seed) + '&backgroundColor=' + option.bg + '&radius=50&scale=95';
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
    const portraitUrl = getIllustratedAvatarUrl(avatarId);
    const fallback = buildAvatarArt(preset);
    el.innerHTML = '<img class="avatar-portrait" src="' + portraitUrl + '" alt="" referrerpolicy="no-referrer">';
    const portrait = el.querySelector('.avatar-portrait');
    if (portrait) {
      portrait.addEventListener('error', () => {
        // Keep an offline local portrait available if the illustration service
        // cannot be reached on a particular network.
        el.innerHTML = fallback;
      }, { once: true });
    }
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
    const xp = userProfile && typeof userProfile.xp !== 'undefined' ? String(userProfile.xp) : '0';
    document.querySelectorAll('.tokens').forEach(el => el.textContent = tokens);
    // Pickr is free-to-play: tokens have no cash value. Any legacy cash element
    // is hidden rather than showing a dollar amount.
    document.querySelectorAll('.cash').forEach(el => { el.textContent = ''; el.style.display = 'none'; });
    document.querySelectorAll('.banner-bal-cash').forEach(el => { el.style.display = 'none'; });
    document.querySelectorAll('.xp').forEach(el => el.textContent = xp);
    const xpEl = document.getElementById('xp'); if (xpEl) xpEl.textContent = xp;
    const walletTokensEl = document.getElementById('walletTokens'); if (walletTokensEl) walletTokensEl.textContent = tokens;
    const walletTokensLargeEl = document.getElementById('walletTokensLarge'); if (walletTokensLargeEl) walletTokensLargeEl.textContent = tokens;
    // Also update header-specific elements (some pages use ids instead of classes)
    const headerTokensEl = document.getElementById('headerTokens'); if (headerTokensEl) headerTokensEl.textContent = tokens;

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
    '/tasks',
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

  // Returns true if a redirect was triggered (caller should abort page reveal)
  function enforceOnboarding(profile) {
    if (!profile || profile.profileComplete) return false;
    if (shouldBypassOnboardingGuard()) return false;
    // Flag so revealPage() won't flash content during redirect
    window.__pickrOnboardingRedirect = true;
    window.location.replace('/onboarding.html');
    return true;
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
    const countBadge = document.getElementById('slipCountBadge');
    if (!betSlipList) return;
    betSlipList.innerHTML = '';
    const entries = Object.entries(betSlip);

    // Update count badge
    if (countBadge) {
      if (entries.length > 0) {
        countBadge.style.display = 'inline-block';
        countBadge.textContent = entries.length + (entries.length === 1 ? ' pick' : ' picks');
      } else {
        countBadge.style.display = 'none';
      }
    }

    if (entries.length === 0) {
      betSlipList.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:24px 0 8px">' +
          '<div style="font-size:32px;opacity:0.35">🎯</div>' +
          '<div style="font-size:13px;color:#475569;text-align:center;line-height:1.5">No picks yet.<br>Tap a team on any card to add it here.</div>' +
        '</div>';
      if (confirmBtn) confirmBtn.classList.add('hidden');
      return;
    }
    const useParlay = entries.length > 1 && betMode === 'parlay';
    if (confirmBtn) confirmBtn.classList.remove('hidden');

    // Pickr is free-to-play: predictions always use virtual tokens only. There
    // is no cash currency and no cash staking.
    const cashAvailable = false;
    betCurrency = 'tokens';
    const stakeLabel = 'Tokens';
    const stakePlaceholder = 'Stake (tokens)';
    const currencyIcon = '🪙';

    if (useParlay) {
      const combinedOdds = computeParlayOdds(entries);
      const summary = document.createElement('div');
      summary.style.cssText = 'background:rgba(122,167,255,0.07);border:1px solid rgba(122,167,255,0.18);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;';
      const legs = entries.map(([, info]) => escapeHtml(info.team)).join(' + ');
      const amOdds = combinedOdds && Number.isFinite(combinedOdds) && combinedOdds > 1
        ? (combinedOdds >= 2 ? '+' + Math.round((combinedOdds - 1) * 100) : '-' + Math.round(100 / (combinedOdds - 1)))
        : '—';
      summary.innerHTML =
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;font-weight:700">Parlay · ' + entries.length + ' Legs</div>' +
        '<div style="font-size:13px;color:#e2e8f0;font-weight:600;line-height:1.5">' + legs + '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border-radius:10px;border:1px solid rgba(255,255,255,0.06)">' +
          '<span style="font-size:12px;color:#94a3b8">Combined odds</span>' +
          '<span style="font-size:14px;font-weight:800;color:#7aa7ff;font-family:Space Grotesk,sans-serif">' + amOdds + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<div style="position:relative;flex:1">' +
            '<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px">' + currencyIcon + '</span>' +
            '<input id="parlayStake" type="number" inputmode="decimal" min="0" step="0.01" class="slip-stake-input" style="padding-left:30px" value="' + (parlayStake || '') + '" placeholder="' + stakePlaceholder + '" />' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<button id="toggleBetMode" type="button" class="slip-mode-btn">↩ Straight bets</button>' +
        '</div>';
      betSlipList.appendChild(summary);
    } else {
      entries.forEach(([matchId, info]) => {
        const amOdds = info.odds && Number.isFinite(Number(info.odds)) && Number(info.odds) > 1
          ? (Number(info.odds) >= 2 ? '+' + Math.round((Number(info.odds) - 1) * 100) : '-' + Math.round(100 / (Number(info.odds) - 1)))
          : '—';
        const li = document.createElement('div');
        li.className = 'slip-item';
        li.innerHTML =
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:14px;font-weight:700;color:#f1f5f9;font-family:Space Grotesk,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(info.team) + '</div>' +
              '<div style="display:flex;align-items:center;gap:6px;margin-top:3px">' +
                '<span style="font-size:11px;color:#64748b">Odds</span>' +
                '<span style="font-size:12px;font-weight:800;color:#7aa7ff;font-family:Space Grotesk,sans-serif;background:rgba(122,167,255,0.1);padding:2px 8px;border-radius:999px;border:1px solid rgba(122,167,255,0.2)">' + amOdds + '</span>' +
              '</div>' +
            '</div>' +
            '<button data-match="' + escapeHtml(matchId) + '" class="remove-slip slip-remove-btn" title="Remove">✕</button>' +
          '</div>' +
          '<div style="position:relative">' +
            '<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px">' + currencyIcon + '</span>' +
            '<input type="number" inputmode="decimal" min="0" step="0.01" data-match="' + escapeHtml(matchId) + '" class="stake-input slip-stake-input" style="padding-left:30px" value="' + (info.stake || '') + '" placeholder="' + stakePlaceholder + '" />' +
          '</div>';
        betSlipList.appendChild(li);
      });

      const toggleWrap = document.createElement('div');
      toggleWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px;';
      toggleWrap.innerHTML =
        (entries.length > 1 ? '<button id="toggleBetMode" type="button" class="slip-mode-btn">⚡ Parlay these picks</button>' : '') +
        '<div class="slip-mode-note" style="font-size:11px;color:#64748b;text-align:center;padding:4px 0">Practice picks use virtual tokens. No real money is wagered.</div>';
      betSlipList.appendChild(toggleWrap);
    }

    // Attach listeners
    betSlipList.querySelectorAll('.remove-slip').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.getAttribute('data-match'); delete betSlip[m];
        document.querySelectorAll(`.select-team[data-match="${m}"]`).forEach(s => {
          s.classList.remove('selected');
          s.style.background = 'rgba(255,255,255,0.04)';
          s.style.borderColor = 'rgba(255,255,255,0.09)';
          s.style.boxShadow = 'none';
          s.style.opacity = '1';
          s.disabled = false;
        });
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
        // Pickr is free-to-play: only virtual tokens are supported.
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
          await failFlow('auth', 'Please sign in to submit picks.');
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
      // Pickr is free-to-play: picks always use virtual tokens.
      {
        const totalTokens = Math.trunc(total);
        if (totalTokens > currentTokens) {
          await failFlow('balance', 'Insufficient token balance.');
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
              if (rewards && typeof rewards.firstBetEligible !== 'undefined') userProfile.firstBetEligible = !!rewards.firstBetEligible;
              if (rewards && typeof rewards.firstParlayEligible !== 'undefined') userProfile.firstParlayEligible = !!rewards.firstParlayEligible;
              if (rewards && typeof rewards.firstBetRewarded !== 'undefined') userProfile.firstBetRewarded = !!rewards.firstBetRewarded;
              if (rewards && typeof rewards.firstParlayRewarded !== 'undefined') userProfile.firstParlayRewarded = !!rewards.firstParlayRewarded;
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
                if (rewards && typeof rewards.firstBetEligible !== 'undefined') userProfile.firstBetEligible = !!rewards.firstBetEligible;
                if (rewards && typeof rewards.firstParlayEligible !== 'undefined') userProfile.firstParlayEligible = !!rewards.firstParlayEligible;
                if (rewards && typeof rewards.firstBetRewarded !== 'undefined') userProfile.firstBetRewarded = !!rewards.firstBetRewarded;
                if (rewards && typeof rewards.firstParlayRewarded !== 'undefined') userProfile.firstParlayRewarded = !!rewards.firstParlayRewarded;
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
        // Close mobile bet slip panel on success
        var _bsc = document.getElementById('betSlipContainer');
        var _bso = document.getElementById('betSlipOverlay');
        if (_bsc) _bsc.classList.remove('open');
        if (_bso) _bso.classList.add('hidden');
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
    const liveWindow = 5 * 60 * 60 * 1000; // keep started games for 5 hours
    const floorTs = Number.isFinite(minTs) ? minTs : now;
    return (picks || [])
      .map(p => {
        let ts = toMillis(p.commence_time || p.startTime || p.date || null);
        if ((!Number.isFinite(ts) || ts === 0) && allowMissingTs) ts = floorTs;
        return { pick: p, ts };
      })
      .filter(p => {
        if (!Number.isFinite(p.ts)) return false;
        // Include games that have started within the live window
        if (p.ts <= now) return p.ts > now - liveWindow;
        // Include future games within the sport window
        return p.ts <= now + windowMs;
      })
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
        if (!Number.isFinite(p.ts)) return false;
        const liveWindow = 5 * 60 * 60 * 1000;
        // Include games that have started within the live window
        if (p.ts <= now) return p.ts > now - liveWindow;
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
    const isGuest = !(window.firebase && firebase.auth && firebase.auth().currentUser);
    let headers = await getAuthHeaders();
    if (!isGuest && !headers.Authorization && !headers['x-dev-uid']) {
      await waitForAuthReady();
      headers = await getAuthHeaders();
    }
    // For guests, skip auth headers entirely so the server gets a clean request
    if (isGuest) headers = {};
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
          : sport === 'mlb' || sport === 'soccer'
            ? 3 * 24 * 60 * 60 * 1000
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

  // ── Live Scores helpers for inline cards ──
  let _liveScoresPicksCache = { data: null, sport: null, ts: 0 };
  const _gameEndTimes = {}; // espnId -> timestamp when first seen as 'post'

  async function fetchLiveScoresForPicks(sport) {
    const now = Date.now();
    if (_liveScoresPicksCache.sport === sport && _liveScoresPicksCache.data && (now - _liveScoresPicksCache.ts) < 4000) {
      return _liveScoresPicksCache.data;
    }
    const base = typeof getAPIBase === 'function' ? getAPIBase() : ((window.PICKR_CONFIG && window.PICKR_CONFIG.API_BASE_URL) || '');
    const sportParam = (!sport || sport === 'all') ? null : sport;

    if (!sportParam) {
      // Fetch all sports in parallel for the "all" tab
      const sports = ['nba', 'nfl', 'nhl', 'mlb', 'soccer'];
      const results = await Promise.allSettled(sports.map(async s => {
        const resp = await fetch(base + '/api/scores/live?sport=' + encodeURIComponent(s));
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.games || []).map(g => Object.assign({}, g, { sportKey: s }));
      }));
      let allGames = [];
      results.forEach(r => { if (r.status === 'fulfilled') allGames = allGames.concat(r.value); });
      _liveScoresPicksCache = { data: allGames, sport: 'all', ts: now };
      return allGames;
    }

    const resp = await fetch(base + '/api/scores/live?sport=' + encodeURIComponent(sportParam));
    if (!resp.ok) return [];
    const data = await resp.json();
    const games = (data.games || []).map(g => Object.assign({}, g, { sportKey: sportParam }));
    _liveScoresPicksCache = { data: games, sport: sportParam, ts: now };
    return games;
  }

  function matchPickToEspnGame(pick, espnGames) {
    if (!espnGames || !espnGames.length) return null;
    const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const homeNeedle = normalize(pick.home_team);
    const awayNeedle = normalize(pick.away_team);
    if (!homeNeedle || !awayNeedle) return null;

    return espnGames.find(g => {
      const eh = normalize(g.homeTeam && g.homeTeam.name);
      const ea = normalize(g.awayTeam && g.awayTeam.name);
      const ehA = normalize(g.homeTeam && g.homeTeam.abbreviation);
      const eaA = normalize(g.awayTeam && g.awayTeam.abbreviation);
      const homeMatch = eh.includes(homeNeedle) || homeNeedle.includes(eh) || ehA === homeNeedle;
      const awayMatch = ea.includes(awayNeedle) || awayNeedle.includes(ea) || eaA === awayNeedle;
      return homeMatch && awayMatch;
    }) || null;
  }

  function createLiveScoreCard(pick, espnGame) {
    const card = document.createElement('article');
    card.className = '';
    card.style.cssText = 'background:rgba(13,18,32,0.92);border:1px solid rgba(255,255,255,0.09);border-radius:18px;padding:18px;box-shadow:0 4px 28px rgba(0,0,0,0.45);overflow:hidden;position:relative;';
    // Top accent bar
    (function(){const a=document.createElement('div');a.style.cssText='position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,rgba(52,211,153,0.6),rgba(122,167,255,0.25),transparent);pointer-events:none;';card.appendChild(a);})();

    const matchId = pick.id || pick.matchId || '';
    const startTime = pick.commence_time || pick.startTime || pick.date || '';
    const startMs = startTime ? new Date(startTime).getTime() : NaN;
    if (Number.isFinite(startMs)) card.setAttribute('data-game-start', String(startMs));
    card.setAttribute('data-match-id', matchId);
    card.setAttribute('data-live', 'true');
    if (espnGame && espnGame.id) card.setAttribute('data-espn-id', espnGame.id);

    const isLive = espnGame && espnGame.status && espnGame.status.state === 'in';
    const isFinal = espnGame && espnGame.status && espnGame.status.state === 'post';
    const sportKey = pick.sport_key || pick.sportKey || '';

    // Track game end times
    if (isFinal && espnGame && !_gameEndTimes[espnGame.id]) {
      _gameEndTimes[espnGame.id] = Date.now();
    }

    const statusHtml = isLive
      ? '<div class="flex items-center gap-2"><span class="relative flex h-2 w-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span><span class="text-xs font-bold uppercase tracking-widest text-emerald-400">LIVE</span></div>'
      : isFinal
      ? '<span class="text-xs font-bold uppercase tracking-widest text-slate-400">FINAL</span>'
      : '<span class="text-xs font-bold uppercase tracking-widest text-sky-400">In Progress</span>';

    const clockHtml = isLive && espnGame.status
      ? '<span class="text-xs font-semibold text-emerald-300" data-live-clock>' + escapeHtml(espnGame.status.shortDetail || espnGame.status.detail || '') + '</span>'
      : '';

    const awayScore = espnGame ? espnGame.awayTeam.score : '-';
    const homeScore = espnGame ? espnGame.homeTeam.score : '-';
    const awayLogoRaw = espnGame ? (espnGame.awayTeam.logo || '') : '';
    const homeLogoRaw = espnGame ? (espnGame.homeTeam.logo || '') : '';
    const awayLogo = escapeHtml(awayLogoRaw);
    const homeLogo = escapeHtml(homeLogoRaw);
    const awayFullName = espnGame ? escapeHtml(espnGame.awayTeam.name) : escapeHtml(pick.away_team || '');
    const homeFullName = espnGame ? escapeHtml(espnGame.homeTeam.name) : escapeHtml(pick.home_team || '');

    const aN = Number(awayScore), hN = Number(homeScore);
    const awayWinning = isLive && aN > hN;
    const homeWinning = isLive && hN > aN;
    const awayWon = isFinal && aN > hN;
    const homeWon = isFinal && hN > aN;

    const leagueText = escapeHtml(pick.league || pick.sport || '');
    const espnId = espnGame ? espnGame.id : '';
    const sportParam = encodeURIComponent(sportKey);

    // ── Playoff series badge ──
    let seriesText = '';
    if (espnGame) {
      // Primary: notes array (e.g. "Series tied 2-2", "OKC leads series 3-1")
      if (espnGame.notes && espnGame.notes.length > 0) {
        seriesText = espnGame.notes[0];
      }
      // Secondary: structured series object
      if (!seriesText && espnGame.series) {
        const sr = espnGame.series;
        if (sr.summary) {
          seriesText = sr.summary;
        } else if (sr.homeWins != null && sr.awayWins != null) {
          const hw = sr.homeWins, aw = sr.awayWins;
          const homeName = espnGame.homeTeam ? (espnGame.homeTeam.abbreviation || espnGame.homeTeam.name || '') : '';
          const awayName = espnGame.awayTeam ? (espnGame.awayTeam.abbreviation || espnGame.awayTeam.name || '') : '';
          if (hw === aw) seriesText = 'Series tied ' + hw + '-' + aw;
          else if (hw > aw) seriesText = homeName + ' lead ' + hw + '-' + aw;
          else seriesText = awayName + ' lead ' + aw + '-' + hw;
        } else if (sr.title) {
          seriesText = sr.title;
        }
      }
    }
    const seriesBadge = seriesText
      ? '<div data-series-badge style="display:flex;align-items:center;gap:6px;margin-top:8px;padding:5px 10px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px">' +
          '<span style="font-size:11px">🏆</span>' +
          '<span style="font-size:11px;font-weight:600;color:#fbbf24;letter-spacing:0.02em;font-family:Space Grotesk,sans-serif">' + escapeHtml(seriesText) + '</span>' +
        '</div>'
      : '<div data-series-badge style="display:none"></div>';

    const awayScoreColor = awayWinning ? '#34d399' : awayWon ? '#ffffff' : '#94a3b8';
    const homeScoreColor = homeWinning ? '#34d399' : homeWon ? '#ffffff' : '#94a3b8';
    const awayNameColor  = awayWinning || awayWon ? '#ffffff' : '#cbd5e1';
    const homeNameColor  = homeWinning || homeWon ? '#ffffff' : '#cbd5e1';
    const awayAbbr = escapeHtml((espnGame ? espnGame.awayTeam.abbreviation : '').slice(0,3));
    const homeAbbr = escapeHtml((espnGame ? espnGame.homeTeam.abbreviation : '').slice(0,3));
    const clockDisplay = isLive && espnGame && espnGame.status ? escapeHtml(espnGame.status.shortDetail || espnGame.status.detail || '') : '';

    card.innerHTML =
      /* ── Header row ── */
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:8px" data-live-status>' + statusHtml +
          '<span style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#475569;font-weight:600">' + leagueText + '</span>' +
        '</div>' +
        (clockDisplay ? '<span style="font-size:11px;font-weight:700;color:#34d399;font-family:Space Grotesk,sans-serif;font-variant-numeric:tabular-nums;background:rgba(52,211,153,0.08);padding:3px 10px;border-radius:999px;border:1px solid rgba(52,211,153,0.18)">' + clockDisplay + '</span>' : '') +
      '</div>' +
      /* ── Away team row ── */
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">' +
        '<div style="width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">' +
          (awayLogo ? '<img src="' + awayLogo + '" alt="" style="width:38px;height:38px;object-fit:contain;" onerror="this.onerror=null;this.style.display=\'none\';this.parentNode.innerHTML=\'<span style=\\\"font-size:11px;color:#94a3b8\\\">' + awayAbbr + '</span>\'">' : '<span style="font-size:11px;color:#94a3b8">' + awayAbbr + '</span>') +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:15px;font-weight:700;color:' + awayNameColor + ';font-family:Space Grotesk,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + awayFullName + '</div>' +
        '</div>' +
        '<div style="font-size:30px;font-weight:800;color:' + awayScoreColor + ';font-family:Space Grotesk,sans-serif;min-width:42px;text-align:right;line-height:1;letter-spacing:-0.02em' + (awayWinning ? ';text-shadow:0 0 18px rgba(52,211,153,0.55)' : '') + '" data-score-side="away">' + escapeHtml(awayScore) + '</div>' +
      '</div>' +
      /* ── Divider ── */
      '<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.07),transparent);margin:0 0 8px 0;"></div>' +
      /* ── Home team row ── */
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">' +
          (homeLogo ? '<img src="' + homeLogo + '" alt="" style="width:38px;height:38px;object-fit:contain;" onerror="this.onerror=null;this.style.display=\'none\';this.parentNode.innerHTML=\'<span style=\\\"font-size:11px;color:#94a3b8\\\">' + homeAbbr + '</span>\'">' : '<span style="font-size:11px;color:#94a3b8">' + homeAbbr + '</span>') +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:15px;font-weight:700;color:' + homeNameColor + ';font-family:Space Grotesk,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + homeFullName + '</div>' +
        '</div>' +
        '<div style="font-size:30px;font-weight:800;color:' + homeScoreColor + ';font-family:Space Grotesk,sans-serif;min-width:42px;text-align:right;line-height:1;letter-spacing:-0.02em' + (homeWinning ? ';text-shadow:0 0 18px rgba(52,211,153,0.55)' : '') + '" data-score-side="home">' + escapeHtml(homeScore) + '</div>' +
      '</div>' +
      /* ── Series badge ── */
      seriesBadge +
      /* ── Footer: live info link ── */
      ((isLive || isFinal) && espnId ? '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px">' +
        '<span data-live-updated style="font-size:9px;color:#475569;font-variant-numeric:tabular-nums"></span>' +
        '<a href="live-game.html?id=' + escapeHtml(espnId) + '&sport=' + sportParam + '" style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:12px;font-weight:700;background:rgba(52,211,153,0.12);color:#34d399;border:1px solid rgba(52,211,153,0.25);text-decoration:none;transition:all 0.18s;font-family:Space Grotesk,sans-serif">' +
          'Live Info <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>' +
        '</a></div>' : '');

    // MLB Next Up Batters (for live games with situation data)
    if (isLive && espnGame && espnGame.situation) {
      const sit = espnGame.situation;
      const hasBatters = sit.batter || sit.onDeck || sit.inHole;
      if (hasBatters) {
        let battersHtml = '<div data-mlb-batters style="margin-top:10px;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06)">';
        battersHtml += '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;font-weight:600;margin-bottom:8px">⚾ Next Up</div>';
        const renderBatterRow = (player, label, labelColor) => {
          if (!player) return '';
          const nameStr = escapeHtml(player.displayName || '');
          const jerseyStr = player.jersey ? ' <span style="color:#64748b;font-size:10px">#' + escapeHtml(player.jersey) + '</span>' : '';
          const summaryStr = player.summary ? '<div style="font-size:10px;color:#64748b;margin-top:1px">' + escapeHtml(player.summary) + '</div>' : '';
          const headshotStr = player.headshot
            ? '<img src="' + escapeHtml(player.headshot) + '" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;background:#334155;flex-shrink:0">'
            : '<div style="width:28px;height:28px;border-radius:50%;background:#334155;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px">⚾</div>';
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">' +
            headshotStr +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:' + labelColor + ';font-weight:700">' + label + '</div>' +
              '<div style="font-size:12px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + nameStr + jerseyStr + '</div>' +
              summaryStr +
            '</div>' +
          '</div>';
        };
        battersHtml += renderBatterRow(sit.batter, 'At Bat', '#34d399');
        battersHtml += renderBatterRow(sit.onDeck, 'On Deck', '#fbbf24');
        battersHtml += renderBatterRow(sit.inHole, 'In the Hole', '#94a3b8');

        // Mini base indicators
        if (sit.onFirst || sit.onSecond || sit.onThird || sit.outs != null) {
          battersHtml += '<div style="display:flex;align-items:center;gap:12px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.05)">';
          // Diamond mini
          battersHtml += '<div style="position:relative;width:28px;height:28px">';
          battersHtml += '<div style="position:absolute;width:8px;height:8px;transform:rotate(45deg);top:2px;left:10px;border:1px solid ' + (sit.onSecond ? '#fbbf24' : '#475569') + ';background:' + (sit.onSecond ? '#fbbf24' : 'transparent') + ';border-radius:1px"></div>';
          battersHtml += '<div style="position:absolute;width:8px;height:8px;transform:rotate(45deg);top:10px;left:2px;border:1px solid ' + (sit.onThird ? '#fbbf24' : '#475569') + ';background:' + (sit.onThird ? '#fbbf24' : 'transparent') + ';border-radius:1px"></div>';
          battersHtml += '<div style="position:absolute;width:8px;height:8px;transform:rotate(45deg);top:10px;left:18px;border:1px solid ' + (sit.onFirst ? '#fbbf24' : '#475569') + ';background:' + (sit.onFirst ? '#fbbf24' : 'transparent') + ';border-radius:1px"></div>';
          battersHtml += '</div>';
          // Outs
          if (sit.outs != null) {
            let outsHtml = '<div style="display:flex;align-items:center;gap:3px"><span style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-right:3px">Outs</span>';
            for (let i = 0; i < 3; i++) {
              outsHtml += '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;' + (i < sit.outs ? 'background:#f97316;border:1px solid transparent' : 'border:1px solid #475569;background:transparent') + '"></span>';
            }
            outsHtml += '</div>';
            battersHtml += outsHtml;
          }
          battersHtml += '</div>';
        }

        battersHtml += '</div>';
        card.innerHTML += battersHtml;
      }
    }

    if (isLive) {
      card.style.borderLeft = '3px solid rgba(52,211,153,0.7)';
      card.style.boxShadow = '0 4px 28px rgba(0,0,0,0.45), -2px 0 20px rgba(52,211,153,0.12)';
    }
    return card;
  }

  function createPickCard(pick, espnGame) {
    const conf = computeConfidence(pick); const confBadge = confidenceLabel(conf);
    const card = document.createElement('article'); card.className = 'market-card bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-sm';
    card.style.cssText = 'background:rgba(15,20,36,0.88);border:1px solid rgba(255,255,255,0.09);border-radius:18px;padding:18px;box-shadow:0 4px 24px rgba(0,0,0,0.35);overflow:hidden;position:relative;';
    // Subtle top accent
    const topAccent = document.createElement('div');
    topAccent.style.cssText = 'position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,rgba(255,122,26,0.5),rgba(122,167,255,0.25),transparent);pointer-events:none;';
    card.appendChild(topAccent);
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
    const top = document.createElement('div'); top.className = 'flex items-center justify-between mb-2';
    // Sanitize league text — strip any "Team vs Team" matchup strings, keep only sport/league labels
    let rawLeague = pick.league || pick.sport || '';
    const knownLeagues = ['NBA', 'NFL', 'NHL', 'MLB', 'SOCCER', 'MLS', 'FIFA WORLD CUP', 'LA LIGA', 'UEFA CHAMPIONS LEAGUE', 'UCL', 'EPL', 'PREMIER LEAGUE', 'SERIE A', 'BUNDESLIGA', 'LIGUE 1'];
    if (rawLeague && !knownLeagues.includes(rawLeague.toUpperCase().trim())) {
      // If the league looks like a matchup (contains "vs" or "at" between two names), strip it
      if (/\bvs\.?\b|\bat\b/i.test(rawLeague)) rawLeague = pick.sport || '';
    }
    const league = document.createElement('div'); league.className = 'text-xs'; league.style.cssText = 'color:#64748b;font-weight:500;'; league.textContent = rawLeague;
    const time = document.createElement('div'); time.className = 'text-xs'; time.style.cssText = 'color:#64748b;'; time.textContent = fmtDate(pick.commence_time || pick.startTime || pick.date || '');
    top.appendChild(league); top.appendChild(time); card.appendChild(top);

    // Series badge (playoffs)
    let pregameSeriesText = '';
    if (espnGame) {
      if (espnGame.notes && espnGame.notes.length > 0) pregameSeriesText = espnGame.notes[0];
      if (!pregameSeriesText && espnGame.series) {
        const sr = espnGame.series;
        if (sr.summary) pregameSeriesText = sr.summary;
        else if (sr.title) pregameSeriesText = sr.title;
      }
    }
    if (pregameSeriesText) {
      const seriesDiv = document.createElement('div');
      seriesDiv.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.25);margin-bottom:8px;font-size:0.72rem;font-weight:600;color:#fbbf24;';
      seriesDiv.innerHTML = '🏆 <span>' + escapeHtml(pregameSeriesText) + '</span>';
      card.appendChild(seriesDiv);
    }

    // matchup text — only show for props, skip for regular H2H since logos show team names
    if (isProp) {
      const matchup = document.createElement('div'); matchup.className = 'flex items-center justify-between gap-4';
      const left = document.createElement('div'); left.className = 'text-sm text-gray-200';
      const label = marketType ? String(marketType).replace(/_/g, ' ').toUpperCase() : 'PROP';
      const lineLabel = propLine ? `Line ${propLine}` : '';
      left.innerHTML = `
        <div class="font-medium">${escapeHtml(propTitle || 'Player Prop')}</div>
        <div class="text-xs text-gray-400">${escapeHtml(label)}${lineLabel ? ` • ${escapeHtml(lineLabel)}` : ''}</div>
      `;
      matchup.appendChild(left); card.appendChild(matchup);
    }

    // Hero matchup section — only for regular H2H moneyline games
    if (!isProp) {
      const heroRow = document.createElement('div');
      heroRow.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:14px 0 6px;';

      const makeTeamBlock = (teamName, isHome) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:' + (isHome ? 'flex-end' : 'flex-start') + ';gap:6px;';
        // Logo circle
        const logoCircle = document.createElement('div');
        logoCircle.style.cssText = 'width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;overflow:hidden;';
        const img = document.createElement('img');
        img.style.cssText = 'width:50px;height:50px;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.4));';
        applyTeamLogo(img, teamName, sportKey);
        logoCircle.appendChild(img);
        // Team name chip
        const nameEl = document.createElement('div');
        const shortTeam = teamName.length > 14 ? teamName.split(' ').slice(-1)[0] : teamName;
        nameEl.textContent = shortTeam;
        nameEl.style.cssText = 'font-size:12px;font-weight:700;color:#e2e8f0;font-family:Space Grotesk,sans-serif;text-align:' + (isHome ? 'right' : 'left') + ';line-height:1.2;letter-spacing:-0.01em;';
        wrap.appendChild(logoCircle);
        wrap.appendChild(nameEl);
        return wrap;
      };

      const awayBlock = makeTeamBlock(pick.away_team || '', false);
      const homeBlock = makeTeamBlock(pick.home_team || '', true);

      // Center VS badge
      const vsCenter = document.createElement('div');
      vsCenter.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;';
      const vsBadge = document.createElement('div');
      vsBadge.style.cssText = 'width:36px;height:36px;border-radius:50%;background:rgba(255,122,26,0.14);border:1.5px solid rgba(255,122,26,0.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#ff7a1a;font-family:Space Grotesk,sans-serif;letter-spacing:0.04em;';
      vsBadge.textContent = 'VS';
      const timeChip = document.createElement('div');
      const fmtTime = pick.commence_time || pick.startTime || pick.date || '';
      const tDate = fmtTime ? new Date(fmtTime) : null;
      let timeStr = '';
      if (tDate && !isNaN(tDate.getTime())) {
        const h = tDate.getHours(), m = tDate.getMinutes();
        timeStr = (h % 12 || 12) + (m ? ':' + String(m).padStart(2,'0') : '') + (h < 12 ? ' AM' : ' PM');
      }
      timeChip.textContent = timeStr || '—';
      timeChip.style.cssText = 'font-size:9px;font-weight:600;color:#64748b;text-align:center;letter-spacing:0.04em;font-family:Space Grotesk,sans-serif;';
      vsCenter.appendChild(vsBadge);
      vsCenter.appendChild(timeChip);

      heroRow.appendChild(awayBlock);
      heroRow.appendChild(vsCenter);
      heroRow.appendChild(homeBlock);
      card.appendChild(heroRow);

      // Thin separator
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.07),transparent);margin:4px 0 0 0;';
      card.appendChild(sep);
    }

    // selection buttons
    const allowDraw = !!(oddsDraw && String(sportKey || '').toLowerCase().includes('soccer'));
    const btns = document.createElement('div'); btns.className = allowDraw ? 'grid grid-cols-3 gap-3 mt-3' : 'grid grid-cols-2 gap-3 mt-3';
    btns.style.cssText = 'gap:10px;margin-top:12px;';
    const makeBtn = (team, odds, isDraw = false) => {
      if (!Number.isFinite(odds) || odds <= 1) return null;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'select-team';
      // Core styles — dark glass card feel
      b.style.cssText = [
        'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px',
        'padding:14px 10px 12px',
        'border-radius:16px',
        'background:rgba(255,255,255,0.04)',
        'border:1.5px solid rgba(255,255,255,0.09)',
        'cursor:pointer',
        'transition:background 0.18s,border-color 0.18s,transform 0.12s,box-shadow 0.18s',
        'position:relative;overflow:hidden',
        '-webkit-tap-highlight-color:transparent',
      ].join(';');
      if (gameStarted) {
        b.disabled = true;
        b.style.opacity = '0.38';
        b.style.cursor = 'not-allowed';
      } else {
        b.addEventListener('mouseenter', () => {
          if (!b.classList.contains('selected')) b.style.borderColor = 'rgba(255,122,26,0.4)';
        });
        b.addEventListener('mouseleave', () => {
          if (!b.classList.contains('selected')) b.style.borderColor = 'rgba(255,255,255,0.09)';
        });
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

      // Sheen overlay
      const sheen = document.createElement('div');
      sheen.style.cssText = 'position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0.06) 0%,transparent 60%);pointer-events:none;border-radius:16px;';
      b.appendChild(sheen);

      let iconEl = null;
      if (isProp) {
        iconEl = document.createElement('div');
        iconEl.style.cssText = 'width:44px;height:44px;border-radius:50%;background:rgba(122,167,255,0.1);border:1.5px solid rgba(122,167,255,0.22);display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:800;color:#9fb8ff;font-family:Space Grotesk,sans-serif;';
        iconEl.textContent = isDraw ? 'TIE' : (team && team.toLowerCase().includes('over') ? 'O' : (team && team.toLowerCase().includes('under') ? 'U' : (team && team.toLowerCase() === 'yes' ? 'Y' : (team && team.toLowerCase() === 'no' ? 'N' : 'P'))));
      } else {
        const imgWrap = document.createElement('div');
        imgWrap.style.cssText = 'width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;overflow:hidden;';
        const img = document.createElement('img');
        img.style.cssText = 'width:44px;height:44px;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));';
        applyTeamLogo(img, team, sportKey);
        imgWrap.appendChild(img);
        iconEl = imgWrap;
      }
      const name = document.createElement('div');
      name.style.cssText = 'color:#e2e8f0;font-weight:700;font-size:0.74rem;line-height:1.25;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-family:Space Grotesk,sans-serif;letter-spacing:-0.01em;';
      // Shorten long team names
      const shortName = team.length > 16 ? team.split(' ').slice(-1)[0] : team;
      name.textContent = shortName;
      // Odds pill
      const oddsPill = document.createElement('div');
      const amOdds = odds >= 2 ? '+' + Math.round((odds - 1) * 100) : '-' + Math.round(100 / (odds - 1));
      oddsPill.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;background:rgba(122,167,255,0.1);border:1px solid rgba(122,167,255,0.22);font-size:0.72rem;font-weight:700;color:#9fb8ff;font-family:Space Grotesk,sans-serif;letter-spacing:0.02em;';
      oddsPill.textContent = amOdds;

      if (iconEl) b.appendChild(iconEl);
      b.appendChild(name);
      b.appendChild(oddsPill);
      b.addEventListener('click', () => {
        // Reset all sibling buttons
        document.querySelectorAll(`.select-team[data-match="${b.getAttribute('data-match')}"]`).forEach(s => {
          s.classList.remove('selected');
          s.style.background = 'rgba(255,255,255,0.04)';
          s.style.borderColor = 'rgba(255,255,255,0.09)';
          s.style.boxShadow = 'none';
          s.style.opacity = '1';
          s.disabled = gameStarted;
          const sp = s.querySelector('[data-odds-pill]');
          if (sp) { sp.style.background = 'rgba(122,167,255,0.1)'; sp.style.color = '#9fb8ff'; sp.style.borderColor = 'rgba(122,167,255,0.22)'; }
        });
        document.querySelectorAll(`.select-team[data-match="${b.getAttribute('data-match')}"]`).forEach(s => {
          if (s !== b) { s.style.opacity = '0.45'; }
        });
        // Style selected
        b.classList.add('selected');
        b.style.background = 'rgba(255,122,26,0.14)';
        b.style.borderColor = 'rgba(255,122,26,0.55)';
        b.style.boxShadow = '0 0 20px rgba(255,122,26,0.2)';
        b.style.opacity = '1';
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
      const recBar = document.createElement('div');
      recBar.style.cssText = 'margin-top:0.75rem;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0.55rem 0.75rem;border-radius:12px;background:rgba(122,167,255,0.08);border:1px solid rgba(122,167,255,0.15);';
      recBar.innerHTML = `<div style="display:flex;align-items:center;gap:6px;font-size:0.78rem;color:#94a3b8;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;"><path d="M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" stroke="#7aa7ff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span style="color:#cbd5e1;font-weight:600;">${escapeHtml(rec.team)}</span><span style="color:#64748b;">• ${Math.round(rec.prob*100)}%</span></div>`;
      const recBtn = document.createElement('button'); recBtn.type = 'button';
      recBtn.style.cssText = 'padding:0.35rem 0.85rem;border-radius:999px;background:linear-gradient(135deg,rgba(255,122,26,0.25),rgba(255,122,26,0.12));color:#ffb37a;font-size:0.72rem;font-weight:700;border:1px solid rgba(255,122,26,0.4);cursor:pointer;white-space:nowrap;transition:all 0.2s;text-transform:uppercase;letter-spacing:0.06em;font-family:Space Grotesk,sans-serif;';
      recBtn.textContent = 'Select →';
      recBtn.addEventListener('mouseenter', () => { recBtn.style.background = 'linear-gradient(135deg,rgba(255,122,26,0.4),rgba(255,122,26,0.22))'; });
      recBtn.addEventListener('mouseleave', () => { recBtn.style.background = 'linear-gradient(135deg,rgba(255,122,26,0.25),rgba(255,122,26,0.12))'; });
      recBtn.addEventListener('click', () => { const selector = `.select-team[data-match="${pick.id || pick.matchId}"][data-team="${rec.team}"]`; const el = document.querySelector(selector); if (el) el.click(); });
      recBar.appendChild(recBtn);
      card.appendChild(recBar);
    }

  // meta — confidence bar
  const confPct = Math.round(conf*100);
  const confColor = confPct >= 70 ? '#34d399' : confPct >= 50 ? '#fbbf24' : '#f87171';
  const meta = document.createElement('div');
  meta.style.cssText = 'margin-top:0.75rem;display:flex;align-items:center;gap:8px;';
  meta.innerHTML = `<span style="font-size:0.68rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${confColor};white-space:nowrap;">${confBadge.text}</span><div style="flex:1;height:4px;border-radius:999px;background:rgba(255,255,255,0.06);overflow:hidden;"><div style="width:${confPct}%;height:100%;border-radius:999px;background:${confColor};transition:width 0.4s ease;"></div></div><span style="font-size:0.7rem;font-weight:600;color:#94a3b8;font-family:Space Grotesk,sans-serif;">${confPct}%</span>`;
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

      // Fetch live scores for cross-referencing with started games
      let liveGames = [];
      try { liveGames = await fetchLiveScoresForPicks(sport); } catch (e) { /* silent */ }

      container.innerHTML = '';
      if (!picks || picks.length === 0) {
        container.innerHTML = '<div class="text-gray-400 p-6">No bets available atm.</div>';
        return;
      }
      const now = Date.now();
      let rendered = 0;
      picks.forEach(p => {
        const startTime = p.commence_time || p.startTime || p.date || '';
        const startMs = startTime ? new Date(startTime).getTime() : NaN;
        const gameStarted = Number.isFinite(startMs) && startMs <= now;

        if (gameStarted) {
          const espnGame = matchPickToEspnGame(p, liveGames);
          // If game ended more than 1 hour ago, skip it
          if (espnGame && espnGame.status && espnGame.status.state === 'post') {
            if (!_gameEndTimes[espnGame.id]) _gameEndTimes[espnGame.id] = now;
            if (now - _gameEndTimes[espnGame.id] > 60 * 60 * 1000) return;
          }
          const card = createLiveScoreCard(p, espnGame);
          if (card) { container.appendChild(card); rendered++; }
        } else {
          const pregameEspn = matchPickToEspnGame(p, liveGames);
          const card = createPickCard(p, pregameEspn);
          if (card) { container.appendChild(card); rendered++; }
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
        if (!devUid) { historyContainer.innerHTML = '<div class="text-gray-500">Please sign in to view your picks and profile.</div>'; return; }
        headers['x-dev-uid'] = devUid;
      }
      const betsUrl = getAPIBase() + '/api/bets?ts=' + Date.now();
      const resp = await fetch(betsUrl, { headers, cache: 'no-store' });
      if (!resp.ok) { historyContainer.innerHTML = '<div class="text-gray-500">No picks yet.</div>'; return; }
      const data = await resp.json();
      const bets = Array.isArray(data.bets) ? data.bets : [];
      if (bets.length === 0) { historyContainer.innerHTML = '<div class="text-gray-500">No picks yet.</div>'; return; }
      bets.forEach(item => {
        const d = document.createElement('div'); d.className = 'py-2 flex justify-between items-start';
        const stake = Number(item.stake || item.amount || 0).toFixed(2);
        const placedAt = toMillis(item.placedAt || item.date || Date.now());
        d.innerHTML = `<div><strong>${escapeHtml(stake)}</strong> &ndash; ${escapeHtml((item.selections && item.selections.map(s=>s.pick).join(', ')) || item.team || item.description || 'Selection')}</div><div class="text-xs text-gray-400">${escapeHtml(new Date(placedAt || Date.now()).toLocaleString())}</div>`;
        historyContainer.appendChild(d);
      });
    } catch (e) {
      console.warn('Failed to load wallet bets:', e && e.message);
      historyContainer.innerHTML = '<div class="text-gray-500">Failed to load picks.</div>';
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

    // One-time starter quests: hide permanently once claimed (no 1-hour timer)
    setTaskVisibility('first-bet', !!betClaimed);
    setTaskVisibility('first-parlay', !!parlayClaimed);

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
        // Clear localStorage eligibility flags once claimed so they never re-trigger
        try {
          if (payload.firstBetRewarded) localStorage.removeItem('PICKR_FIRST_BET_UID');
          if (payload.firstParlayRewarded) localStorage.removeItem('PICKR_PARLAY_UID');
        } catch (e) {}
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

        // ── FIXED rotation math: compensate for existing wheel position ──
        // The pointer is at 0° (top). For pointer to see angle `centerAngle`
        // on the conic-gradient, the wheel must rest at (360 - centerAngle)°.
        const desiredFinalAngle = (360 - centerAngle + 360) % 360;
        const currentAngle = ((currentRotation % 360) + 360) % 360;
        let delta = desiredFinalAngle - currentAngle;
        if (delta <= 0) delta += 360; // always spin forward

        // Add a small random jitter so it doesn't always hit dead-center
        // Stays ±18° from center — well within the ~51° slice
        const jitter = (Math.random() - 0.5) * 36;

        const extraSpins = 5 + Math.floor(Math.random() * 3); // 5-7 full spins
        const targetRotation = currentRotation + (extraSpins * 360) + delta + jitter;

        currentRotation = ((targetRotation % 360) + 360) % 360;

        // Apply the spin with enhanced easing
        wheel.style.transition = 'none';
        void wheel.offsetHeight; // force reflow
        wheel.style.transition = 'transform 5.5s cubic-bezier(0.12, 0.75, 0.12, 1)';
        wheel.style.transform = `rotate(${targetRotation}deg)`;
        writeJSON('PICKR_SPIN_ROT', currentRotation);

        // Glow effect while spinning
        wheel.classList.add('spin-active-glow');
        const pointer = wheel.parentElement ? wheel.parentElement.querySelector('.spin-pointer') : null;
        if (pointer) pointer.classList.add('pointer-pulse');

        // ── Confetti burst helper ──
        const burstConfetti = (container) => {
          const colors = ['#fbbf24','#34d399','#8b5cf6','#ec4899','#3b82f6','#f97316','#ef4444'];
          const panel = container || modal.querySelector('.spin-modal__panel');
          if (!panel) return;
          for (let i = 0; i < 60; i++) {
            const dot = document.createElement('div');
            dot.className = 'confetti-particle';
            dot.style.setProperty('--cx', (Math.random() * 360 - 180) + 'px');
            dot.style.setProperty('--cy', (Math.random() * -320 - 40) + 'px');
            dot.style.setProperty('--cr', (Math.random() * 720 - 360) + 'deg');
            dot.style.setProperty('--cd', (0.6 + Math.random() * 0.9) + 's');
            dot.style.background = colors[Math.floor(Math.random() * colors.length)];
            dot.style.width = (4 + Math.random() * 6) + 'px';
            dot.style.height = (4 + Math.random() * 6) + 'px';
            dot.style.borderRadius = Math.random() > 0.5 ? '999px' : '2px';
            panel.appendChild(dot);
            setTimeout(() => dot.remove(), 1800);
          }
        };

        setTimeout(() => {
          spinning = false;
          wheel.classList.remove('spin-active-glow');
          if (pointer) pointer.classList.remove('pointer-pulse');

          const spinDate = data && data.spinDate ? String(data.spinDate) : getDateKey(new Date());
          localStorage.setItem('PICKR_SPIN_DATE', spinDate);
          const nextAvailable = data && data.nextAvailableAt ? new Date(data.nextAvailableAt) : getNextNoon(new Date());
          if (nextAvailable && Number.isFinite(nextAvailable.getTime())) {
            localStorage.setItem('PICKR_SPIN_LOCK_UNTIL', nextAvailable.toISOString());
            timer.textContent = `Resets in ${formatCountdown(nextAvailable - Date.now())} (12:00 PM)`;
          }
          if (Number.isFinite(reward) && reward > 0) awardTokens(reward);

          // Confetti burst!
          burstConfetti();

          // Dramatic result reveal
          modalStatus.textContent = '';
          modalResult.innerHTML = '';
          setTimeout(() => {
            modalStatus.textContent = '🎉 Reward confirmed!';
            modalResult.innerHTML = `<span class="reward-reveal">+${reward} Tokens</span>`;
          }, 150);

          status.textContent = 'Reward added to your balance';
          button.textContent = 'Come back tomorrow';
          button.disabled = true;
          if (!nextAvailable || !Number.isFinite(nextAvailable.getTime())) {
            timer.textContent = 'Completed for today';
          }
        }, 5800);
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
    if (summaryText) summaryText.textContent = `Showing your picks from ${label.toLowerCase()}.`;
    if (summaryChip) summaryChip.textContent = label;

    if (loader) loader.classList.remove('hidden');

    try {
      if (window.firebase && firebase.auth) {
        await waitForAuthReady();
      }
      // Skip syncUserProfile here — it's already called on page load.
      // Going straight to fetch saves ~1-2s of latency.
      let headers = {};
      if (window.firebase && firebase.auth && firebase.auth().currentUser) {
        const idToken = await firebase.auth().currentUser.getIdToken();
        headers.Authorization = 'Bearer ' + idToken;
      } else {
        const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const devUid = localStorage.getItem('DEV_AUTH_UID') || (isLocalhost ? 'test-user-123' : null);
        if (!devUid) {
          container.innerHTML = '<div class="empty-state">Please sign in to view your recent picks.</div>';
          if (summaryCount) summaryCount.textContent = '0';
          if (summaryStake) summaryStake.textContent = '0';
          return;
        }
        headers['x-dev-uid'] = devUid;
      }

      const resp = await fetch(getAPIBase() + '/api/bets?settle=1', { headers });
      if (requestId !== recentBetsRequestId) return;
      if (resp.status === 401 || resp.status === 403) {
        if (requestId !== recentBetsRequestId) return;
        container.innerHTML = '<div class="empty-state">Session expired. Please sign in again to view your picks.</div>';
        if (summaryCount) summaryCount.textContent = '0';
        if (summaryWins) summaryWins.textContent = '0';
        if (summaryLosses) summaryLosses.textContent = '0';
        if (summaryCash) summaryCash.textContent = '0';
        if (summaryTokens) summaryTokens.textContent = '0';
        return;
      }
      if (!resp.ok) {
        if (requestId !== recentBetsRequestId) return;
        container.innerHTML = `<div class="empty-state">No picks found for ${label.toLowerCase()}.</div>`;
        if (summaryCount) summaryCount.textContent = '0';
        if (summaryWins) summaryWins.textContent = '0';
        if (summaryLosses) summaryLosses.textContent = '0';
        if (summaryCash) summaryCash.textContent = '0';
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
      const countBadge = document.getElementById('betsCountBadge');
      if (countBadge) countBadge.textContent = String(recent.length);
      if (summaryWins) summaryWins.textContent = String(wins);
      if (summaryLosses) summaryLosses.textContent = String(losses);
      if (summaryCash) summaryCash.textContent = String(Math.round(tokensWagered));
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
          container.innerHTML = '<div class="empty-state">Syncing your picks. One moment...</div>';
          return;
        }
        const emptyMessage = `No picks for ${label.toLowerCase()}. Try the Sports tab to make a new one.`;
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
        const stakeTokensValue = stakeTokens || (isToken ? stakeValue : Math.round(stakeCash / (tokenToCashRate || 0.01)));
        const stakeCashValue = stakeCash || (!isToken ? stakeValue : Math.round(stakeTokensValue * tokenToCashRate * 100) / 100);
        const stakeDisplay = `${Math.round(stakeTokensValue)} Tokens`;
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
        const stakeLabel = 'Tokens';
        const potentialWin = combinedOdds > 1 ? Math.round(stakeTokensValue * combinedOdds) : 0;
        const potentialDisplay = potentialWin ? `${potentialWin} Tokens` : '—';
        const isParlay = String(item.type || '').toLowerCase() === 'parlay' || selectionItems.length > 1;
        const typeLabel = isParlay ? `PARLAY ${selectionItems.length}-LEG` : 'SINGLE';
        const cashNote = '';
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
            <span>Potential return</span>
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
          const marketType = String(selection.marketType || selection.market || '').toLowerCase();
          const marketLabel = marketType && marketType !== 'h2h'
            ? `Prop: ${marketType.replace(/_/g, ' ').toUpperCase()}`
            : '';
          const oddsLabel = typeof selection.odds !== 'undefined' && selection.odds !== null
            ? `Odds ${Number(selection.odds).toFixed(2)}x`
            : '';
          const metaParts = [marketLabel, oddsLabel].filter(Boolean);
          let legStatus = null;
          if (isParlay) {
            const rawStatus = String(selection.status || selection.result || selection.outcome || selection.settledStatus || '').toLowerCase();
            const inferredFromBet = statusRaw === 'won' ? 'won' : statusRaw === 'lost' ? 'lost' : statusRaw === 'void' ? 'void' : null;
            legStatus = rawStatus === 'won' || rawStatus === 'win'
              ? 'won'
              : rawStatus === 'lost' || rawStatus === 'lose'
                ? 'lost'
                : rawStatus === 'void'
                  ? 'void'
                  : (inferredFromBet || 'pending');
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
      container.innerHTML = '<div class="empty-state">Failed to load picks. Try again shortly.</div>';
      if (summaryCount) summaryCount.textContent = '0';
      if (summaryStake) summaryStake.textContent = '0';
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

  // ── Reveal page helper ──
  // Hides spinner + makes .pickr-page-content visible in one shot.
  // Waits for all resources (images, fonts) to finish loading first.
  window.__pickrPageRevealed = false;
  window.__pickrAuthGatePending = false;
  function revealPage() {
    if (window.__pickrPageRevealed) return;
    // Don't reveal if we're mid-redirect to onboarding — keep ball bouncing
    if (window.__pickrOnboardingRedirect) return;
    // Keep loader visible while initial auth/profile gate is still running
    if (window.__pickrAuthGatePending) return;

    function doReveal() {
      if (window.__pickrPageRevealed) return;
      if (window.__pickrOnboardingRedirect) return;
      window.__pickrPageRevealed = true;
      document.querySelectorAll('.pickr-page-content').forEach(function(el) {
        el.style.visibility = 'visible';
      });
      var pl = document.getElementById('pageLoader');
      if (pl) { pl.classList.add('loaded'); setTimeout(function(){ pl.remove(); }, 800); }
    }

    // If page resources are fully loaded, reveal immediately.
    // Otherwise defer until window 'load' fires (images, fonts, etc. all done).
    if (document.readyState === 'complete') {
      doReveal();
    } else {
      window.addEventListener('load', doReveal, { once: true });
    }
  }

  // Setup page interactions when DOM ready
  document.addEventListener('DOMContentLoaded', async () => {
    // Safety timeout — avoid flash while auth gate is pending, but never hang forever
    const gateStart = Date.now();
    const gateSafetyMs = 15000;
    const gatePoll = setInterval(() => {
      if (window.__pickrPageRevealed || window.__pickrOnboardingRedirect) {
        clearInterval(gatePoll);
        return;
      }
      if (!window.__pickrAuthGatePending || (Date.now() - gateStart) > gateSafetyMs) {
        clearInterval(gatePoll);
        revealPage();
      }
    }, 400);

    window.__pickrAuthGatePending = true;
    // Ensure we synchronise the authoritative profile first so token/cash
    // values are available to all pages (sports, wallet, picks).
    try { await syncUserProfile(); } catch (e) { console.warn('syncUserProfile failed on load', e); }
    window.__pickrAuthGatePending = false;
    refreshHeaders(); updateQuestTasks(userProfile); renderBetSlip(); setupConfirmBet(); setupBetSlipMobile();
    // ── Reveal page now that data is loaded ──
    revealPage();
    // ── Block letter keys (e/E/+/-) on number inputs ──
    document.addEventListener('keydown', function(e) {
      if (e.target.type === 'number' && ['e','E','+','-'].includes(e.key)) e.preventDefault();
    });
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

      // Enable only the soccer leagues that currently have games; disable the empty ones
      // so users never land on an empty league view.
      const refreshLeagueTabs = (soccerList) => {
        if (!leagueButtons.length) return;
        const list = Array.isArray(soccerList) ? soccerList : [];
        const leaguesWithGames = new Set(
          list.map((pick) => String(pick.league || '').toLowerCase()).filter(Boolean)
        );
        leagueButtons.forEach((btn) => {
          const lg = btn.dataset.league || 'all';
          const has = lg === 'all' ? list.length > 0 : leaguesWithGames.has(String(lg).toLowerCase());
          setTabState(btn, has);
        });
      };

      // Highlight and select the first league tab that has games (prefers "All leagues").
      const selectFirstAvailableLeague = () => {
        const firstAvailable = leagueButtons.find((b) => !b.classList.contains('is-disabled'));
        leagueButtons.forEach((b) => b.classList.remove('bg-red-600'));
        if (firstAvailable) {
          firstAvailable.classList.add('bg-red-600');
          selectedLeague = firstAvailable.dataset.league || 'all';
        } else {
          selectedLeague = 'all';
        }
        return firstAvailable;
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
            const soccerList = (data.picksBySport && data.picksBySport.soccer) || [];
            refreshLeagueTabs(soccerList);
            const list = applyLeagueFilter(soccerList);
            loadPicks(s, null, list);
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

      tabs.forEach(t => t.addEventListener('click', async () => {
        if (t.classList.contains('is-disabled')) return;
        tabs.forEach(x => x.classList.remove('bg-red-600'));
        t.classList.add('bg-red-600');
        const s = t.dataset.sport || 'all';
        if (soccerLeagueTabs) {
          soccerLeagueTabs.classList.toggle('hidden', s !== 'soccer');
        }
        if (s === 'soccer') {
          try {
            const { picksBySport } = await getAllPicksData();
            const soccerList = (picksBySport && picksBySport.soccer) || [];
            refreshLeagueTabs(soccerList);
            selectFirstAvailableLeague();
            const list = applyLeagueFilter(soccerList);
            loadPicks(s, null, list);
          } catch (err) {
            loadPicks(s);
          }
        } else {
          loadPicks(s);
        }
        try { localStorage.setItem('PICKR_LAST_PICKS_REFRESH', String(Date.now())); } catch (e) {}
      }));

      leagueButtons.forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (btn.classList.contains('is-disabled')) return;
          leagueButtons.forEach((b) => b.classList.remove('bg-red-600'));
          btn.classList.add('bg-red-600');
          selectedLeague = btn.dataset.league || 'all';
          try {
            const { picksBySport } = await getAllPicksData();
            const list = applyLeagueFilter((picksBySport && picksBySport.soccer) || []);
            loadPicks('soccer', null, list);
          } catch (err) {
            loadPicks('soccer');
          }
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
        }
        if (s === 'soccer') {
          try {
            const soccerList = (data.picksBySport && data.picksBySport.soccer) || [];
            refreshLeagueTabs(soccerList);
            selectFirstAvailableLeague();
            const list = applyLeagueFilter(soccerList);
            loadPicks(s, null, list);
          } catch (err) {
            loadPicks(s);
          }
        } else {
          loadPicks(s);
        }
        try { localStorage.setItem('PICKR_LAST_PICKS_REFRESH', String(Date.now())); } catch (e) {}
      })();

      setInterval(() => {
        refreshActivePicks();
      }, 2 * 60 * 1000);

      // Live ticker: every 3 seconds for real-time sports betting updates
      setInterval(async () => {
        const now = Date.now();

        // Handle betting cards that just started — disable their buttons
        document.querySelectorAll('article[data-game-start]:not([data-live])').forEach((card) => {
          const startMs = Number(card.getAttribute('data-game-start'));
          if (!Number.isFinite(startMs) || startMs > now) return;
          const btns = card.querySelectorAll('.select-team');
          if (!btns.length) return;
          let alreadyDisabled = true;
          btns.forEach((btn) => {
            if (!btn.disabled) { alreadyDisabled = false; btn.disabled = true; btn.classList.add('opacity-40', 'cursor-not-allowed'); btn.classList.remove('hover:bg-gray-600', 'bg-red-600', 'text-white'); }
          });
          if (!alreadyDisabled && !card.querySelector('.game-started-banner')) {
            const banner = document.createElement('div');
            banner.className = 'game-started-banner mt-2 text-center text-xs font-bold uppercase tracking-widest text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg py-2';
            banner.textContent = '\u26A0 Game started \u2014 betting closed';
            const btnsContainer = card.querySelector('.grid');
            if (btnsContainer) btnsContainer.parentNode.insertBefore(banner, btnsContainer);
          }
          const matchId = card.getAttribute('data-match-id');
          if (matchId && betSlip[matchId]) { delete betSlip[matchId]; renderBetSlip(); }
        });

        // Update live score cards with fresh data
        const liveCards = document.querySelectorAll('article[data-live="true"]');
        if (!liveCards.length) return;
        try {
          const activeSport = (function() { const t = document.querySelector('#sportTabs .sport-tab.bg-red-600'); return t ? (t.dataset.sport || 'nba') : 'nba'; })();
          const games = await fetchLiveScoresForPicks(activeSport);
          liveCards.forEach((card) => {
            const espnId = card.getAttribute('data-espn-id');
            if (!espnId) return;
            const game = games.find(g => g.id === espnId);
            if (!game) return;

            // Update scores
            const awayEl = card.querySelector('[data-score-side="away"]');
            const homeEl = card.querySelector('[data-score-side="home"]');
            if (awayEl) awayEl.textContent = game.awayTeam.score;
            if (homeEl) homeEl.textContent = game.homeTeam.score;

            // Update clock/status
            const clockEl = card.querySelector('[data-live-clock]');
            if (clockEl && game.status) {
              clockEl.textContent = game.status.shortDetail || game.status.detail || '';
            }

            // Update "last updated" freshness indicator
            const updEl = card.querySelector('[data-live-updated]');
            if (updEl) {
              const t = new Date();
              updEl.textContent = 'Updated ' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            }

            const statusEl = card.querySelector('[data-live-status]');
            if (statusEl && game.status) {
              if (game.status.state === 'post') {
                statusEl.innerHTML = '<span class="text-xs font-bold uppercase tracking-widest text-slate-400">FINAL</span>';
                if (clockEl) clockEl.textContent = '';
                if (!_gameEndTimes[game.id]) _gameEndTimes[game.id] = now;
                card.style.borderLeftColor = '';
                card.style.borderLeftWidth = '';
              }
            }

            // Update series badge
            const seriesBadgeEl = card.querySelector('[data-series-badge]');
            if (seriesBadgeEl) {
              let updatedSeriesText = '';
              if (game.notes && game.notes.length > 0) updatedSeriesText = game.notes[0];
              if (!updatedSeriesText && game.series) {
                const sr = game.series;
                if (sr.summary) updatedSeriesText = sr.summary;
                else if (sr.homeWins != null && sr.awayWins != null) {
                  const hw = sr.homeWins, aw = sr.awayWins;
                  const homeName = game.homeTeam ? (game.homeTeam.abbreviation || game.homeTeam.name || '') : '';
                  const awayName = game.awayTeam ? (game.awayTeam.abbreviation || game.awayTeam.name || '') : '';
                  if (hw === aw) updatedSeriesText = 'Series tied ' + hw + '-' + aw;
                  else if (hw > aw) updatedSeriesText = homeName + ' lead ' + hw + '-' + aw;
                  else updatedSeriesText = awayName + ' lead ' + aw + '-' + hw;
                } else if (sr.title) updatedSeriesText = sr.title;
              }
              if (updatedSeriesText) {
                seriesBadgeEl.style.display = 'flex';
                const textEl = seriesBadgeEl.querySelector('span:last-child');
                if (textEl) textEl.textContent = updatedSeriesText;
              }
            }

            // Update MLB next-up batters
            const battersEl = card.querySelector('[data-mlb-batters]');
            if (game.situation && (game.situation.batter || game.situation.onDeck || game.situation.inHole)) {
              const sit = game.situation;
              const renderBatterRowTicker = (player, label, labelColor) => {
                if (!player) return '';
                const n = escapeHtml(player.displayName || '');
                const j = player.jersey ? ' <span style="color:#64748b;font-size:10px">#' + escapeHtml(player.jersey) + '</span>' : '';
                const sm = player.summary ? '<div style="font-size:10px;color:#64748b;margin-top:1px">' + escapeHtml(player.summary) + '</div>' : '';
                const hs = player.headshot
                  ? '<img src="' + escapeHtml(player.headshot) + '" alt="" style="width:28px;height:28px;border-radius:50%;object-fit:cover;background:#334155;flex-shrink:0">'
                  : '<div style="width:28px;height:28px;border-radius:50%;background:#334155;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px">\u26be</div>';
                return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">' + hs +
                  '<div style="flex:1;min-width:0">' +
                    '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:' + labelColor + ';font-weight:700">' + label + '</div>' +
                    '<div style="font-size:12px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + n + j + '</div>' +
                    sm +
                  '</div></div>';
              };
              let bHtml = '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;font-weight:600;margin-bottom:8px">\u26be Next Up</div>';
              bHtml += renderBatterRowTicker(sit.batter, 'At Bat', '#34d399');
              bHtml += renderBatterRowTicker(sit.onDeck, 'On Deck', '#fbbf24');
              bHtml += renderBatterRowTicker(sit.inHole, 'In the Hole', '#94a3b8');
              if (sit.onFirst || sit.onSecond || sit.onThird || sit.outs != null) {
                bHtml += '<div style="display:flex;align-items:center;gap:12px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.05)">';
                bHtml += '<div style="position:relative;width:28px;height:28px">';
                bHtml += '<div style="position:absolute;width:8px;height:8px;transform:rotate(45deg);top:2px;left:10px;border:1px solid ' + (sit.onSecond ? '#fbbf24' : '#475569') + ';background:' + (sit.onSecond ? '#fbbf24' : 'transparent') + ';border-radius:1px"></div>';
                bHtml += '<div style="position:absolute;width:8px;height:8px;transform:rotate(45deg);top:10px;left:2px;border:1px solid ' + (sit.onThird ? '#fbbf24' : '#475569') + ';background:' + (sit.onThird ? '#fbbf24' : 'transparent') + ';border-radius:1px"></div>';
                bHtml += '<div style="position:absolute;width:8px;height:8px;transform:rotate(45deg);top:10px;left:18px;border:1px solid ' + (sit.onFirst ? '#fbbf24' : '#475569') + ';background:' + (sit.onFirst ? '#fbbf24' : 'transparent') + ';border-radius:1px"></div>';
                bHtml += '</div>';
                if (sit.outs != null) {
                  let outsH = '<div style="display:flex;align-items:center;gap:3px"><span style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-right:3px">Outs</span>';
                  for (let oi = 0; oi < 3; oi++) outsH += '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;' + (oi < sit.outs ? 'background:#f97316;border:1px solid transparent' : 'border:1px solid #475569;background:transparent') + '"></span>';
                  outsH += '</div>';
                  bHtml += outsH;
                }
                bHtml += '</div>';
              }
              if (battersEl) {
                battersEl.innerHTML = bHtml;
              } else {
                // First time adding batters to this card
                const wrapper = document.createElement('div');
                wrapper.setAttribute('data-mlb-batters', '');
                wrapper.style.cssText = 'margin-top:10px;padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06)';
                wrapper.innerHTML = bHtml;
                card.appendChild(wrapper);
              }
            } else if (battersEl) {
              battersEl.remove(); // No situation data anymore (e.g. between innings)
            }

            // Remove cards for games that ended > 1 hour ago
            if (game.status && game.status.state === 'post' && _gameEndTimes[game.id]) {
              if (now - _gameEndTimes[game.id] > 60 * 60 * 1000) {
                card.remove();
              }
            }
          });
        } catch (e) {
          console.warn('Live ticker update failed:', e);
        }
      }, 3 * 1000);
    }

    // Live Scores modal removed — scores now show inline on pick cards

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