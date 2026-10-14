# 3D Lab architecture

## Current data flow

`UavDesign` remains the system of record. React Flow owns the existing 2D `position`; an optional `DesignNode.presentation3d` stores a separate position, rotation, and scale. Old workspaces receive deterministic 3D positions derived from their 2D layout and require no migration rewrite.

`App.tsx` owns the shared selection ID. The 2D canvas and `ThreeLabWorkspace` both update that ID, so either view selects the same node and uses the existing inspector. The saved `.saq` format identifier and version remain unchanged; optional `lab`, `presentation3d`, and firmware-reference fields are defaulted while loading.

## Scene modules

- `sceneLayout.ts` resolves saved transforms or deterministic fallbacks.
- `ComponentMesh.tsx` renders licensed-independent procedural geometry for every catalog component.
- `ConnectionPath.tsx` styles routed paths using existing signal kinds.
- `ThreeScene.tsx` provides the grid, lights, orbit camera, bounds fitting, and axes gizmo.
- `ThreeLabWorkspace.tsx` provides accessible object selection, hover details, visibility controls, isolation, and transform editing.
- `LayaAirBridge.tsx` is an optional adapter for a host-supplied LayaAir 3.x runtime. It receives the same scene manifest and selection callbacks without making the LayaAir binary a required dependency of the React app.

The canvas uses demand rendering, a single pass to center automatic layouts, memoized geometry decisions, and no per-frame React state updates. Component labels use HTML and system fonts, so the scene needs no remote font or model download. Labels and wires can be disabled. The Reduced motion toggle and platform preference disable orbit damping and animated bounds fitting.

Fit follows the visible components when selection isolation or scene membership changes. Reset restores both the perspective camera and its orbit target. Frame arms and attached procedural geometry participate in selection. Hover details resolve the latest node data and disappear when the component is no longer visible.

Fresh MAVLink attitude packets rotate the complete assembly in the scene, preserving each component's saved transform. Airspeed, wind, and gust values control a bounded procedural flow cue. When telemetry is absent or stale, the HUD labels the concept aero estimate and uses the configured simulation wind values instead.

The transform inspector provides position, yaw, pitch, roll, and per-axis scale. Enter or leaving a field saves a finite, bounded value; Escape cancels; blank or invalid drafts retain the previous transform. **Use automatic layout** removes the optional override. Changes remain separate from the 2D layout. Position is bounded to ±10,000 scene units and scale to 0.1–100; imported rotations are reduced modulo a full turn, preserving orientation. Imported settings accept only expected boolean, enum, and bounded filter values.

`ThreeCanvasBoundary.tsx` isolates renderer failures and handles WebGL context loss. The fallback preserves the selected component and transform inspector, explains recovery, and offers a renderer retry. The rest of the workspace remains usable through the 2D view.

## Security and persistence boundaries

3D state contains presentation metadata only. Firmware binaries are never embedded in `.saq`; nodes store only the server record ID, original name, size, timestamp, compatibility status, and SHA-256 hash. Missing server records do not prevent a workspace from loading.

## Test plan and deferred work

`scripts/three-workspace.test.mjs` exercises legacy defaults, malformed imports, bounded transform normalization, independent saved metadata, deterministic automatic layout, non-finite coordinate handling, and procedural geometry fallbacks using the existing TypeScript compiler. Run it with `node --test scripts/three-workspace.test.mjs`. The browser smoke script covers opening the 3D workspace and shared component selection. Phase 2 should add transform gizmos, snapping, port-level connectors, validated GLTF assets with primitive fallbacks, and cable editing. Electrical propagation and animated signals remain Phase 3 work.
