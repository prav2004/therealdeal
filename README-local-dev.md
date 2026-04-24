# Local development (Windows)

This project uses the Firestore emulator and a local Express server. The repository already contains helper scripts; follow the steps below to start everything and seed a test user.

Prereqs
- Node.js (16+ recommended)
- npm
- Firebase CLI (optional; the scripts use `npx firebase` so a global install is not strictly required)

Quick manual steps (recommended)
1. Check if port 8085 (Firestore emulator) is free:

```cmd
netstat -ano | findstr :8085
```
If you see output, note the PID and kill it with `taskkill /PID <pid> /F` or free the port another way.

2. Start the Firestore emulator (in a separate terminal):

```cmd
npx firebase emulators:start --only firestore
```

If you prefer the repo-managed port, `firebase.json` already sets the emulator to port `8085`.

3. Start the server (in another terminal):

```cmd
npm run start:dev
```

This sets `FIRESTORE_EMULATOR_HOST=localhost:8085` and runs `node server.js` so the server talks to your local emulator.

4. Seed a test user (run once):

```cmd
node tools/seedUser.js test-user-123
```

If you'd like to bring the repository data (picks, daily picks, scoreboard) into Firestore you can seed the emulator with the JSON files included in the repo:

```cmd
set FIRESTORE_EMULATOR_HOST=localhost:8085
node tools/seedFirestore.js
```

Notes:
- The seed script refuses to run against a real project unless you explicitly set `SEED_FORCE=1` to avoid accidental writes. To seed a non-emulator project: `set SEED_FORCE=1 && node tools/seedFirestore.js` (use with caution).
- The script writes documents into collections: `picks`, `dailyPicks` (doc `current`), and `scoreboard` (doc `main`).

5. In your browser console set the developer UID (so the app will use the seeded user):

```js
localStorage.setItem('DEV_AUTH_UID', 'test-user-123');
```

6. Open the app pages:
- http://localhost:3000/wallet — view balances & account info
- http://localhost:3000/sports — picks board

Smoke checks
You can verify endpoints with curl/PowerShell after the server is running:

```cmd
curl -v -H "x-dev-uid: test-user-123" http://localhost:3000/api/me
curl -v -H "x-dev-uid: test-user-123" http://localhost:3000/api/bets
```

If `curl` isn't available on your machine, you can use PowerShell's `Invoke-WebRequest` or check in the browser.

Troubleshooting tips
- If the emulator refuses to start because the port is taken, either free the port (see step 1) or edit `firebase.json` and change the `emulators.firestore.port` value to an unused port and update `package.json` scripts (the `start:dev` script uses `localhost:8085` by default).
- If server fails to initialize Admin SDK because of missing credentials, the app will still run in emulator mode (see server logs); ensure you started the Firestore emulator before the server if you rely on local behavior.

Automation scripts
This repo includes several helper scripts under `tools\` to automate starting the emulators, seeding data, and (optionally) starting the server. Use whichever fits your workflow:

- `tools\start-dev-full.bat` (cmd) / `tools\start-dev-full.ps1` (PowerShell)
	- Installs dependencies, starts the Firestore + Auth emulators in a new window, seeds the repository JSON data (picks, dailyPicks, scoreboard) into the emulator, and launches the Express server in a new window. This is a "one-click" dev startup.

- `tools\start-dev-no-server.bat` (cmd) / `tools\start-dev-no-server.ps1` (PowerShell)
	- Installs dependencies, starts the emulators, and seeds data but does NOT start the server. Use this when you want the emulator and seeded data ready but prefer to start the server manually (for debugging or attaching a debugger).

- `tools\start-dev.bat` and `tools\start-dev.ps1` (existing)
	- A lightweight helper that starts emulator, server, and a small seeded test user. Keep using these if they match your flow.

Examples (cmd.exe)

Run the full automated flow (installs + emulator + seed + server):

```cmd
cd C:\path\to\pickr_app_finals
tools\start-dev-full.bat
```

Run the flow but leave the server offline (start it manually later):

```cmd
cd C:\path\to\pickr_app_finals
tools\start-dev-no-server.bat
```

PowerShell users can run the `*.ps1` equivalents (you may need to set execution policy for the session):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\n+tools\start-dev-full.ps1
```

If you'd like I can (A) add a more robust script that finds a free port and temporarily rewrites `firebase.json`, or (B) run these scripts once here and report results (I'll list PIDs before killing anything). Reply with your choice.