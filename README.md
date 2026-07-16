# ArduPilot UAV Lab

Design a UAV as one connected system, review it across every engineering discipline, and carry the same design evidence into ArduPilot configuration and simulation.

## Your first 10 minutes

1. Start the app with the launcher for your operating system below.
2. Select **New** and complete the Mission → Airframe → Systems wizard. The lab creates the required engineering baseline automatically.
3. Connect power, signal, control, propulsion, and mechanical interfaces on the visual canvas.
4. Work through the seven domain tabs; resolve highlighted paths and re-run each acceptance check.
5. Save a design snapshot, review the verification report, export the starter artifacts, and run a mission scenario or SITL plan.

The guided runbook follows six stages: **Define mission**, **Choose airframe**, **Add systems**, **Integrate systems**, **Verify design**, and **Run simulation**.

## Seven engineering domains

- **Electrical & Power** - storage, conversion, protection, sensing, and load distribution.
- **Wiring & Buses** - harnesses, connector direction, signal compatibility, and digital/analog buses.
- **Mechanical & Mounting** - structure, retention, landing interfaces, clearances, and payload mounting.
- **Propulsion** - motors, ESCs, command paths, frame coverage, and thrust-producing hardware.
- **Avionics & Sensors** - flight computing, navigation, environment sensing, and onboard perception.
- **Communications** - RC, telemetry, MAVLink, traffic-awareness, and regulatory broadcast links.
- **Safety** - fault protection, failsafes, alerts, containment, and recovery hardware.

Each domain presents an objective, acceptance checks, affected components or paths, recommended next actions, and a re-check control.

## Components and capabilities

- Build with airframes, flight controllers, batteries, power modules, ESCs, motors, navigation sensors, rangefinders, airspeed sensors, optical flow, telemetry, companion computers, ADS-B/Remote ID, cameras, gimbals, parachutes, and alerts.
- Model electrical and mechanical integration with **fuses**, **power distribution boards (PDBs)**, **rated wiring harnesses**, **RC receivers**, **landing gear**, and **payload mounts**.
- Validate port direction, signal type, battery-to-load power paths, overcurrent protection, wire ratings, motor/ESC coverage, mounting paths, control links, sensor wiring, recovery outputs, and battery failsafe order.
- Estimate mass, energy, endurance, range, payload and mission reserve, wind penalty, and current margin from the selected components and recorded specifications.
- Save/load `.saq` workspaces, export JSON designs and ArduPilot `.param` starters, and maintain reusable custom component templates under `data/library/`.
- Prepare native and JSON-backend SITL commands, multi-vehicle layouts, QGC waypoint missions, pre-arm checklists, Gazebo assets, and ZIP simulator bundles.
- Read MAVLink UDP telemetry and issue arm, disarm, takeoff, mode, RTL, land, and custom `COMMAND_LONG` actions.
- Use the in-app terminal, lifecycle logs, Gazebo helper tooling, and conservative Git-based software updater.

## Evidence and verification

The workspace keeps the engineering record connected:

`Design snapshot` -> `Domain verification report` -> `Simulation result`

A design is ready for final verification only when all domain checks are complete and no design-validation errors remain. Save the current revision before exporting or simulating so the evidence refers to the same configuration.

> **Safety:** Performance estimates and automated checks are engineering aids. They do not replace manufacturer datasheets, current/voltage/thermal derating, mechanical inspection, continuity and insulation checks, bench testing, propeller-off tests, or a controlled flight-test plan.

## Launchers

Windows:

```powershell
.\Launch-Windows.bat
```

macOS:

```bash
chmod +x ./Launch-macOS.command
./Launch-macOS.command
```

Ubuntu:

```bash
chmod +x ./Launch-Ubuntu.sh
./Launch-Ubuntu.sh
```

The launchers check for Node.js 18 or newer and npm, install Node.js through `winget` on Windows or Homebrew on macOS when available, create the local `data/` and `backups/` folders, install missing npm packages, and start the app. The Windows launcher opens a fullscreen ArduPilot UAV Lab browser app; move the cursor to the upper-right edge to reveal Minimize and Close. The Ubuntu launcher reports the exact `apt` commands if Node.js or npm is missing.

The API server watches the launcher process. Closing the launcher command window shuts down the server and any SITL or telemetry reader processes started by the app.

They install the files needed for this web app. ArduPilot SITL itself is still detected separately through `sim_vehicle.py`, `ARDUPILOT_HOME`, `ARDUPILOT_ROOT`, or `PATH`.

## Manual Run

```powershell
npm install
npm run dev
```

Fullscreen browser app:

```powershell
npm run app
```

Open `http://127.0.0.1:5173`.

## Software update button

Use the top-bar Update button when the app folder was cloned from Git. The backend updates conservatively with `git pull --ff-only`, refreshes npm packages with `npm install`, and compiles the app with `npm run build`.

If the app was copied as a ZIP or upload package without a `.git` folder, the button will show a message that a Git checkout is required.

## Workspace files

Use the canvas toolbar to start a new mission, reset to the starter workspace, save the current workspace, or load a saved workspace. **New** opens a three-step wizard and does not replace the current workspace until **Create workspace** is selected.

The generated mission workspace includes a protected battery → fuse → PDB → power-module path, a documented wiring harness, airframe and landing interfaces, ArduPilot flight control, navigation, telemetry, status/failsafe hardware, frame-matched propulsion, and the mission systems selected in the wizard.

Saved workspace files use the `.saq` extension. The file is JSON with a small format header and the current design payload, including components, links, settings, and product specifications.

## Upload rules

Before preparing a GitHub upload or deleting generated files, follow `UPLOAD_RULES.md`. It defines the local-only `github uploading/` staging folder and the ZIP backup workflow.

## ArduPilot SITL setup

The backend searches for `sim_vehicle.py` in this order:

- A location entered in the Simulation panel
- `%ARDUPILOT_HOME%\Tools\autotest\sim_vehicle.py`
- `%ARDUPILOT_ROOT%\Tools\autotest\sim_vehicle.py`
- `sim_vehicle.py` on `PATH`
- Common native ArduPilot checkout folders
- Cygwin installations and user home folders
- User WSL distributions such as Ubuntu

Accepted manual locations include a Windows file or checkout folder, `wsl://Ubuntu/home/user/ardupilot`, `Ubuntu:/home/user/ardupilot`, a `\\wsl$\Ubuntu\...` path, or `cygwin:/home/user/ardupilot`. If every automatic source fails, the app opens a location request with these examples.

The Simulation action is **Build & Launch**: `sim_vehicle.py` builds the selected ArduPilot firmware when needed and then starts SITL. WSL builds run through `wsl.exe` in the detected ArduPilot checkout, and generated Windows parameter-file paths are translated with `wslpath`. Cygwin builds run through its Bash environment and translate paths with `cygpath`.

ArduPilot's docs describe `sim_vehicle.py` as the standard SITL startup tool and show `-v` for vehicle selection, `-f` for frame selection, `--console`, `--map`, `-L` for locations, and `--add-param-file` for loading parameter files:

https://ardupilot.org/dev/docs/using-sitl-for-ardupilot-testing.html

For external physics, this app generates `-f JSON:<host>`, matching ArduPilot's JSON interface guidance:

https://ardupilot.org/dev/docs/sitl-with-JSON.html

On Windows, ArduPilot SITL is commonly run under Linux or WSL2. If SITL is not installed, the app still generates the full plan and asks the user to locate `sim_vehicle.py` before Build & Launch.

## Project layout

```text
server/
  index.js       Express API
  sitl.js        SITL detection, command generation, param export
  telemetry.js   MAVLink telemetry parsing and command dispatch
  artifacts.js   Scenario files, Gazebo plugin helpers, bundle export
  gazebo.js      Gazebo install detection and plugin compilation
  zip.js         No-dependency ZIP archive writer
  designStore.js
src/
  App.tsx        Main design environment
  domain/        Component catalog, starter design, validation rules
  lib/api.ts     Frontend API client
```

## Next build targets

- Live mission upload/download flows from the telemetry panel.
- Simulator-specific sensor topic adapters for deeper Gazebo failure injection.
