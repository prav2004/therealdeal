// Simple helper to seed a user into the Firestore emulator for local testing.
// Usage: node tools/seedUser.js <uid>
const admin = require('firebase-admin');

const uid = process.argv[2] || 'test-user-123';
// Ensure emulator host set for local testing
if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8085';

// Initialize admin (match server.js behavior for local dev)
try {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'local-project' });
} catch (e) {
  // if already initialized, ignore
}
const firestore = admin.firestore();

(async function seed(){
  const userRef = firestore.collection('users').doc(uid);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const doc = {
    uid,
    email: `${uid}@example.com`,
    fullName: 'Seeded Test User',
    dob: '1990-01-01',
    ageVerified: true,
    createdAt: now,
    lastLogin: now,
    tokenBalance: 2500,
    cash: 50.00,
    xp: 0,
    stats: { wins: 1, losses: 2, pending: 0, totalBets: 3 }
  };
  try {
    await userRef.set(doc);
    console.log('Seeded user', uid);
    process.exit(0);
  } catch (err) {
    console.error('Failed to seed user:', err);
    process.exit(1);
  }
})();
