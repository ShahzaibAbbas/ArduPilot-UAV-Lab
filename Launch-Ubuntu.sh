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

echo "Starting API server on 127.0.0.1:$PORT and web app at $CLIENT_URL"

if command -v xdg-open >/dev/null 2>&1; then
  (sleep 3 && xdg-open "$CLIENT_URL" >/dev/null 2>&1 || true) &
fi

export ARDUPILOT_LAUNCHER_PID="$$"
npm run dev
