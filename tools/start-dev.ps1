# PowerShell helper to start Firestore emulator, server, and seed a test user.
# Requires: Node.js, npm

# Check port 8085
$inUse = Get-NetTCPConnection -LocalPort 8085 -ErrorAction SilentlyContinue
if ($inUse) {
  Write-Host "Port 8085 appears to be in use (PID(s): $($inUse.OwningProcess -join ', ')). Free the port and re-run this script." -ForegroundColor Yellow
  Write-Host "Use: Get-Process -Id <pid> and Stop-Process -Id <pid> -Force" -ForegroundColor Yellow
  pause
  exit 1
}

Write-Host "Starting Firestore emulator in a new window..."
Start-Process -FilePath "cmd.exe" -ArgumentList '/k','npx firebase emulators:start --only firestore'
Start-Sleep -Seconds 3

Write-Host "Starting server (dev mode) in a new window..."
Start-Process -FilePath "cmd.exe" -ArgumentList '/k','set FIRESTORE_EMULATOR_HOST=localhost:8085 && node server.js'
Start-Sleep -Seconds 2

Write-Host "Seeding test user in a new window..."
Start-Process -FilePath "cmd.exe" -ArgumentList '/k','node tools\seedUser.js test-user-123 && echo Seed complete && pause'

Write-Host "All processes started. Open http://localhost:3000 in your browser and run:"
Write-Host "localStorage.setItem('DEV_AUTH_UID', 'test-user-123')" -ForegroundColor Cyan
pause