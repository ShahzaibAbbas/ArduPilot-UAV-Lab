[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SkipBrowser,
  [switch]$NoNodeInstall,
  [switch]$ForceInstall,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$MinimumNodeMajor = 18
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Install-Node {
  if ($NoNodeInstall) {
    throw "Node.js is required. Install Node.js $MinimumNodeMajor or newer, then run this launcher again."
  }

  if (-not (Test-Command "winget")) {
    throw "Node.js is required and winget was not found. Install Node.js $MinimumNodeMajor or newer from https://nodejs.org, then run this launcher again."
  }

  Write-Step "Installing Node.js LTS with winget"
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

function Ensure-Node {
  if (-not (Test-Command "node")) {
    Install-Node
  }

  $major = [int](& node -p "Number(process.versions.node.split('.')[0])")
  if ($major -lt $MinimumNodeMajor) {
    if (-not $NoNodeInstall -and (Test-Command "winget")) {
      Write-Step "Updating Node.js LTS with winget"
      winget upgrade --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
      Refresh-Path
      $major = [int](& node -p "Number(process.versions.node.split('.')[0])")
    }

    if ($major -lt $MinimumNodeMajor) {
      throw "Node.js $MinimumNodeMajor or newer is required. Current major version is $major."
    }
  }

  if (-not (Test-Command "npm")) {
    throw "npm was not found after Node.js setup. Reinstall Node.js from https://nodejs.org."
  }

  Write-Host "Node.js: $(& node --version)"
  Write-Host "npm:     $(& npm --version)"
}

function Ensure-ProjectFolders {
  Write-Step "Preparing local project folders"
  New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot "data") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot "backups") | Out-Null
}

function Install-ProjectDependencies {
  if ($SkipInstall) {
    Write-Host "Skipping npm install because -SkipInstall was provided."
    return
  }

  $nodeModules = Join-Path $ProjectRoot "node_modules"
  $nodeModulesLock = Join-Path $nodeModules ".package-lock.json"
  $rootLock = Join-Path $ProjectRoot "package-lock.json"
  $needsInstall = $ForceInstall -or -not (Test-Path $nodeModules) -or -not (Test-Path $nodeModulesLock)

  if (-not $needsInstall -and (Test-Path $rootLock)) {
    $needsInstall = (Get-Item $rootLock).LastWriteTimeUtc -gt (Get-Item $nodeModulesLock).LastWriteTimeUtc
  }

  if ($needsInstall) {
    Write-Step "Installing required npm packages"
    Push-Location $ProjectRoot
    try {
      npm install
    } finally {
      Pop-Location
    }
  } else {
    Write-Step "Required npm packages are already installed"
  }
}

Push-Location $ProjectRoot
try {
  Write-Step "Checking Windows launcher requirements"
  Ensure-Node
  Ensure-ProjectFolders
  Install-ProjectDependencies

  if ($CheckOnly) {
    Write-Step "Launcher check complete"
    exit 0
  }

  Write-Step "Starting ArduPilot UAV Lab"
  if ($SkipBrowser) {
    Write-Host "Open http://127.0.0.1:5173 after the server starts."
  } else {
    Write-Host "Opening the fullscreen ArduPilot UAV Lab browser app."
    Write-Host "Move the cursor to the upper-right edge to reveal Minimize and Close."
  }
  $env:ARDUPILOT_LAUNCHER_PID = [string]$PID
  if ($SkipBrowser) {
    npm run dev
  } else {
    npm run app
  }
} finally {
  Remove-Item Env:\ARDUPILOT_LAUNCHER_PID -ErrorAction SilentlyContinue
  Pop-Location
}
