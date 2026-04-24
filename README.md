# Pickr — local dev & tests

Quick notes to run the project locally and execute tests that rely on the Firestore emulator.

Prerequisites
- Node.js (16+)
- npm
- Firebase CLI (for running the Firestore emulator): `npm install -g firebase-tools`

Using the Firestore emulator (recommended for tests)
1. Start the emulator in a separate terminal (PowerShell or cmd):

```powershell
# from repo root
firebase emulators:start --only firestore
```

By default the emulator listens on localhost:8080. The test harness expects the emulator at that address unless you set `FIRESTORE_EMULATOR_HOST`.

2. In another terminal, run the Jest tests (Windows):

```cmd
set FIRESTORE_EMULATOR_HOST=localhost:8080 && npm test
```

Or using the helper script in package.json:

```cmd
npm run test:emulator
```

Notes about Firebase credentials & running the server
- The server initializes the Admin SDK using Application Default Credentials:
  - If you want the server to connect to a real Firestore (production/test) you must set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to point to a service account JSON file.
  - Example (Windows cmd):

```cmd
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
npm start
```

- For local development with the Firestore emulator you do NOT need real credentials; the emulator responds to Admin SDK calls when `FIRESTORE_EMULATOR_HOST` is set. Start the emulator first, then run the server.

Testing tips
- The repository contains `server/tests/firestore_bets.test.js` which exercises `server/firestore_bets.js`. Those tests require the emulator and will fail or time out if it's not running.
- If you see errors about the emulator not reachable, ensure no firewall blocks localhost:8080 and that the emulator started successfully.

If you'd like, I can:
- Add a `firebase.json` with a recommended emulator config.
- Add cross-platform `test:emulator` (requires adding `cross-env` to devDependencies) so tests run the same on macOS/Linux and Windows.

---

Run the app locally with the Firestore emulator (step-by-step)

1) Install the Firebase CLI (if not already installed):

```powershell
npm install -g firebase-tools
```

2) From the repo root, start the Firestore emulator (opens a UI at http://localhost:4000):

```cmd
npx firebase emulators:start --only firestore
```

3) In a separate terminal, start the server with the emulator env var set (Windows cmd):

```cmd
set FIRESTORE_EMULATOR_HOST=localhost:8080 && npm run start:dev
```

Or in PowerShell:

```powershell
$env:FIRESTORE_EMULATOR_HOST='localhost:8080'
npm run start:dev
```

4) Quick developer auth for UI testing

The server supports a safe dev auth bypass (only when NODE_ENV !== 'production') so you can test authenticated routes without configuring Google credentials or the Auth emulator.

Set an env var `DEV_AUTH_UID` before starting the server or send `x-dev-uid` as a request header. Example (Windows cmd):

```cmd
set DEV_AUTH_UID=test-user-123 && npm run start:dev
```

Now browser requests will be treated as if authenticated for UID `test-user-123` and new users will be seeded with 2500 tokens on first access.

If you'd prefer to test the full Firebase Auth flow locally, start the Auth emulator as well:

```cmd
npx firebase emulators:start --only firestore,auth
```

You may then wire the client to the local Auth emulator by setting the appropriate Firebase client config to point at `http://localhost:9099` for auth.

If you want, I can also add a small client dev shim that automatically sets `x-dev-uid` for requests when running in dev mode.

Install dev dependencies (optional, for convenience scripts)

```cmd
npm install
```

Then you can run both emulator + server together with:

```cmd
npm run dev:all
```

