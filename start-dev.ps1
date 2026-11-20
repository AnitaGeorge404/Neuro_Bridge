# Neurobridge Development Environment Startup Script (Windows PowerShell)
# Usage: .\start-dev.ps1

Write-Host "🧠 Starting Neurobridge Development Environment..." -ForegroundColor Cyan
Write-Host ""

# Check if .env file exists, if not create from example
if (-Not (Test-Path ".env")) {
    Write-Host "⚠️  .env file not found. Creating from .env.example..." -ForegroundColor Yellow
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "✓ .env file created. Please update GEMINI_API_KEY if needed." -ForegroundColor Green
    } else {
        Write-Host "✗ .env.example not found!" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Step 1: Installing/Updating Dependencies..." -ForegroundColor Cyan
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ npm install failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Dependencies installed" -ForegroundColor Green
Write-Host ""

# Start Vite dev server in background
Write-Host "Step 2: Starting Vite Development Server (port 8080)..." -ForegroundColor Cyan
$viteProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev" -PassThru
Write-Host "✓ Vite server started (PID: $($viteProcess.Id))" -ForegroundColor Green
Write-Host ""

# Start Python backend
Write-Host "Step 3: Starting FastAPI Backend (port 8000)..." -ForegroundColor Cyan
Write-Host "Setting up Python environment..." -ForegroundColor Yellow

$venvPython = if (Test-Path "backend\venv\Scripts\python.exe") { "backend\venv\Scripts\python.exe" } elseif (Test-Path "venv\Scripts\python.exe") { "venv\Scripts\python.exe" } else { "python" }

# Check Python
$pythonCmd = & $venvPython --version 2>&1
if (-Not $?) {
    Write-Host "✗ Python not found! Please check backend/venv or install Python 3.10+" -ForegroundColor Red
    Stop-Process -Id $viteProcess.Id
    exit 1
}

Write-Host "✓ Python found: $pythonCmd" -ForegroundColor Green

# Start FastAPI Uvicorn server in background
$fastapiProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$venvPython' -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload" -PassThru
Write-Host "✓ FastAPI server started (PID: $($fastapiProcess.Id))" -ForegroundColor Green
Write-Host ""

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "✓ Neurobridge is launching!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 Frontend:  http://localhost:8080" -ForegroundColor Cyan
Write-Host "🔌 Backend:   http://localhost:8000" -ForegroundColor Cyan
Write-Host "📊 Health:    http://localhost:8000/api/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "Vite process ID:    $($viteProcess.Id)" -ForegroundColor Gray
Write-Host "FastAPI process ID: $($fastapiProcess.Id)" -ForegroundColor Gray
Write-Host ""
Write-Host "To stop both servers, run:" -ForegroundColor Yellow
Write-Host "  Stop-Process -Id $($viteProcess.Id); Stop-Process -Id $($fastapiProcess.Id)"
Write-Host ""
