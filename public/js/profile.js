// public/js/profile.js
// Firebase COMPAT SDKs (do NOT mix with modular)
if (window.location && /\/profile\.html$/.test(window.location.pathname)) {
  window.location.replace('/onboarding.html');
}
import "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js";
import "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js";
import "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js";

const firebaseConfig = {
  apiKey: "AIzaSyBoQ1myN6q1HeQQaT8RkH7lRBIKtHUQOdM",
  authDomain: "pickr-d4d9b.firebaseapp.com",
  projectId: "pickr-d4d9b"
};

// Prevent double initialization
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
// Emulator opt-in: only point the client to the Auth emulator when
// explicitly requested (via ?emulator=1 or localStorage USE_FIREBASE_EMULATOR)
// to avoid sign-in state mismatches between pages during local dev.
  try {
    const params = new URLSearchParams(window.location.search);
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const useEmu = isLocalhost && (params.get('emulator') === '1' || localStorage.getItem('USE_FIREBASE_EMULATOR') === '1');
    if (useEmu) {
    auth.useEmulator && auth.useEmulator('http://localhost:9099/');
    console.log('Auth client configured to use Auth emulator at http://localhost:9099');
  }
} catch (e) {
  console.warn('Failed to configure Auth emulator on client:', e && e.message);
}
const db = firebase.firestore();

// Protect page and handle form submission.
// Instead of writing directly to client Firestore, POST the profile to
// the server API so all data flows through the same backend (emulator
// or production) and we avoid inconsistent DB usage.
auth.onAuthStateChanged((user) => {
  const form = document.getElementById("profileForm");
  if (!form) {
    console.error("Profile form not found");
    return;
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("fullName").value.trim();
    const dob = document.getElementById("dob").value;
    if (!name || !dob) {
      alert("Please fill out all fields.");
      return;
    }
    const birthDate = new Date(dob);
    const age = Math.floor((Date.now() - birthDate) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 19) {
      alert("You must be 19 or older to use Pickr.");
      if (user) await auth.signOut();
      window.location.href = "/login";
      return;
    }

    // Build payload
    const payload = { fullName: name, dob, age };

    try {
      // If a user is signed in, get the ID token and send it; otherwise
      // allow dev-mode header if DEV_AUTH_UID is present in localStorage.
      const headers = { 'Content-Type': 'application/json' };
      if (user) {
        const idToken = await user.getIdToken();
        headers.Authorization = 'Bearer ' + idToken;
      } else {
        const devUid = localStorage.getItem('DEV_AUTH_UID') || (['localhost','127.0.0.1'].includes(window.location.hostname) ? 'test-user-123' : null);
        if (!devUid) { alert('Please sign in to complete your profile.'); return; }
        headers['x-dev-uid'] = devUid;
      }

      const apiBase = (window.PICKR_CONFIG && window.PICKR_CONFIG.API_BASE_URL) || '';
      const resp = await fetch(apiBase + '/api/profile', { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!resp.ok) {
        const err = await resp.json().catch(()=>({ error: 'failed' }));
        alert('Failed to save profile: ' + (err.error || err.message || 'unknown'));
        return;
      }
      // Redirect to sports page on success
      window.location.href = "/index.html";
    } catch (err) {
      console.error('Profile save failed', err);
      alert('Failed to save profile. Try again later.');
    }
  });
});
