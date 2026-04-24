@echo off
REM Automated dev starter (no server) for Windows (cmd)
REM - Installs dependencies
REM - Starts Firestore emulator in a new window
REM - Seeds picks/dailyPicks/scoreboard into emulator

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

echo Done. Start the server manually with the command in the README or run start-dev-full.bat to start the server too.
pause
