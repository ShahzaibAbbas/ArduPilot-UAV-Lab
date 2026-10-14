#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

PORT="${PORT:-4310}"
CLIENT_URL="http://127.0.0.1:5173"

echo "ArduPilot UAV Lab"
echo "Working directory: $APP_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 18+ and npm are required."
  echo "Install on Ubuntu with:"
  echo "  sudo apt update"
  echo "  sudo apt install -y nodejs npm"
  echo "For newer Node.js builds, use NodeSource or nvm, then rerun this launcher."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 or newer is required. Current version: $(node --version)"
  exit 1
fi

mkdir -p data/exports backups

if [ ! -d node_modules ]; then
  echo "Installing npm packages..."
  npm install
fi

stop_existing_app_servers() {
  local stopped=0
  echo "Closing existing ArduPilot UAV Lab servers on ports 4310 and 5173..."

  for port in 4310 5173; do
    local pids=""
    if command -v lsof >/dev/null 2>&1; then
      pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    elif command -v fuser >/dev/null 2>&1; then
      pids="$(fuser "${port}/tcp" 2>/dev/null || true)"
    fi

    for pid in $pids; do
      if [ "$pid" = "$$" ]; then
        continue
      fi
      echo "Stopping process $pid on port $port"
      kill "$pid" >/dev/null 2>&1 || true
      stopped=1
    done
  done

  if [ "$stopped" = "1" ]; then
    sleep 1
  else
    echo "No existing app server ports were in use."
  fi
}

echo "Starting API server on 127.0.0.1:$PORT and web app at $CLIENT_URL"
stop_existing_app_servers

if command -v xdg-open >/dev/null 2>&1; then
  (sleep 3 && xdg-open "$CLIENT_URL" >/dev/null 2>&1 || true) &
fi

export ARDUPILOT_LAUNCHER_PID="$$"
npm run dev
