# Removes the Prusa Status bridge login scheduled task and generated launcher.
#
# Usage:  ./uninstall-autostart.ps1 [-TaskName "PrusaStatusBridge"]
param(
    [string]$TaskName = "PrusaStatusBridge"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbsPath = Join-Path $scriptDir "run-hidden.vbs"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
} else {
    Write-Host "Scheduled task '$TaskName' was not found." -ForegroundColor Yellow
}

if (Test-Path $vbsPath) {
    Remove-Item $vbsPath -Force
    Write-Host "Removed launcher: $vbsPath" -ForegroundColor DarkGray
}
