@echo off
REM Simple Windows batch helper to start Firestore emulator, server, and seed a test user.
REM Requires: Node.js, npm, npx (comes with npm)

echo Checking port 8085 availability...
netstat -ano | findstr :8085 >nul
if %ERRORLEVEL%==0 (
  echo Port 8085 appears to be in use. Please free the port and re-run this script.
  echo Use: netstat -ano | findstr :8085  then taskkill /PID <pid> /F
  pause
  exit /b 1
)

echo Starting Firestore emulator in a new window...
start "Firestore Emulator" cmd /k "npx firebase emulators:start --only firestore"

echo Waiting 3 seconds for emulator to boot...
timeout /t 3 /nobreak >nul

echo Starting server (dev mode) in a new window...
start "Pickr Server" cmd /k "set FIRESTORE_EMULATOR_HOST=localhost:8085 && node server.js"

echo Waiting 2 seconds for server to boot...
timeout /t 2 /nobreak >nul

echo Seeding test user in a new window...
start "Seed User" cmd /k "node tools\seedUser.js test-user-123 && echo Seed complete && pause"

echo Done. Open http://localhost:3000 in your browser and set localStorage.DEV_AUTH_UID = 'test-user-123' if needed.
pause