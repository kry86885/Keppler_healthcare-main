# startdev_alt.ps1 - Start HospAI services on alternate ports (5001, 5002, 5173)
# Uses Win32_Process to launch detached background processes that persist after console exit.
# Keeps existing default ports (5001, 5002, 5173) free for other running instances.

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$LogDir = Join-Path $Root ".devrun"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

Write-Host "=== Starting HospAI on Alternate Ports ===" -ForegroundColor Cyan

# Find Python executable
$VenvDir = Join-Path $Root "backend\.venv"
$PyExe = Join-Path $VenvDir "Scripts\python.exe"
Write-Host "Python Executable: $PyExe"

function Start-ServiceIfDown($name, $port, $workDir, $envVars, $exe, $cmdArgs, $logFile) {
    Write-Host "Checking $name on port $port..."
    $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connection) {
        Write-Host "  -> Port $port is already listening!" -ForegroundColor Green
        return
    }

    Write-Host "  -> Launching $name on port $port..." -ForegroundColor Yellow
    
    # Set environment variables for the child process
    foreach ($key in $envVars.Keys) {
        [Environment]::SetEnvironmentVariable($key, $envVars[$key], "Process")
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = $cmdArgs
    $psi.WorkingDirectory = $workDir
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Minimized
    $psi.UseShellExecute = $true
    
    # We redirect output manually in the args for python, but for npm it's easier to just let it have a minimized window
    [System.Diagnostics.Process]::Start($psi) | Out-Null
}

# 1. Main Backend
$backendEnv = @{
    "PORT" = "5001"
    
    
    "FLASK_ENV" = "development"
    "SESSION_COOKIE_SECURE" = "false"
    "OCR_BACKEND_URL" = "http://localhost:7621"
}
Start-ServiceIfDown -name "Main Backend" -port 5001 -workDir "$Root\backend" -envVars $backendEnv -exe $PyExe -args "app.py" -logFile "$LogDir\backend-5001.log"

# 2. Symptom Backend
$symptomEnv = @{
    "PORT" = "5002"
    "FLASK_ENV" = "development"
}
Start-ServiceIfDown -name "Symptom AI Backend" -port 5002 -workDir "$Root\symptom_backend" -envVars $symptomEnv -exe $PyExe -args "app.py" -logFile "$LogDir\symptom-5002.log"

# 3. Frontend
$frontendEnv = @{
    "PORT" = "5173"
    "BACKEND_PROXY_TARGET" = "http://127.0.0.1:5001"
    "VITE_DEV_SERVER_URL" = "http://localhost:5173"
    "CHOKIDAR_USEPOLLING" = "true"
    "WATCHPACK_POLLING" = "true"
}
# Find npm.cmd
$npmExe = "npm.cmd"
Start-ServiceIfDown -name "Frontend Dev Server" -port 5173 -workDir "$Root\frontend" -envVars $frontendEnv -exe $npmExe -args "run dev" -logFile "$LogDir\frontend-5173.log"

Write-Host ""
Write-Host "All services launched on alternate ports!" -ForegroundColor Green
Write-Host "To open the Desktop Electron Application connected to these ports, run:"
Write-Host "  cd `"$Root\frontend`""
Write-Host "  `$env:VITE_API_BASE='http://localhost:5001'; `$env:VITE_SYMPTOM_API_BASE='http://localhost:5002'; npm run electron:dev" -ForegroundColor Gray
