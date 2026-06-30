# ArduPilot UAV Lab

A local design-and-simulation workspace for assembling UAV components, validating connections, exporting an ArduPilot parameter starter file, and preparing SITL launch commands.

## What is included

- Component catalog for frame, flight controller, battery, power module, ESC, motors, GPS, compass, rangefinder, telemetry, camera, and gimbal.
- Visual connection canvas powered by React Flow.
- Object-specific block shapes for fast visual scanning.
- Compatibility checks for port direction, signal type, power path, motor/ESC coverage, frame motor count, and common ArduPilot sensor wiring.
- Local AI-style performance estimator for mass, energy, endurance, range, payload margin, and assumptions from selected components and specs.
- JSON design export and server-side design save.
- Workspace save/load using `.saq` files.
- ArduPilot `.param` starter export from the selected components.
- SITL command planning for native SITL frames and the ArduPilot JSON physics backend.

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

The launchers check for Node.js 18 or newer and npm, install Node.js through `winget` on Windows or Homebrew on macOS when available, create the local `data/` and `backups/` folders, install missing npm packages, open `http://127.0.0.1:5173`, and start the app.

They install the files needed for this web app. ArduPilot SITL itself is still detected separately through `sim_vehicle.py`, `ARDUPILOT_HOME`, `ARDUPILOT_ROOT`, or `PATH`.

Designed by UAS Doctoral Tech.

## Manual Run

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Workspace files

Use the canvas toolbar to create a new empty space, reset to the starter workspace, save the current workspace, or load a saved workspace.

Saved workspace files use the `.saq` extension. The file is JSON with a small format header and the current design payload, including components, links, settings, and product specifications.

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
  designStore.js
src/
  App.tsx        Main design environment
  domain/        Component catalog, starter design, validation rules
  lib/api.ts     Frontend API client
```

## Next build targets

- MAVLink telemetry reader and live status panel.
- Custom component library persistence.
- Multi-vehicle swarm layouts.
- JSON physics bridge process templates.
- Mission import/export and pre-arm test scenarios.
