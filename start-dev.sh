#!/bin/bash
# Neurobridge Development Environment Startup Script (Linux/macOS)
# Usage: bash start-dev.sh

echo "🧠 Starting Neurobridge Development Environment..."
echo ""

# Check if .env file exists, if not create from example
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✓ .env file created. Please update GEMINI_API_KEY if needed."
    else
        echo "✗ .env.example not found!"
        exit 1
    fi
fi

echo ""
echo "Step 1: Installing/Updating Dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "✗ npm install failed!"
    exit 1
fi

echo "✓ Dependencies installed"
echo ""

# Start Vite dev server in background
echo "Step 2: Starting Vite Development Server (port 8080)..."
npm run dev > /tmp/vite.log 2>&1 &
VITE_PID=$!
echo "✓ Vite server started (PID: $VITE_PID)"
echo ""

# Start Python backend
echo "Step 3: Starting FastAPI Backend (port 8000)..."
echo "Setting up Python environment..."

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "✗ Python3 not found! Please install Python 3.8+"
    kill $VITE_PID
    exit 1
fi

PYTHON_VERSION=$(python3 --version)
echo "✓ Python found: $PYTHON_VERSION"

# Create venv if needed
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate venv and install requirements
echo "Activating virtual environment and installing packages..."
source venv/bin/activate
pip install --quiet -r backend/requirements.txt

echo "✓ Python packages installed"

# Start FastAPI server in background (from repo root: backend is a package)
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload > /tmp/fastapi.log 2>&1 &
FLASK_PID=$!
echo "✓ FastAPI server started (PID: $FLASK_PID)"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Neurobridge is launching!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 Frontend:  http://localhost:8080"
echo "🔌 Backend:   http://localhost:8000"
echo "📊 Health:    http://localhost:8000/api/health"
echo ""
echo "Vite process ID:  $VITE_PID"
echo "API process ID: $FLASK_PID"
echo ""
echo "Logs:"
echo "  Vite:  tail -f /tmp/vite.log"
echo "  Flask: tail -f /tmp/fastapi.log"
echo ""
echo "To stop both servers:"
echo "  kill $VITE_PID $FLASK_PID"
echo ""

# Wait for both processes
wait
