# Workbench redesign and reliability

This update extends the existing React 19 / TypeScript / Vite and Express application. Existing designs, ports, component types, telemetry APIs, and optional Phase-1 `.saq` fields remain supported.

## Interface

`WorkbenchNavigation` groups and searches all tools in Design, Simulate & Connect, and Workspace. The mission runbook is expandable; all seven domain reviews remain visible above the canvas. `workbench.css` provides the foundation; `stitch-workbench.css` and the final `stitch-hci.css` layer apply the supplied Stitch exports. Compact screens use a native Tools dialog and direct Workspace/Inspector switching. Phones add a fixed shortcut bar. The 2D/3D toolbar preserves New, Reset, Save, and Load actions, with complete keyboard tab behavior.

`WorkspaceFilesPanel` searches up to 100 matching saved snapshots, debounces requests, discards stale responses, and distinguishes loading, empty, and error states. Search covers the lab's saved-design directory; external files require the browser file picker. Workspace imports are capped at 10 MB and use existing normalization. Selecting a component no longer marks a saved workspace as edited.

`ConnectionsPanel` polls `/api/runtime` for actual TCP/UDP/process state. Missing responses show unknown status. It also exposes SITL discovery results and the existing process stop API. Configured output destinations, active UDP listeners, discovered scripts, running processes, and simulated firmware workflows are distinct.

## Reliability changes

- Shared `PORT` and `CLIENT_PORT` validation drives the API, Vite proxy, and browser launcher. Occupied ports and malformed configuration return actionable errors.
- Saved workspace reads validate IDs, file type, size, and content. Listing skips damaged records while retaining healthy designs. Search supports name, ID, vehicle, and frame.
- SITL recognizes Cygwin, WSL URL/UNC, native, and POSIX paths correctly. Searches are bounded and avoid dependency/generated trees and symlinks. Script candidates must be regular files. Identical simultaneous searches share one operation without retaining stale completed results.
- WSL discovery and launch use Bash login and positional arguments, allowing configured virtualenv activation without interpolating paths into shell code. Plans validate UDP destinations, JSON hosts, and simulation speed.
- Gazebo detects native and WSL toolchains and compiles in the matching environment with translated paths and separate CMake build directories. Failed configuration stops the build.
- SITL reports started after the process spawn event, rejects overlapping managed launches, and retains stopping state until exit. Native process trees and WSL guest descendants are cleaned up through the existing process API. WSL supervision uses a unique inherited session token, private state, coordinated startup cancellation, and API-pipe closure monitoring.
- Launch connects the existing MAVLink listener automatically, retains its active port, and resolves Windows UDP destinations from NAT or mirrored WSL. Headless and rebuild options are explicit; implicit simulator outputs are disabled in favor of the configured destinations.
- Telemetry serializes listener transitions, cleans up failed UDP binds, invalidates stale vehicle return links, bounds vehicle history, and correctly decodes VFR_HUD. Named flight modes use the detected ArduPilot vehicle family.
- Mission transfers validate inputs and coordinate scaling, handle empty/out-of-order downloads, filter unrelated responses, reject overlapping transfers, and use bounded retries. Tests cover callback races and listener-stop cancellation.
- Live API failures clear stale telemetry in the interface. Performance calculations are labeled as estimates.

## Verification

Run `npm test` for backend, domain, protocol, storage, lifecycle, discovery, and packaging regressions. Network tests use isolated loopback peers. Runtime tests start a temporary API on a free TCP port, exercise save/search/load, and check occupied-port failures.

Run `npm run build` for strict TypeScript and Vite production compilation. The lazy Three.js vendor chunk can trigger Vite's bundle-size advisory.

With `npm run dev` active, run `npm run test:smoke`. Browser checks exercise 2D/3D selection, transforms, `.saq` round trips, saved-workspace search/load, firmware upload/attachment/simulated boot/stop/removal, trace filtering/details/pause/clear/JSON/CSV export, runtime status, and navigation at 1440, 900, and 390 pixels. Saved-design responses and packet traces are isolated fixtures; the test removes its own temporary firmware record. Screenshots go to ignored `test-results/`.

`npm run test:airframes` exercises all seven fixed-wing and six Rover presets through the mission wizard, focused 3D views, and two complete workspace/transform round trips. The catalog has synchronized frontend/backend vehicle and simulator mappings, suitable drive/control components, and family-specific engineering checks. See [Airframe variants](AIRFRAME_VARIANTS.md).

`npm run test:sitl` passed against the installed ArduCopter in Ubuntu WSL: real launch, received heartbeat, successful read-only command ACK, mission download, packet filtering/exports, and clean shutdown. It did not arm the vehicle. The three opt-in WSL lifecycle tests also passed with synthetic subprocesses, verifying early Stop, detached descendant cleanup, unrelated-process survival, and API-pipe closure. Set `UAV_LAB_TEST_WSL=1` to include these tests when running `node --test server/wslSession.test.js`; ordinary `npm test` skips the environment-dependent cases.

## Limits

Autodetection verifies a simulator script location; it does not certify every build dependency or actual vehicle operation. Setup diagnostics report dependencies in the detected runtime. Firmware uploads are never executed and flash/boot is explicitly simulated. Live telemetry remains separate from visualization and simulation.

Gazebo compilation/physics and physical radios or flight hardware were not exercised. Local Gazebo diagnostics correctly report missing dependencies: Windows has CMake but lacks the remaining Gazebo toolchain; Ubuntu has a compiler and pkg-config but lacks CMake and Gazebo packages. The real SITL integration check validates the installed ArduCopter's communication/lifecycle, not flight or terrain behavior for every preset. MAVLink signature presence is reported, but cryptographic authentication is not implemented.
