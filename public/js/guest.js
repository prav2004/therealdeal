/**
 * guest.js — Pickr guest / live-viewer mode helper
 * For unauthenticated visitors, replaces the .banner-right (player name +
 * tokens + cash) in the top header with a "Create Free Account" button.
 * On pages without that header, shows a small fixed top-right button instead.
 */
(function () {
  var applied = false;

  var BTN_STYLE =
    'background:linear-gradient(135deg,#ff8a1c,#f0c842);color:#0b0f1a;' +
    'padding:7px 16px;border-radius:999px;font-weight:700;text-decoration:none;' +
    'font-size:.82rem;letter-spacing:.01em;white-space:nowrap;' +
    'font-family:"IBM Plex Sans",sans-serif;display:inline-block;';

  function injectGuest() {
    if (applied) return;
    applied = true;

    // ── Preferred: replace the .banner-right in the top header ──
    var bannerRight = document.querySelector('.banner-right');
    if (bannerRight) {
      bannerRight.innerHTML =
        '<a href="/login.html" id="guestHeaderBtn" style="' + BTN_STYLE + '">' +
          'Create Free Account &rarr;' +
        '</a>';
      return;
    }

    // ── Fallback: fixed top-right button (pages without top-banner) ──
    if (document.getElementById('guestHeaderBtn')) return;
    var btn = document.createElement('a');
    btn.id = 'guestHeaderBtn';
    btn.href = '/login.html';
    btn.textContent = 'Create Free Account →';
    btn.style.cssText =
      BTN_STYLE +
      'position:fixed;top:max(14px,calc(14px + env(safe-area-inset-top)));' +
      'right:14px;z-index:99999;' +
      'box-shadow:0 2px 16px rgba(0,0,0,.45);';
    document.body.appendChild(btn);
  }

  function removeGuest() {
    var btn = document.getElementById('guestHeaderBtn');
    if (btn) btn.remove();
    applied = false;
  }

  function handleAuthState(user) {
    if (!user) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectGuest);
      } else {
        injectGuest();
      }
    } else {
      removeGuest();
    }
  }

  // Attach Firebase auth listener — retry until Firebase SDK is ready
  function attachAuthListener() {
    if (window.firebase && firebase.auth) {
      firebase.auth().onAuthStateChanged(handleAuthState);
    } else {
      setTimeout(attachAuthListener, 200);
    }
  }

  attachAuthListener();
})();
