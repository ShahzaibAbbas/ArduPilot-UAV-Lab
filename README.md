# ArduPilot UAV Lab

Design a UAV as one connected system, review it across every engineering discipline, and carry the same design evidence into ArduPilot configuration and simulation.

## Redesigned engineering workspace

The workspace has grouped navigation for design, simulation, and utilities, a larger 2D/3D canvas, a focused inspector, and compact verification evidence. The mission runbook is available in the sidebar. Narrow screens stack the inspector below the canvas.

- **Ports & setup** shows the browser address, actual API TCP port, MAVLink UDP listener, managed SITL processes, simulator discovery, and configured ground-station destinations. Use it to re-run autodetection, enter a simulator location, configure telemetry, or stop a managed simulation.
- **Workspace files** automatically lists saved lab snapshots. Search by name, vehicle, frame, or ID; open a result or browse for a `.saq`/JSON file elsewhere on the computer. Corrupt snapshots no longer hide valid saved workspaces.
- **SITL** searches native, Cygwin, and WSL environments. WSL discovery and launch use Bash login so an existing ArduPilot Python environment can activate. A detected script and a running autopilot are separate states.

Airframe selection includes **seven fixed-wing / VTOL concepts** and **six rover concepts**. Choose a variant in **New → Airframe**, the Airframe inspector's grouped Layout menu, or SITL's Frame selector. Fixed-wing choices include trainer, flying wing, V-tail, motor glider, twin-boom pusher, and QuadPlane; rover choices include buggy, skid steer, tracked crawler, six-wheel explorer, and balance bot. See the [variant catalog and simulator mappings](docs/AIRFRAME_VARIANTS.md).

The 3D workbench renders the selected wing, tail, rotor, wheel, or track arrangement, with detailed procedural electronics and studio lighting. **View airframe** isolates and frames the vehicle; **Isolate** returns to the complete component scene. Optional transforms and model dimensions survive `.saq` round trips.

The API defaults to TCP `4310` and the browser development server to TCP `5173`. Change them together for a second installation or occupied ports:

```powershell
$env:PORT = "4420"
$env:CLIENT_PORT = "5280"
npm run app
```

The API, Vite proxy, and browser launcher use these settings consistently. The ports must differ. MAVLink uses a separate UDP listener (default `14552`); ground-station outputs default to UDP `14550` and `14551`. Stop the listener before changing its port. Configured destinations do not prove a ground station is connected. See [workbench verification and limitations](docs/WORKBENCH_REDESIGN.md).

SITL launch starts the existing telemetry reader and adds its UDP destination automatically. It keeps an active reader's port and resolves the Windows host address for WSL NAT networking. Launch defaults to no external windows; enable rebuilding when source changes, or disable it to use an existing simulator binary. Managed WSL sessions use private temporary state and clean up their own Linux descendants when stopped or when the API disconnects.

Run `npm test` and `npm run build` for automated verification. With the app running, `npm run test:smoke` checks the main workflows and `npm run test:airframes` checks all 13 fixed-wing/rover presets and representative save/load round trips. `npm run test:sitl` is an opt-in integration check against an installed simulator: it launches a private API and disarmed ArduCopter, verifies telemetry, a version response, mission download, trace exports, and shutdown. It refuses to run beside an existing simulator and uses the existing binary unless `UAV_LAB_SITL_REBUILD=1` is set.

## Your first 10 minutes

1. Start the app with the launcher for your operating system below.
2. Select **New** and complete the Mission → Airframe → Systems wizard. The lab creates the required engineering baseline automatically.
3. Connect power, signal, control, propulsion, and mechanical interfaces on the visual canvas.
4. Work through the seven domain tabs; select **Review / resolve** on a failed check. Results update automatically after each repair.
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

**Validate → Review / resolve** explains what is wrong and lists the exact components, ports, or connections to inspect. Choose a listed connection repair, open the inspector or settings, or select **Not now** to leave the issue pending. Missing required power inputs and invalid wires remain errors until corrected; fixed issues clear from both validation and acceptance. Multiple sensors are checked individually, including data paths routed through harnesses. Auto-Wire preserves occupied power inputs and existing alternative wiring.

The validation summary reports validation errors separately from acceptance progress. Verification advances only when both are complete. Scenario results belong to the design configuration that was checked; changing connections, component properties, or settings asks for a new scenario run. With the app running, `npm run test:validation` exercises issue review, repair, deferral, acceptance refresh, and undo/redo in the browser.

## Components and capabilities

Windows Mission Planner TCP/UDP connection steps, optional companion GPIO wiring, Linux VM installation, and application exit behavior are documented in [Windows connections and companion VM](docs/WINDOWS_CONNECTIONS_AND_COMPANION.md).

- Build with airframes, flight controllers, batteries, power modules, ESCs, motors, navigation sensors, rangefinders, airspeed sensors, optical flow, telemetry, companion computers, ADS-B/Remote ID, cameras, gimbals, parachutes, and alerts.
- Switch between the existing 2D system graph and a procedural **3D Lab** with synchronized selection, styled signal paths, camera controls, deterministic legacy-workspace layout, and optional saved transforms.
- Upload `.apj`, `.bin`, `.hex`, or `.elf` files to the local **Firmware Lab** for bounded metadata inspection and SHA-256 hashing, then run an explicitly labeled visual erase/flash/verify/boot simulation. Uploaded firmware is never executed.
- Inspect the existing MAVLink listener through a bounded RX/TX **Packet Trace** with filters, details, capped hex previews, pause, clear, statistics, timeline stepping, and `.mavtrace.json` or CSV export.
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

Phase-1 browser smoke check (run while `npm run dev` is active):

```powershell
npx playwright install chromium
npm run test:smoke
```

The smoke check covers 2D/3D selection, transform editing and `.saq` round trips, a temporary firmware upload/attachment/visual boot/stop/removal, and packet controls using an isolated synthetic buffer. It leaves live telemetry untouched and saves screenshots under the ignored `test-results/` folder.

Architecture and limitations are documented in `docs/3D_LAB_ARCHITECTURE.md`, `docs/FIRMWARE_LAB.md`, and `docs/MAVLINK_TRACE.md`.

## Software update button

Use the top-bar Update button when the app folder was cloned from Git. The backend updates conservatively with `git pull --ff-only`, refreshes npm packages with `npm install`, and compiles the app with `npm run build`.

If the app was copied as a ZIP or upload package without a `.git` folder, the button will show a message that a Git checkout is required.

## Workspace files

Use the workspace toolbar in either 2D or 3D to start a new mission, reset to the starter workspace, save the current workspace, or load a saved workspace. **New** opens a three-step wizard and does not replace the current workspace until **Create workspace** is selected. In the 3D inspector, Enter or leaving a field saves an edit; Escape cancels it. Rotation and scale controls expand below the position fields.

The generated mission workspace includes a protected battery → fuse → PDB → power-module path, a documented wiring harness, airframe and landing interfaces, ArduPilot flight control, navigation, telemetry, status/failsafe hardware, frame-matched propulsion, and the mission systems selected in the wizard.

Saved workspace files use the `.saq` extension. The file is JSON with a small format header and the current design payload, including components, links, settings, and product specifications.

## Upload rules

Before preparing a GitHub upload or deleting generated files, follow `UPLOAD_RULES.md`. It defines the local-only `github uploading/` staging folder and the ZIP backup workflow.

Create a source package from the current working files, including new and uncommitted source:

```powershell
npm test
npm run build
npm run github:upload
```

The command creates a fresh versioned staging folder and ZIP in `github uploading/`, plus an identical recovery ZIP in `backups/`. It includes documentation, launchers, CI, and a SHA-256 file manifest. It excludes dependencies, build output, runtime data, firmware binaries, environment files, keys, and local workspace reports. It works without Git and never overwrites an existing package. An optional `-- --version v0.1.0-my-release` sets a custom version.

Extract the ZIP and upload its **contents** to the repository root, including `.gitignore` and `.github/`. Uploading the ZIP itself only stores an archive on GitHub. Do not upload the staging or backup folders. See [the upgrade notes](docs/PHASE_1_UPGRADE.md) for the changes and validation scope.

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
