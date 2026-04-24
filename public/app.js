// public/app.js - Clean consolidated client script for Pickr
// Provides header refresh, picks loader (with recommendation), bet slip, bet history and wallet helpers.

/* Helper: safe parse JSON from localStorage */
const readJSON = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k) || 'null') || fallback; } catch (e) { return fallback; }
};

document.addEventListener('DOMContentLoaded', () => {
  // Ensure defaults
  // NOTE: tokens/cash/xp are now authoritative on the server and exposed
  // on the client via `window.userProfile` (populated by `/api/me`). Keep
  // localStorage only as a fallback for unauthenticated/demo flows. Do
  // NOT write authoritative balances into localStorage.

  function refreshHeaders() {
    // Prefer server-provided in-memory profile when available
    const up = window.userProfile || {};
  const tokens = (typeof up.tokens !== 'undefined') ? String(up.tokens) : (localStorage.getItem('tokens') || '0');
  const cash = (typeof up.cash !== 'undefined')
    ? Number(up.cash).toFixed(2)
    : (typeof up.cashBalance !== 'undefined')
      ? Number(up.cashBalance).toFixed(2)
      : parseFloat(localStorage.getItem('cash') || '0').toFixed(2);
  const xp = (typeof up.xp !== 'undefined') ? String(up.xp) : (localStorage.getItem('xp') || '0');
    document.querySelectorAll('.tokens').forEach(el => el.textContent = tokens);
    document.querySelectorAll('.cash').forEach(el => el.textContent = `$${cash}`);
    document.querySelectorAll('.xp').forEach(el => el.textContent = xp);
    const xpEl = document.getElementById('xp'); if (xpEl) xpEl.textContent = xp;
    // Also update header ids for pages that use explicit header spans
    const headerTokensEl = document.getElementById('headerTokens'); if (headerTokensEl) headerTokensEl.textContent = tokens;
    const headerCashEl = document.getElementById('headerCash'); if (headerCashEl) headerCashEl.textContent = `$${cash}`;
  }
  // Listen for cross-module balance updates so this script can refresh
  // the header whenever balances change elsewhere in the app.
  try {
    window.addEventListener('pickr:balances-updated', (e) => {
      try { refreshHeaders(); } catch (err) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
  refreshHeaders();

  // Bet slip
  const betSlip = {};
  const betSlipList = document.getElementById('betSlipList');
  const confirmBetBtn = document.getElementById('confirmBet');

  function renderBetSlip() {
    if (!betSlipList || !confirmBetBtn) return;
    betSlipList.innerHTML = '';
    const entries = Object.entries(betSlip);
    entries.forEach(([matchId, details]) => {
      const li = document.createElement('li');
      li.className = 'flex flex-col border p-3 rounded bg-gray-50 text-gray-900';
      li.innerHTML = `\n        <div class="flex justify-between items-center mb-2">\n          <span class="font-semibold">${details.team}</span>\n          <button data-match="${matchId}" class="remove-slip text-red-600 text-sm">Remove</button>\n        </div>\n        <div class="flex items-center space-x-2">\n          <label class="text-sm">Stake:</label>\n          <input type="number" min="0" step="0.01" class="stake-input border rounded p-1 flex-1" data-match="${matchId}" value="${details.stake || ''}" />\n        </div>`;
      betSlipList.appendChild(li);
    });
    if (entries.length > 0) confirmBetBtn.classList.remove('hidden'); else confirmBetBtn.classList.add('hidden');

    betSlipList.querySelectorAll('.remove-slip').forEach(btn => btn.addEventListener('click', () => {
      const m = btn.getAttribute('data-match'); delete betSlip[m];
      document.querySelectorAll(`.select-team[data-match="${m}"]`).forEach(s => { s.classList.remove('bg-red-600', 'text-white', 'opacity-50'); s.disabled = false; });
      renderBetSlip();
    }));

    betSlipList.querySelectorAll('.stake-input').forEach(input => input.addEventListener('input', () => {
      const m = input.getAttribute('data-match'); const v = parseFloat(input.value); betSlip[m].stake = isNaN(v) ? 0 : v;
    }));
  }

  function bindPickButtonHandlers() {
    document.querySelectorAll('.select-team').forEach(btn => {
      if (btn.dataset.bound) return; btn.dataset.bound = 'true';
      btn.addEventListener('click', () => {
        const matchId = btn.getAttribute('data-match');
        const team = btn.getAttribute('data-team');
        betSlip[matchId] = { team, stake: betSlip[matchId] ? betSlip[matchId].stake : 0 };
        const siblings = document.querySelectorAll(`.select-team[data-match="${matchId}"]`);
        siblings.forEach(s => { s.classList.remove('bg-red-600', 'text-white', 'opacity-50'); s.disabled = false; });
        btn.classList.add('bg-red-600', 'text-white');
        siblings.forEach(s => { if (s.getAttribute('data-team') !== team) { s.disabled = true; s.classList.add('opacity-50'); } });
        renderBetSlip();
      });
    });
  }

  if (confirmBetBtn) {
    confirmBetBtn.addEventListener('click', () => {
      const entries = Object.entries(betSlip); if (entries.length === 0) return;
  // Use server-authoritative in-memory profile when present
  const up = window.userProfile || {};
  let currentCash = (typeof up.cash !== 'undefined')
    ? Number(up.cash)
    : (typeof up.cashBalance !== 'undefined')
      ? Number(up.cashBalance)
      : parseFloat(localStorage.getItem('cash') || '0');
      let totalStake = 0; for (const [, { stake }] of entries) { if (!stake || stake <= 0) { alert('Please enter a stake for each selection.'); return; } totalStake += stake; }
      if (totalStake > currentCash) { alert('Insufficient cash to place these bets. Please deposit more funds.'); return; }
  const history = readJSON('betHistory', []);
  entries.forEach(([matchId, { team, stake }]) => { history.unshift({ matchId, team, stake, date: Date.now() }); currentCash -= stake; });
  // Keep bet history in localStorage (UI-only). Do NOT persist authoritative
  // balance changes locally; instead update in-memory view so the header
  // reflects the expected value. Server will be authoritative for tokens/cash.
  localStorage.setItem('betHistory', JSON.stringify(history));
  updateBalances(undefined, currentCash);
      Object.keys(betSlip).forEach(m => delete betSlip[m]);
      document.querySelectorAll('.select-team').forEach(btn => { btn.classList.remove('bg-red-600', 'text-white', 'opacity-50'); btn.disabled = false; });
      renderBetSlip();
      alert('Bet placed! Check the My Bets tab to view your wager history.');
    });
  }

  // Picks: tabs and loader
  let selectedSport = 'nba';
  const sportTabs = document.querySelectorAll('.sport-tab') || [];
  sportTabs.forEach(tab => tab.addEventListener('click', () => { selectedSport = tab.dataset.sport; sportTabs.forEach(t => { t.classList.remove('bg-red-600'); t.classList.add('bg-gray-800'); }); tab.classList.remove('bg-gray-800'); tab.classList.add('bg-red-600'); loadPicks(selectedSport); }));

  async function loadPicks(sport = selectedSport) {
    const picksContainer = document.getElementById('picksContainer'); if (!picksContainer) return;
    try {
      // Support a debug mode so the UI can be tested without Firebase auth or emulator.
      // If the URL contains `?debug=1` we will fetch the unauthenticated debug picks.
      const params = new URLSearchParams(window.location.search);
      const debugMode = params.get('debug') === '1';
      const endpoint = debugMode ? `/api/debug/fillerPicks?sport=${sport}` : `/api/picks?sport=${sport}`;
      const apiBase = (window.PICKR_CONFIG && window.PICKR_CONFIG.API_BASE_URL) || '';
      const res = await fetch(apiBase + endpoint);
      const events = await res.json();
      // Clear and prepare for batched rendering. We store events in a
      // module-scoped variable so the "Load more" button can render
      // additional batches without refetching.
      picksContainer.innerHTML = '';
      window._picksEvents = Array.isArray(events) ? events : (events && Array.isArray(events.picks) ? events.picks : []);
      window._picksIndex = 0;
      const PICKS_BATCH = 20; // number of picks to render per batch

      // Remove any previous load-more button
      const existingBtn = document.getElementById('loadMorePicks'); if (existingBtn) existingBtn.remove();

      function renderNextBatch() {
        const start = window._picksIndex;
        const slice = window._picksEvents.slice(start, start + PICKS_BATCH);
        slice.forEach(ev => renderPickCard(ev, picksContainer));
        window._picksIndex += slice.length;
        bindPickButtonHandlers();
        // If more remain, ensure load more button exists
        let btn = document.getElementById('loadMorePicks');
        if (window._picksIndex < window._picksEvents.length) {
          if (!btn) {
            btn = document.createElement('button');
            btn.id = 'loadMorePicks';
            btn.className = 'w-full py-2 px-4 bg-gray-700 text-sm text-white rounded hover:bg-gray-600';
            btn.textContent = 'Load more picks';
            btn.addEventListener('click', () => { renderNextBatch(); if (window._picksIndex >= window._picksEvents.length) btn.remove(); });
            picksContainer.appendChild(btn);
          }
        } else if (btn) {
          btn.remove();
        }
      }

      // Render helper separated so it can be called for each pick
      function renderPickCard(ev, container) {
        const getLogo = name => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D8ABC&color=ffffff&size=64`;
        const homeTeam = ev.home_team || ev.team1; const awayTeam = ev.away_team || ev.team2;
        const start = new Date(ev.commence_time || ev.startTime);
        const card = document.createElement('div'); card.className = 'bg-gray-800 rounded-lg p-4 mb-4 shadow-md text-gray-100';

        // header
        const header = document.createElement('div'); header.className = 'flex justify-between items-center mb-2';
        const homeDiv = document.createElement('div'); homeDiv.className = 'flex items-center space-x-2';
        const hImg = document.createElement('img'); hImg.src = getLogo(homeTeam); hImg.className = 'w-8 h-8 rounded-full'; homeDiv.appendChild(hImg);
        const hName = document.createElement('span'); hName.className = 'font-semibold'; hName.textContent = homeTeam; homeDiv.appendChild(hName);
        const vs = document.createElement('span'); vs.textContent = 'vs'; vs.className = 'mx-2 text-gray-400';
        const awayDiv = document.createElement('div'); awayDiv.className = 'flex items-center space-x-2';
        const aImg = document.createElement('img'); aImg.src = getLogo(awayTeam); aImg.className = 'w-8 h-8 rounded-full'; awayDiv.appendChild(aImg);
        const aName = document.createElement('span'); aName.className = 'font-semibold'; aName.textContent = awayTeam; awayDiv.appendChild(aName);
        header.appendChild(homeDiv); header.appendChild(vs); header.appendChild(awayDiv); card.appendChild(header);
        const timeEl = document.createElement('p'); timeEl.className = 'text-xs text-gray-400 mb-3'; timeEl.textContent = `Starts ${start.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`; card.appendChild(timeEl);

        // odds -> recommendation
        const homeOdds = ev.displayOdds && ev.displayOdds.home ? parseFloat(ev.displayOdds.home) : null;
        const drawOdds = ev.displayOdds && ev.displayOdds.draw ? parseFloat(ev.displayOdds.draw) : null;
        const awayOdds = ev.displayOdds && ev.displayOdds.away ? parseFloat(ev.displayOdds.away) : null;
        const options = [];
        if (homeOdds) options.push({ team: homeTeam, odds: homeOdds });
        if (drawOdds) options.push({ team: 'Draw', odds: drawOdds });
        if (awayOdds) options.push({ team: awayTeam, odds: awayOdds });
        let recommended = null;
        if (options.length > 0) {
          const inv = options.map(o => ({ ...o, imp: 1 / o.odds }));
          const sumImp = inv.reduce((s, x) => s + x.imp, 0);
          inv.forEach(x => x.prob = x.imp / sumImp);
          inv.sort((a, b) => b.prob - a.prob);
          recommended = inv[0];
        }

        const btnContainer = document.createElement('div');
        const makeBtn = (team, odds) => {
          const b = document.createElement('button');
          b.className = 'select-team flex-1 py-2 px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm mb-2';
          b.setAttribute('data-match', ev.id);
          b.setAttribute('data-team', team);
          b.innerHTML = `<div class="flex flex-col items-center"><span>${team}</span><span class="text-xs text-gray-400">${odds ? `${odds}x` : ''}</span></div>`;
          if (recommended && recommended.team === team) b.classList.add('ring-2', 'ring-green-400');
          return b;
        };

        btnContainer.className = drawOdds ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2';
        btnContainer.appendChild(makeBtn(homeTeam, homeOdds));
        if (drawOdds) btnContainer.appendChild(makeBtn('Draw', drawOdds));
        btnContainer.appendChild(makeBtn(awayTeam, awayOdds));
        card.appendChild(btnContainer);

        if (recommended) {
          const recBar = document.createElement('div');
          recBar.className = 'mt-3 flex items-center justify-between bg-gray-900/50 p-2 rounded';
          const teamLabel = document.createElement('div'); teamLabel.className = 'text-sm text-gray-200';
          const conf = Math.round(recommended.prob * 100);
          teamLabel.innerHTML = `Pickr recommends: <span class="font-semibold">${recommended.team}</span> <span class="text-xs text-gray-400">(${conf}% confidence)</span>`;
          const recBtn = document.createElement('button'); recBtn.className = 'py-1 px-3 bg-green-500 text-white rounded text-sm hover:bg-green-600'; recBtn.textContent = 'Bet Recommended';
          recBtn.addEventListener('click', () => { const selector = `.select-team[data-match="${ev.id}"][data-team="${recommended.team}"]`; const target = document.querySelector(selector); if (target) target.click(); });
          recBar.appendChild(teamLabel); recBar.appendChild(recBtn); card.appendChild(recBar);
        }

        picksContainer.appendChild(card);
      }

      // Initial render
      renderNextBatch();
      return;
    } catch (err) { console.error('Error loading picks:', err); }
  }

  loadPicks(selectedSport);

  // Bet history (picks.html)
  const betHistoryContainer = document.getElementById('betHistoryContainer');
  if (betHistoryContainer) {
    const history = readJSON('betHistory', []);
    if (history.length === 0) betHistoryContainer.innerHTML = '<p class="text-gray-600">No bets placed yet.</p>';
    else history.forEach(item => {
      const div = document.createElement('div');
      div.className = 'bg-white rounded shadow p-4 flex justify-between items-center';
      const stake = parseFloat(item.stake || item.amount || 0).toFixed(2);
      const date = new Date(item.date).toLocaleString();
      div.innerHTML = `<div><strong>${item.team || item.description || 'Bet'}</strong> &ndash; $${stake}</div><div class="text-gray-500 text-sm">${date}</div>`;
      betHistoryContainer.appendChild(div);
    });
  }

  // Wallet init: if on wallet page, call loader once
  if (document.getElementById('walletTokens')) { setTimeout(() => { if (typeof loadWalletPage === 'function') loadWalletPage(); }, 0); }

});

/* Balance helpers used by wallet page or other modules */
function updateBalances(tokens, cash) {
  // Delegate to the canonical implementation exported by script.js. If it's
  // not available, fall back to a local UI-only refresh (should be rare).
  if (typeof window.updateBalances === 'function') {
    // call the canonical implementation and then refresh headers so every
    // page reflects the new balances immediately.
    try { window.updateBalances(tokens, cash); } catch (e) { /* ignore */ }
    try { refreshHeaders(); } catch (e) { /* ignore */ }
    return;
  }
  const up = window.userProfile || null;
  if (up) {
    if (typeof tokens !== 'undefined') up.tokens = Number(tokens);
    if (typeof cash !== 'undefined') up.cash = Number(cash);
  }
  document.querySelectorAll('.tokens').forEach(el => el.textContent = (up && typeof up.tokens !== 'undefined') ? String(up.tokens) : (localStorage.getItem('tokens') || '0'));
  document.querySelectorAll('.cash').forEach(el => el.textContent = `$${((up && typeof up.cash !== 'undefined') ? Number(up.cash) : parseFloat(localStorage.getItem('cash') || '0')).toFixed(2)}`);
  const walletTokensEl = document.getElementById('walletTokens');
  const walletCashEl = document.getElementById('walletCash');
  if (walletTokensEl) walletTokensEl.textContent = (up && typeof up.tokens !== 'undefined') ? String(up.tokens) : (localStorage.getItem('tokens') || '0');
  if (walletCashEl) walletCashEl.textContent = ((up && typeof up.cash !== 'undefined') ? Number(up.cash) : parseFloat(localStorage.getItem('cash') || '0')).toFixed(2);
}

function loadWalletPage() {
  const up = window.userProfile || {};
  const tokens = (typeof up.tokens !== 'undefined') ? parseInt(String(up.tokens), 10) : parseInt(localStorage.getItem('tokens') || '0', 10);
  const cash = (typeof up.cash !== 'undefined') ? Number(up.cash) : parseFloat(localStorage.getItem('cash') || '0');
  const walletTokensEl = document.getElementById('walletTokens');
  const walletCashEl = document.getElementById('walletCash');
  if (walletTokensEl) walletTokensEl.textContent = tokens;
  if (walletCashEl) walletCashEl.textContent = cash.toFixed(2);
  const historyContainer = document.getElementById('betHistory');
  if (historyContainer) {
    historyContainer.innerHTML = '';
    const history = readJSON('betHistory', []);
    if (history.length === 0) historyContainer.innerHTML = '<p class="text-gray-500">No bets placed yet.</p>';
    else history.forEach(item => {
      const div = document.createElement('div');
      div.className = 'py-2 flex justify-between items-start';
      div.innerHTML = `<div><strong>$${Number(item.amount || item.stake || 0).toFixed(2)}</strong>` + (item.description ? ` &ndash; ${item.description}` : '') + `</div><div class="text-gray-400 text-xs">${new Date(item.date).toLocaleString()}</div>`;
      historyContainer.appendChild(div);
    });
  }
}
