#!/usr/bin/env bash
set -euo pipefail

MINIMUM_NODE_MAJOR=18
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

step() {
  printf '\n==> %s\n' "$1"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

install_node() {
  if [[ "${NO_NODE_INSTALL:-0}" == "1" ]]; then
    echo "Node.js ${MINIMUM_NODE_MAJOR} or newer is required. Install it, then run this launcher again." >&2
    exit 1
  fi

  if command_exists brew; then
    step "Installing Node.js with Homebrew"
    brew install node
    return
  fi

  cat >&2 <<EOF
Node.js ${MINIMUM_NODE_MAJOR} or newer is required, and Homebrew was not found.

Install Node.js from https://nodejs.org, or install Homebrew from https://brew.sh
and run this launcher again.
EOF
  exit 1
}

ensure_node() {
  if ! command_exists node; then
    install_node
  fi

  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [[ "$major" -lt "$MINIMUM_NODE_MAJOR" ]]; then
    if [[ "${NO_NODE_INSTALL:-0}" != "1" ]] && command_exists brew; then
      step "Updating Node.js with Homebrew"
      brew upgrade node || brew install node
      major="$(node -p "Number(process.versions.node.split('.')[0])")"
    fi

    if [[ "$major" -lt "$MINIMUM_NODE_MAJOR" ]]; then
      echo "Node.js ${MINIMUM_NODE_MAJOR} or newer is required. Current major version is ${major}." >&2
      exit 1
    fi
  fi

  if ! command_exists npm; then
    echo "npm was not found after Node.js setup. Reinstall Node.js from https://nodejs.org." >&2
    exit 1
  fi

  printf 'Node.js: %s\n' "$(node --version)"
  printf 'npm:     %s\n' "$(npm --version)"
}

ensure_project_folders() {
  step "Preparing local project folders"
  mkdir -p "${PROJECT_ROOT}/data" "${PROJECT_ROOT}/backups"
}

install_project_dependencies() {
  if [[ "${SKIP_NPM_INSTALL:-0}" == "1" ]]; then
    echo "Skipping npm install because SKIP_NPM_INSTALL=1 was provided."
    return
  fi

  local needs_install=0
  if [[ "${FORCE_NPM_INSTALL:-0}" == "1" ]]; then
    needs_install=1
  elif [[ ! -d "${PROJECT_ROOT}/node_modules" ]]; then
    needs_install=1
  elif [[ ! -f "${PROJECT_ROOT}/node_modules/.package-lock.json" ]]; then
    needs_install=1
  elif [[ "${PROJECT_ROOT}/package-lock.json" -nt "${PROJECT_ROOT}/node_modules/.package-lock.json" ]]; then
    needs_install=1
  fi

  if [[ "$needs_install" == "1" ]]; then
    step "Installing required npm packages"
    (cd "$PROJECT_ROOT" && npm install)
  else
    step "Required npm packages are already installed"
  fi
}

open_browser_later() {
  if [[ "${SKIP_BROWSER:-0}" == "1" ]]; then
    return
  fi

  (sleep 4 && open "http://127.0.0.1:5173" >/dev/null 2>&1 || true) &
}

cd "$PROJECT_ROOT"
step "Checking macOS launcher requirements"
ensure_node
ensure_project_folders
install_project_dependencies

if [[ "${CHECK_ONLY:-0}" == "1" ]]; then
  step "Launcher check complete"
  exit 0
fi

step "Starting ArduPilot UAV Lab"
echo "Open http://127.0.0.1:5173 if the browser does not open automatically."
open_browser_later
npm run dev
