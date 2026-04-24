<#
PowerShell helper: full dev start
- Installs dependencies
- Starts Firestore + Auth emulator in a new window
- Seeds picks/dailyPicks/scoreboard into emulator
- Starts the Express server in a new window
#>

Push-Location -LiteralPath $PSScriptRoot\..

Write-Host "Installing npm dependencies..."
npm install

Write-Host "Checking port 8085 availability..."
$inUse = Get-NetTCPConnection -LocalPort 8085 -ErrorAction SilentlyContinue
if ($inUse) {
  Write-Host "Port 8085 appears to be in use (PID(s): $($inUse.OwningProcess -join ', ')). Free the port and re-run." -ForegroundColor Yellow
  Pause
  Exit 1
}

Write-Host "Starting Firestore emulator in a new window..."
Start-Process -FilePath "cmd.exe" -ArgumentList '/k', 'cd /d "' + (Get-Location) + '" && npx firebase emulators:start --only firestore,auth'
Start-Sleep -Seconds 4

Write-Host "Seeding repository JSON data into emulator..."
$env:FIRESTORE_EMULATOR_HOST = 'localhost:8085'
node tools\seedFirestore.js

Write-Host "Starting server (dev mode) in a new window..."
Start-Process -FilePath "cmd.exe" -ArgumentList '/k', 'cd /d "' + (Get-Location) + '" && set FIRESTORE_EMULATOR_HOST=localhost:8085 && set FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 && set ADMIN_KEY=local_admin_key && set DEV_AUTH_UID=test-user-123 && node server.js'

Write-Host "All started. Open http://localhost:3000 in your browser."
Pause
Pop-Location
