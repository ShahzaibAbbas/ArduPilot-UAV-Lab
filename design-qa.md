# Stitch export update QA — October 14, 2026

latest result: runtime workflow checks passed; export fidelity comparison remains pending

## Follow-up validation — October 15, 2026

A clean source copy installed with `npm ci`, passed TypeScript and the production build, and ran the complete regression suite: 260 tests, 256 passed, 4 platform-dependent skips, no failures. The two previously omitted launcher/runtime test files now run through `npm test`.

All seven browser smoke scripts passed: phase-1 workflows, workbench improvements, airframes, battery alerts, validation repairs, mission transfers, and companion controls. The checks covered 2D/3D selection and saved transforms, workspace round trips/search, synthetic firmware inspection and visual workflow, isolated trace exports, runtime API status, 13 airframe presets, and navigation at desktop, 900px and 390px widths. Companion and mission process actions used synthetic API fixtures; no physical flight, live SITL integration, Linux installation, or firmware flashing was performed.

Current desktop and mobile captures were inspected, and the browser scripts reported no uncaught page errors. The rendered captures and command logs are local evidence under the ignored `test-results/` folder. Exact comparison against the supplied Stitch export images remains separate work. The blocked preview and unavailable captures described below record the October 14 session, before this follow-up run.

Source upload cleanup removes duplicate CI templates, an unused SVG logo and unused `concurrently` dependency; generated `dist/` and `data/` files are no longer Git-tracked. Local editor settings, dependencies, build output, runtime data, keys and archives are excluded from source packages. Saved designs and existing recovery backups remain local.

GitHub preparation also normalized the Ubuntu and macOS launchers to LF line endings and added `.gitattributes` to preserve their Bash-compatible format. Both passed Git Bash `bash -n` without running installation or simulator actions.

## Current source truth

- Desktop: `docs/stitch/exports/screen-0/screen.png` (1280 × 984 pixels) and its `code.html` / `DESIGN.md`.
- Mobile: `docs/stitch/exports/screen-2/screen.png` (459 × 1600 pixels) and its `code.html` / `DESIGN.md`.
- Earlier dark desktop variant: `docs/stitch/exports/screen-1/screen.png` (1600 × 1280 pixels).
- Exact archive names and hashes: `docs/stitch/exports/manifest.json`.

The latest implementation uses the exported palette, local Inter/JetBrains Mono fonts, light desktop navigation, and navy mobile navigation. It preserves live application data and existing action semantics. The templates' demonstration graph values and telemetry are intentionally not copied into the working design.

## Evidence and limitations

Earlier rendered HCI evidence is saved in `docs/stitch/hci-desktop-reference.png`, `hci-desktop-implementation.png`, `hci-desktop-comparison.png`, `hci-domain-comparison.png`, `hci-mobile-reference.png`, `hci-mobile-implementation.png`, `hci-mobile-inspector.png`, `hci-mobile-tools.png`, and `hci-tablet-workbench.png`.

The desktop comparison uses 1440 × 900 captures at CSS density 1. Mobile captures use 390 × 844 at density 1. The earlier mobile canvas screenshot had a capture-width artifact; a default viewport capture corrected it. The supplied mobile raster has a different size and content density, so it must be normalized against a newly rendered matching state before any final fidelity claim.

Full-view and focused domain-panel comparisons were inspected for the preceding HCI pass. These screenshots predate the latest ZIP-specific color, font, badge, mobile-stage, and shortcut changes and cannot validate the current version.

On the final preview attempt, the browser approval gate rejected navigation to `http://127.0.0.1:5173`, stating that the user declined origin approval. No alternate browser, raw browser command, indirect renderer, or workaround was used after that rejection. A current screenshot and browser console check are therefore unavailable.

## Checks completed

- Production build and TypeScript checks pass.
- Regression suite: 255 tests, 251 passed, 4 skipped, no failures.
- Static review covers modal focus handling, keyboard propagation, compact panel routing, action selection states, and disabled-control styling.
- Font assets were checked for official source provenance, WOFF2 signatures, declared file lengths, variable-font tables, weight ranges, local paths, and OFL licenses.

Earlier browser interactions passed: tool filtering and empty states; library search/focus/Escape/restoration; foreground dialog Escape with the library open; 2D/3D Arrow and Home switching without changing node positions; 3D controls; issue-review open/close; mobile tool selection and focus restoration; direct domain review including Safety; and no document overflow at 1440, 900, 390, or 320 CSS pixels.

## Fidelity surfaces

- **Typography:** local Inter 400–700 and JetBrains Mono 400–600 are wired into the app; numerical fields use tabular figures. Final rendered wrapping and font loading await browser access.
- **Spacing/layout:** 220px tool sidebar and 360px inspector follow the desktop refinement; wrapping domain chips and 36–44px targets retain the usability improvements. Current mobile shortcut clearance needs visual confirmation.
- **Colors/tokens:** HTML-export navy `#213242`, teal `#00685b`, pale blue surfaces, and navy status bar are applied. Muted text retains the more legible existing contrast. Final rendered cascade needs visual confirmation.
- **Assets:** the real supplied brand logo and existing graph/3D renderers are retained. The ZIP screenshots remain reference artifacts, not rasterized application UI. Local font files replace external runtime font requests.
- **Copy/content:** actual component counts, checks, save state, workflow stage, and runtime status remain in use. No invented live telemetry or sign-off records are displayed. New/Reset keep their original behavior.

## Comparison and repair history

1. Keyboard review found that view-tab arrow events could also move selected nodes. The tab handler stops propagation and global shortcuts ignore prevented events; browser inspection confirmed unchanged node positions after switching views.
2. Compact review/runbook/edit actions could open an inspector that was hidden. The relevant actions now select the compact Inspector pane; earlier browser checks confirmed visible review/tool panels.
3. Background library Escape could consume a foreground dialog's Escape. The library handler yields to any open dialog; browser checks confirmed the menu closes while the library remains open, followed by library closure on Escape.
4. Earlier narrow-screen selectors hid headings and the runbook inside the mobile dialog. Stronger mobile-dialog overrides restore them; earlier DOM inspection confirmed every group and runbook.
5. Mobile history targets were too narrow and the 3D toolbar could collapse. History controls are 44 × 44px; the 3D toolbar is at least 54px and the scene at least 220px. Earlier browser measurements confirmed both.
6. ZIP-update static review found an overly broad Review pressed state and a teal override on disabled auto-fix. Review now selects only actual domain review; final primary token styles exclude disabled controls. These latest changes await rendered verification.

## Remaining verification

After browser access is allowed, capture the latest desktop and mobile implementations against the supplied ZIP images, check the five fidelity surfaces and console, exercise each mobile shortcut and tool-dialog focus restoration, and verify layout at 320, 390, 900, and 1440 pixels. Resolve any P0/P1/P2 findings before changing the final result to passed.
