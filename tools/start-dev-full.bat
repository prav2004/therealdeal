@echo off
REM Fully automated dev starter for Windows (cmd)
REM - Installs dependencies
REM - Starts Firestore emulator in a new window
REM - Seeds picks/dailyPicks/scoreboard into emulator
REM - Starts the Express server in a new window

REM Move to project root (one level up from tools)
cd /d "%~dp0.."

echo Installing npm dependencies (this may take a moment)...
npm install

echo Checking port 8085 availability...
netstat -ano | findstr :8085 >nul
if %ERRORLEVEL%==0 (
  echo Port 8085 appears to be in use. Please free the port and re-run this script.
  echo Use: netstat -ano | findstr :8085  then taskkill /PID <pid> /F
  pause
  exit /b 1
)

echo Starting Firestore emulator in a new window...
start "Firestore Emulator" cmd /k "cd /d %~dp0.. && npx firebase emulators:start --only firestore,auth"

echo Waiting 4 seconds for emulator to boot...
timeout /t 4 /nobreak >nul

echo Seeding repository JSON data into emulator (picks, dailyPicks, scoreboard)...
set FIRESTORE_EMULATOR_HOST=localhost:8085
node tools\seedFirestore.js

echo Starting server (dev mode) in a new window...
start "Pickr Server" cmd /k "cd /d %~dp0.. && set FIRESTORE_EMULATOR_HOST=localhost:8085 && set FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 && set ADMIN_KEY=local_admin_key && set DEV_AUTH_UID=test-user-123 && node server.js"

echo All started. Open http://localhost:3000 in your browser.
pause
