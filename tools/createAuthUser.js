// Create an Auth emulator user + Firestore profile for local testing.
// Usage: node tools/createAuthUser.js <email> <password> [uid]
const admin = require('firebase-admin');

const email = process.argv[2] || 'dev@example.com';
const password = process.argv[3] || 'password123';
const uid = process.argv[4] || email.split('@')[0];

if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8085';
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

try {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'local-project' });
} catch (e) {}

async function run(){
  try {
    // Create auth user (will go to emulator if FIREBASE_AUTH_EMULATOR_HOST is set)
    let user;
    try {
      user = await admin.auth().getUser(uid);
      console.log('Auth user already exists:', uid);
    } catch (e) {
      user = await admin.auth().createUser({ uid, email, password });
      console.log('Created auth user:', user.uid);
    }

    // Ensure Firestore profile exists
    const firestore = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    await firestore.collection('users').doc(uid).set({
      uid,
      email,
      fullName: 'Dev User',
      dateOfBirth: '1990-01-01',
      profileComplete: true,
      tokenBalance: 1000,
      createdAt: now,
      lastLogin: now
    }, { merge: true });
    console.log('Seeded Firestore profile for', uid);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create auth user:', err && err.message);
    process.exit(1);
  }
}

run();
