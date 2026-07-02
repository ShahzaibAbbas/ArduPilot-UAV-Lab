# ArduPilot UAV Lab

A local design-and-simulation workspace for assembling UAV components, validating connections, exporting an ArduPilot parameter starter file, and preparing SITL launch commands.

## What is included

- Component catalog for frame, flight controller, battery, power module, ESC, motors, GPS, compass, rangefinder, telemetry, camera, and gimbal.
- Extended UAV subsystem catalog for airspeed sensors, optical flow, companion computers, ADS-B/Remote ID, recovery parachutes, and buzzer/status LED hardware.
- Visual connection canvas powered by React Flow.
- Object-specific block shapes for fast visual scanning.
- Compatibility checks for port direction, signal type, power path, motor/ESC coverage, frame motor count, ArduPilot sensor wiring, GPS-denied sensor coverage, parachute trigger wiring, and battery failsafe threshold order.
- Mission test settings for nominal, wind gust, low battery, GPS denied, and payload endurance scenarios.
- Local AI-style performance estimator for mass, energy, endurance, range, payload margin, mission reserve, wind penalty, current margin, and assumptions from selected components and specs.
- JSON design export and server-side design save.
- Workspace save/load using `.saq` files.
- Persistent custom component templates saved under `data/library/`.
- ArduPilot `.param` starter export from the selected components, including two-layer battery failsafe thresholds/actions and starter params for airspeed, optical flow, and parachute components.
- SITL command planning for native SITL frames, multi-vehicle swarm counts/layout metadata, and the ArduPilot JSON physics backend.
- MAVLink UDP telemetry reader with live command/control actions for arm, disarm, takeoff, mode changes, RTL, land, and custom `COMMAND_LONG` messages.
- In-app Logs panel backed by `data/logs/server.log` for API, terminal, maintenance, and SITL lifecycle events.
- In-app workspace Terminal panel for local diagnostics and simulator commands.
- Scenario exports for QGC waypoint missions, pre-arm test checklists, JSON physics bridge process templates, Gazebo world/plugin files, and ZIP simulator bundles.
- Direct Gazebo plugin helpers that detect supported local installs, generate a CMake plugin project, and compile it when CMake, pkg-config, a C++ compiler, and Gazebo development packages are available.
- In-app software update button for Git checkouts. It runs `git pull --ff-only`, `npm install`, and `npm run build`.

Contact: shahzaib.abbas@hotmail.com

## Research-guided additions

The newest simulator controls were based on public UAV simulation and design references:

- ArduPilot battery failsafe docs: low and critical voltage/capacity thresholds plus automated actions such as Land, RTL, and SmartRTL.
- PX4/Gazebo simulation docs: wind speed, gusts, object-avoidance/perception simulation, and failure-test workflows.
- ArduPilot airspeed, optical-flow, parachute, and simulation-on-hardware docs: component parameters, simulated sensors, and defaults-file workflow.
- Multirotor design guidance from ArduPilot and Tyto Robotics: motor/prop/ESC/battery matching, endurance targets, and flight-time estimation loops.

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

Designed by UAS Doctoral Tech.

Support email: shahzaib.abbas@hotmail.com

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

Use the canvas toolbar to create a new empty space, reset to the starter workspace, save the current workspace, or load a saved workspace.

Saved workspace files use the `.saq` extension. The file is JSON with a small format header and the current design payload, including components, links, settings, and product specifications.

## Upload rules

Before preparing a GitHub upload or deleting generated files, follow `UPLOAD_RULES.md`. It defines the local-only `github uploading/` staging folder and the ZIP backup workflow.

## UI study

The FHD operations layout was guided by the Open Design local-first studio model:

```text
docs/fhd-open-design-study.md
```

## ArduPilot SITL setup

The backend looks for `sim_vehicle.py` in either:

- `%ARDUPILOT_HOME%\Tools\autotest\sim_vehicle.py`
- `%ARDUPILOT_ROOT%\Tools\autotest\sim_vehicle.py`
- `sim_vehicle.py` on `PATH`

ArduPilot's docs describe `sim_vehicle.py` as the standard SITL startup tool and show `-v` for vehicle selection, `-f` for frame selection, `--console`, `--map`, `-L` for locations, and `--add-param-file` for loading parameter files:

https://ardupilot.org/dev/docs/using-sitl-for-ardupilot-testing.html

For external physics, this app generates `-f JSON:<host>`, matching ArduPilot's JSON interface guidance:

https://ardupilot.org/dev/docs/sitl-with-JSON.html

On Windows, ArduPilot SITL is commonly run under Linux or WSL2. If SITL is not installed, the app still generates the full command for manual execution.

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
