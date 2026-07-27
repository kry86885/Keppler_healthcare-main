# startdev_alt.ps1 - Start HospAI services on alternate ports (6001, 6002, 6173)
# Uses Win32_Process to launch detached background processes that persist after console exit.
# Keeps existing default ports (5001, 5002, 5173) free for other running instances.

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$LogDir = Join-Path $Root ".devrun"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$VenvPythonw = Join-Path $Root "backend\.venv\Scripts\pythonw.exe"
if (-not (Test-Path $VenvPythonw)) {
    $VenvPythonw = "pythonw.exe"
}

function Test-PortListening($port) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
}

function Start-DetachedProcess($cmdLine, $workDir) {
    Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = $cmdLine
        CurrentDirectory = $workDir
    } | Out-Null
}

Write-Host "=== Starting HospAI on Alternate Ports ===" -ForegroundColor Cyan
Write-Host "Python Executable: $VenvPythonw" -ForegroundColor Gray
Write-Host "Backend API:       http://localhost:6001" -ForegroundColor Green
Write-Host "Symptom Backend:   http://localhost:6002" -ForegroundColor Green
Write-Host "Frontend App:      http://localhost:6173" -ForegroundColor Green

# 1. Start Backend on Port 6001
Write-Host "`n[1/3] Checking Main Backend on port 6001..." -ForegroundColor Yellow
if (Test-PortListening 6001) {
    Write-Host "  -> Port 6001 is already listening!" -ForegroundColor Green
} else {
    Write-Host "  -> Launching Main Backend on port 6001 via Win32_Process..." -ForegroundColor Cyan
    $cmd = "cmd.exe /c `"set PORT=6001&& set FLASK_ENV=development&& `"$VenvPythonw`" app.py > `"$LogDir\backend-6001.log`" 2>&1`""
    Start-DetachedProcess -cmdLine $cmd -workDir "$Root\backend"
}

# 2. Start Symptom Backend on Port 6002
Write-Host "[2/3] Checking Symptom AI Backend on port 6002..." -ForegroundColor Yellow
if (Test-PortListening 6002) {
    Write-Host "  -> Port 6002 is already listening!" -ForegroundColor Green
} else {
    Write-Host "  -> Launching Symptom AI Backend on port 6002 via Win32_Process..." -ForegroundColor Cyan
    $cmd = "cmd.exe /c `"set PORT=6002&& set FLASK_ENV=development&& `"$VenvPythonw`" app.py > `"$LogDir\symptom-6002.log`" 2>&1`""
    Start-DetachedProcess -cmdLine $cmd -workDir "$Root\symptom_backend"
}

# 3. Start Frontend (Vite Dev Server) on Port 6173
Write-Host "[3/3] Checking Frontend Dev Server on port 6173..." -ForegroundColor Yellow
if (Test-PortListening 6173) {
    Write-Host "  -> Port 6173 is already listening!" -ForegroundColor Green
} else {
    Write-Host "  -> Launching Frontend Dev Server on port 6173 via Win32_Process..." -ForegroundColor Cyan
    $cmd = "cmd.exe /c `"set PORT=6173&& set VITE_API_BASE=http://localhost:6001&& set VITE_API_URL=http://localhost:6001&& set VITE_SYMPTOM_API_BASE=http://localhost:6002&& set VITE_DEV_SERVER_URL=http://localhost:6173&& npm run dev:alt > `"$LogDir\frontend-6173.log`" 2>&1`""
    Start-DetachedProcess -cmdLine $cmd -workDir "$Root\frontend"
}

Write-Host "`nAll services launched on alternate ports!" -ForegroundColor Cyan
Write-Host "To open the Desktop Electron Application connected to these ports, run:" -ForegroundColor White
Write-Host "  cd `"$Root\frontend`"" -ForegroundColor Gray
Write-Host "  `$env:VITE_API_BASE='http://localhost:6001'; `$env:VITE_SYMPTOM_API_BASE='http://localhost:6002'; npm run electron:dev:alt" -ForegroundColor Gray
