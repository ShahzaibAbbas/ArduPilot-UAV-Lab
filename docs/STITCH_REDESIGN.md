# Stitch workbench redesign

The main engineering workspace was redesigned using [Google Stitch project: ArduPilot UAV Engineering Workbench](https://stitch.withgoogle.com/projects/4677173730672292705).

Stitch generated the **Aerospace Workbench** design system and a desktop 2D systems workbench. The implementation adapts its dark ink header and navigation, light technical canvas, teal selection states, restrained typography, verification inspector, and evidence cards to the existing React application.

## Implementation

- `src/stitch-workbench.css` is the scoped final visual layer, loaded after the existing panel styles. It owns the header, navigation, domain strip, canvas toolbar, verification panel, evidence footer, and responsive layout.
- `src/App.tsx` adds the workspace title and real component/connection counts. Its existing graph and 3D renderer remain in use.
- `src/components/LabWorkspaceChrome.tsx` shows the actual workflow stage, accessible domain progress, acceptance totals, and numbered evidence steps. Unresolved acceptance checks appear before passed checks, without changing the assessment data.
- Connection states, project data, save behavior, validation, and simulation controls use the existing application logic. Stitch's sample component specifications and sample flight/status values are visual reference content only.

Muted text is darker than the generated palette to improve contrast on light surfaces. At narrow widths the navigation becomes an icon rail, canvas toolbars scroll horizontally, and the inspector stacks below the canvas. The 3D view gets additional height and a minimum 160px canvas so its controls cannot collapse the scene.

## Inspector tool panels

The October 2026 pass extends the same design system to the inspector tools: SITL, Mission, Live, Firmware, Trace, Performance, BOM, Ports & setup, Compare, Params, Logs, and Terminal. The rules are in the "Inspector tool panels" and "Workspace tools" sections of `src/stitch-workbench.css`.

- Sections are white cards with a 1px `#e0e7ee` border, an 8px radius, and mono uppercase section labels.
- Primary actions are teal (`#0b8b7a`). Secondary actions use an outline. Disabled actions are quiet grey instead of a faded brand colour. Long labels wrap instead of being truncated.
- Headings, empty states, mission briefs, and status cards use the workbench type scale (11–15px) instead of the older 16px bold text.
- Trace filters no longer overflow the panel. The empty packet timeline is hidden until packets arrive. Compare keeps its metric labels readable.
- The Firmware refresh action has a styled class instead of the browser's default button. The inspector header button names its purpose: back to the active domain check.

These panels use the existing Stitch design tokens. Additional desktop and mobile HCI references were generated in the signed-in Stitch project on October 14, 2026.

## Reference artifacts

- [Stitch project screenshot](stitch/stitch-project.png)
- [Rendered reference HTML captured from the generated screen](stitch/workbench-reference.html)
- [Implemented desktop workspace](stitch/desktop-workbench.png)
- [Implemented narrow workspace](stitch/mobile-workbench.png)
- [Implemented inspector tool panels: SITL, Mission, Live, Firmware, Trace](stitch/tool-panels.png)

The rendered HTML is retained as a reference; it is not imported into the application.

## Verification

`npm test`: 216 tests, 212 passed, 4 skipped, no failures. `npm run build`: TypeScript and production build pass.

Browser checks covered the desktop workspace, 900px layout, and 390px layout; 2D/3D switching; 3D component and airframe selection; component library search; and acceptance issue review/defer. The narrow document has no horizontal overflow and the selected 3D scene retains 216px of canvas height.

## Supplied ZIP export update — October 14, 2026

The user supplied three Stitch archives. Their original `code.html`, `screen.png`, and `DESIGN.md` files are retained under [exports](stitch/exports/README.md); [manifest.json](stitch/exports/manifest.json) records their names, image sizes, and SHA-256 hashes.

The desktop HCI refinement in `screen-0` and mobile reference in `screen-2` guide the current update. `screen-1` retains the earlier dark desktop variant. The shared exported HTML palette uses navy `#213242`, teal `#00685b`, canvas `#f7f9ff`, and pale blue `#edf4ff` / `#e2efff` surfaces. The desktop tool sidebar is light; the mobile Tools dialog and quick navigation remain navy.

- `src/stitch-hci.css` is the final layout and export token layer, loaded after the prior workbench styles.
- `src/stitch-fonts.css` and `public/fonts/` provide local Latin variable Inter and JetBrains Mono fonts, their official OFL licenses, and source provenance. Runtime font loading needs no third-party connection.
- Tool search includes clear and no-results states. A native modal exposes every tool and the mission runbook on compact screens.
- All seven domains remain visible, with action badges derived from actual failed checks. Counts and telemetry use tabular numerals.
- Phones provide direct Workspace/Inspector switching and fixed Workspace, Review, Mission, Params, and Firmware shortcuts. The current workflow stage is visible in the header.
- The 2D/3D tabs support arrow keys, Home/End, associated panels, and one tab stop. Tab navigation cannot nudge selected nodes. The library focuses Search when opened; Escape yields to a foreground dialog and otherwise closes the library.
- Existing New and Reset actions retain their mission-wizard and starter-design behavior. The template's sample hashes, live values, sign-offs, firmware versions, and hardware ratings are not substituted for application data.

Browser checks before the ZIP-specific palette/font/shortcut update covered 1440px, 900px, 390px, and 320px layouts; tool search; library focus/restoration; layered Escape; 2D/3D keyboard switching with unchanged node positions; domain issue review; and compact domain navigation. The mobile 3D canvas was increased to a 220px minimum, with a 54px toolbar.

Follow-up validation on October 15, 2026 used a clean source installation: the production build passed, the complete regression suite passed (256 passed, 4 platform-dependent skips), and all seven browser smoke scripts passed with no uncaught page errors. Current desktop and mobile captures were inspected; exact fidelity comparison against the supplied export images remains pending. Earlier `hci-*` implementation screenshots document the preceding HCI pass. See [current QA status](../design-qa.md).
