const request = require('supertest');
jest.mock('firebase-admin', () => {
  const auth = { verifyIdToken: jest.fn() };
  const Timestamp = { now: () => ({ _test: Date.now() }) };
  const data = {};
  const firestore = () => ({
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({ exists: !!data[id], data: () => data[id] }),
        set: async (d, opts) => { data[id] = Object.assign({}, data[id] || {}, d); },
        update: async (d) => { data[id] = Object.assign({}, data[id] || {}, d); }
      }),
      where: () => ({ get: async () => ({ empty: true, forEach: () => {} }) })
    }),
  });
  return { auth: () => auth, auth: auth, firestore: firestore, initializeApp: jest.fn(), credential: { applicationDefault: jest.fn() }, firestoreTimestamp: Timestamp };
});

const admin = require('firebase-admin');
const server = require('../../server');

describe('Auth onboarding flow', () => {
  beforeAll(() => {
    admin.auth().verifyIdToken.mockImplementation(async (token) => {
      if (token === 'valid-token') return { uid: 'user123', email: 'u@example.com', name: 'User' };
      throw new Error('invalid');
    });
  });

  test('POST /api/auth/google creates user and indicates onboarding required', async () => {
    const res = await request(server).post('/api/auth/google').send({ idToken: 'valid-token' }).expect(200);
    expect(res.body.onboardingRequired).toBeDefined();
  });
});
