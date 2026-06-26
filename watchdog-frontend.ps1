# VMS Frontend Watchdog — keeps Vite dev server alive on port 5173
$nodeExe   = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $nodeExe) { $nodeExe = "node" }
$frontendDir = "C:\vms-run\frontend-spa"
$logFile     = "C:\vms-run\logs\frontend-watchdog.log"

New-Item -ItemType Directory -Force -Path "C:\vms-run\logs" | Out-Null

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $msg" | Tee-Object -FilePath $logFile -Append | Out-Null
}

Log "Watchdog started."

while ($true) {
    $running = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    if (-not $running) {
        Log "Port 5173 not listening — starting Vite dev server..."
        Start-Process -FilePath "cmd.exe" `
            -ArgumentList "/c npm run dev" `
            -WorkingDirectory $frontendDir `
            -WindowStyle Hidden
        Log "Vite server process launched."
    }
    Start-Sleep -Seconds 15
}
