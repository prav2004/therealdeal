// Backend API configuration
// In production (Netlify), use Cloud Run backend
// In local dev, use localhost
window.PICKR_CONFIG = {
  API_BASE_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? '' // Use relative URLs for local dev
    : 'https://pickr-backend-972106331799.us-central1.run.app', // Cloud Run backend

  // Perks are the only regional experience. Replace the two empty values below
  // with the destination URLs when the Rest of Canada and UK perks pages are ready.
  REGION_PERKS_URLS: {
    ontario: 'tasks.html',
    canada: '',
    uk: ''
  }
};
