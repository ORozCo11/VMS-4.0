# VMS Backend Watchdog — keeps Laravel PHP server alive on port 8001
$phpExe    = "C:\vms-run\.runtime\php-8.4.22\php.exe"
$artisan   = "C:\vms-run\backend-api\artisan"
$logFile   = "C:\vms-run\logs\backend-watchdog.log"

New-Item -ItemType Directory -Force -Path "C:\vms-run\logs" | Out-Null

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $msg" | Tee-Object -FilePath $logFile -Append | Out-Null
}

Log "Watchdog started."

while ($true) {
    $running = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue
    if (-not $running) {
        Log "Port 8001 not listening — starting Laravel server..."
        Start-Process -FilePath $phpExe `
            -ArgumentList "$artisan serve --host=127.0.0.1 --port=8001" `
            -WorkingDirectory "C:\vms-run\backend-api" `
            -WindowStyle Hidden
        Log "Laravel server process launched."
    }
    Start-Sleep -Seconds 15
}
