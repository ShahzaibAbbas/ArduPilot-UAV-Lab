# FHD UI Study: Open Design Reference

Reference: https://github.com/nexu-io/open-design

## Relevant Patterns

- Local-first desktop tooling should keep privileged runtime actions behind a local daemon/API boundary.
- The main experience works best as one dense studio window: navigation, canvas/artifact preview, live status, and execution tools stay visible without page-hopping.
- Design systems, plugins, skills, and generated artifacts are treated as inspectable files and panels rather than hidden magic.
- Execution tooling matters in the UI. Open Design documents agent/CLI detection and PATH rescans, so this simulator now exposes a workspace terminal and logs directly in the app.
- 16:9 output targets appear throughout HyperFrames templates, including 1920x1080. For this simulator, the FHD layout target is a 1920x1080 desktop viewport with a wide center canvas and a denser right operations rail.

## Applied To ArduPilot UAV Lab

- Increased the FHD workspace columns to a 320px catalog, flexible canvas, and 430px operations panel.
- Converted the right-side tabs into a scroll-safe tool rail so added operations do not collapse text or controls.
- Added Logs and Terminal tabs beside SITL, Live telemetry, Validation, and AI performance.
- Kept controls compact and operational: tables, cards, command output, and status chips instead of landing-page or hero-style presentation.
- Preserved the existing local-only API origin guard while adding runtime tools.
