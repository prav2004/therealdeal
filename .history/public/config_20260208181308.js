// Backend API configuration
// In production (Netlify), use Cloud Run backend
// In local dev, use localhost
window.PICKR_CONFIG = {
  API_BASE_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? '' // Use relative URLs for local dev
    : 'https://pickr-backend-972106331799.us-central1.run.app' // Cloud Run backend
};
