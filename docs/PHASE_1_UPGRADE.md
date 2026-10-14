# Phase-1 upgrade

This release extends the existing React/Express lab and preserves legacy `.saq` workspaces.

## Changes

- 3D: synchronized component selection, saved position/rotation/scale controls, validated legacy defaults and finite transforms, faster automatic layout, offline labels, camera reset/fit fixes, reduced-motion support, and recoverable WebGL failures. Workspace file controls remain accessible in both views.
- 3D dynamics: the concept assembly now follows fresh MAVLink roll/pitch/yaw telemetry as one vehicle pose and renders bounded airspeed/wind/gust flow cues. A stale or absent stream is labelled clearly and uses the configured concept aero estimate instead.
- LayaAir bridge: the 3D Lab can mount an official compiled LayaAir 3.x browser runtime supplied as `window.Laya`; it receives the same design-node manifest, selection callbacks, saved transforms, and telemetry pose. If the runtime is not present or cannot initialize, the app explains the fallback and keeps the Three.js renderer active.
- Component menu: the library is explicitly free-form. The build guide remains a non-blocking coverage checklist, and the drawer offers direct add actions plus removal of the selected component.
- Acceptance repair: domain review exposes a safe auto-fix action for deterministic, compatible missing connections. The issue dialog also offers a contextual wiring-rating repair that uses catalog baseline values or adds a rated harness with a power feed for engineer review.
- Firmware: bounded metadata reads, validated storage records and IDs, exact board matching, SHA-256 integrity checks before visual boot, persistent attachment of library records, removal of stale workspace references, bounded workflow retention, and timer cleanup. Uploads remain inspection-only; all flash/boot states are explicitly simulated.
- Telemetry: corrected MAVLink command/mission CRC generation, CRC validation for supported received messages, MAVLink 2 truncated-payload decoding, signature-presence reporting, and retention of corrupt frames for inspection while excluding them from live state.
- Trace: hard count/byte/preview bounds, strict filters, complete filtered exports, spreadsheet-safe CSV, reliable pause/clear/selection polling, keyboard packet selection, and filter reset. Trace pause is distinct from live telemetry and SITL.
- Packaging: source ZIPs include current edits and new files without requiring a commit. Matching recovery archives, safe exclusions, non-overwriting versioned folders, and a per-file SHA-256 manifest make releases reviewable.
- GitHub: Windows/Linux CI runs installation, unit/integration tests, strict TypeScript and Vite builds, and source packaging.
- Windows connections: the existing UDP listener relays ArduPilot traffic to local ground stations and a loopback MAVLink TCP endpoint, including bidirectional parameter/mission traffic. Mission Planner connection instructions and live relay status distinguish network readiness from a running autopilot.
- Companion computer: optional GPIO design ports and a procedural header, plus managed QEMU Linux VM install/start/stop controls with persistent local disks, a local VNC control window, and a documented MAVLink TCP path to SITL. QEMU and a Linux installer remain separate requirements.
- SITL console: managed MAVProxy stdout/stderr is retained in a bounded browser console with a validated command channel. Headless launches keep the embedded console available; external windows can be requested from Launch & telemetry when the host has a GUI display.
- Maintenance: visual firmware reset/wipe, a one-launch SITL EEPROM wipe, managed SITL stop/reset, and cooperative application exit with process-tree cleanup.
- Layout: compact 45 px header, 48 px domain strip, 385 px foreground component library, and 42 px evidence bar on desktop.

## Validation

Run `npm test` for parsing, path/storage security, workflow transitions, capacity limits, legacy workspace normalization, procedural geometry fallback, trace filters/exports, loopback MAVLink RX/TX, and packaging tests.

Run `npm run build` for strict TypeScript compilation and a production build. Three.js loads in a separate chunk on entering 3D; its vendor bundle can produce Vite's size advisory.

With `npm run dev` active and Playwright Chromium installed, run `npm run test:smoke`. It checks selection across views, keyboard editing, `.saq` save/load, firmware upload/attach/simulated boot/stop/delete, and trace filtering/details/pause/clear/downloads. It uses an isolated trace buffer, mocks saved-design persistence, and removes only its own temporary firmware record. Screenshots are saved under `test-results/`.

Actual ArduPilot SITL execution still requires a separate ArduPilot installation. Hardware flashing, signed MAVLink authentication, external simulator physics, and actual flights are outside these checks. Packet selection highlights a workspace flight controller as an inspection aid; system IDs are not a verified mapping to physical design nodes.

## Source upload

Run `npm run github:upload`. Keep the backup ZIP locally. Extract the upload ZIP and put its source contents at the GitHub repository root. No remote is pushed by this workflow; generated/runtime folders and local machine reports are excluded.
