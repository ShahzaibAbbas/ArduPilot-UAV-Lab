---
name: Aerospace Workbench
colors:
  surface: '#f7f9ff'
  surface-dim: '#cadcf0'
  surface-bright: '#f7f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#edf4ff'
  surface-container: '#e2efff'
  surface-container-high: '#d8eaff'
  surface-container-highest: '#d2e5f9'
  on-surface: '#0a1d2c'
  on-surface-variant: '#3d4946'
  inverse-surface: '#213242'
  inverse-on-surface: '#e7f2ff'
  outline: '#6d7a76'
  outline-variant: '#bdc9c5'
  surface-tint: '#006b5d'
  primary: '#00685b'
  on-primary: '#ffffff'
  primary-container: '#008373'
  on-primary-container: '#f4fffb'
  inverse-primary: '#71d8c4'
  secondary: '#006780'
  on-secondary: '#ffffff'
  secondary-container: '#76dcff'
  on-secondary-container: '#006077'
  tertiary: '#8d4b00'
  on-tertiary: '#ffffff'
  tertiary-container: '#b15f00'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#8ef5e0'
  primary-fixed-dim: '#71d8c4'
  on-primary-fixed: '#00201b'
  on-primary-fixed-variant: '#005046'
  secondary-fixed: '#b7eaff'
  secondary-fixed-dim: '#6cd3f7'
  on-secondary-fixed: '#001f28'
  on-secondary-fixed-variant: '#004e61'
  tertiary-fixed: '#ffdcc3'
  tertiary-fixed-dim: '#ffb77d'
  on-tertiary-fixed: '#2f1500'
  on-tertiary-fixed-variant: '#6e3900'
  background: '#f7f9ff'
  on-background: '#0a1d2c'
  surface-variant: '#d2e5f9'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.375rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.125rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
    letterSpacing: 0.005em
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: -0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: -0.005em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '400'
    lineHeight: 0.75rem
    letterSpacing: 0em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.5rem
  gutter-loose: 1rem
  margin: 0.75rem
  margin-panel: 0.5rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system targets aerospace systems engineers, UAV flight operators, avionics integrators, and autonomous robotics researchers. It balances the austere authority of flight mission consoles with the functional density of modern mechanical and electrical CAD environments.

The visual style is **High-Density Technical Precision**:
- High-efficiency screen real estate utilization with minimal decorative chrome.
- Clear structural division between system-level orchestration (dark ink/slate navigation shell) and detailed schematic/model workspaces (crisp, high-contrast light panels).
- Utilitarian instrumentation metaphors: live bus monitors, servo telemetry readouts, parameter trees, and spatial coordinate grids.
- Absolute clarity and immediate cognitive parsing over decorative flair. Contrast levels strictly observe mission-critical legibility.

## Colors

The palette employs a hybrid shell-and-canvas paradigm: a commanding deep ink shell encapsulates a luminous technical workbench.

### Primary Role & Hierarchy
- **Primary Teal (`#0b8b7a`)**: Operational state confirmations, active tool highlights, primary action triggers, and locked-in telemetry axes.
- **Secondary Cyan (`#0891b2`)**: Vector overlays, CAD coordinate handles, dynamic telemetry feedback, and cross-reference links.
- **Tertiary Amber (`#d97706`)**: Hardware cautions, parameter overrides, pre-arm status alerts, and signal degredation warnings.
- **Success Green (`#16a34a`)**: All-systems-nominal checks, GPS fix locks, calibration success, and verified hardware links.
- **Critical Red (`#dc2626`)**: Hardware faults, failsafe triggers, signal loss, and geofence breaches.

### Surface & Border Architecture
- **Navigation Shell**: Primary navigation, title bar, and command ribbon sit on `#132534` with sub-layer elements at `#0e1b27`.
- **Canvas Base**: Viewports and schematics render over `#f8fafc` fading into `#f1f5f9` with an integrated `#e2e8f0` grid.
- **Floating / Docked Panels**: Pure `#ffffff` surfaces bordered with crisp 1px strokes of `#e2e8f0` (resting) and `#cbd5e1` (interactive or active selection).
- **Text & Glyph Hierarchy**: High-contrast slate typography (`#0f172a` for high-emphasis data, `#475569` for secondary metrics, and `#94a3b8` for passive units and labels).

## Typography

Typography prioritizes information density and immediate numerical scanning:

- **Inter**: Structural hierarchy, tool labels, navigation trees, system modal dialogues, and contextual property inspectors.
- **JetBrains Mono**: Telemetry readouts, vector coordinates (X, Y, Z, Yaw, Pitch, Roll), PWM channels, hex registers, bus metrics, and operational command terminal outputs. Tabular figures must remain forced (`font-variant-numeric: tabular-nums`) across all data displays to eliminate jitter during active updates.
- **Sizing Discipline**: Standard body heights are scaled down to 13px (`0.8125rem`) and 12px (`0.75rem`) to maximize visible telemetry parameters without compromising readability.

## Layout & Spacing

The layout operates as an adjustable, dockable workbench interface consisting of three unified layers:

1. **System Command Ribbon & Navigation Rail**: Fixed 48px header and collapsible 56px icon/text rail on the `#132534` substrate.
2. **CAD Multi-Viewport Canvas**: Responsive central area containing interactive 2D/3D views, telemetry overlays, and coordinate axes.
3. **Dockable Inspector Palettes**: Configurable sidebars (default 320px width) housing parameter trees, sensor graphs, and hardware hierarchies.

### Spacing Philosophy
- Grid divisions enforce a dense 4px base increment.
- Margins and paddings default to compact boundaries (`space-xs` = 4px, `space-sm` = 6px, `space-md` = 8px) ensuring parameters fit into single-row data pairs without vertical overflow.
- Gutters between docked inspector cards are kept at a tight 8px (`gutter`) to ensure continuity across related avionics modules.

## Elevation & Depth

Visual hierarchy uses physical CAD panel layering and micro-elevation rather than heavy diffuse blur:

- **Level 0 (Canvas Ground)**: `#f8fafc` technical grid canvas with structural 1px grid intersections spaced at 16px and 64px intervals in `#e2e8f0`.
- **Level 1 (Docked Inspector Cards & Toolbars)**: Solid `#ffffff` background with 1px border `#cbd5e1`. Elevation shadow: `0 1px 2px 0 rgba(19, 37, 52, 0.05)`.
- **Level 2 (Active Toolbars, Flyouts & Context Menus)**: `#ffffff` surface, 1px border `#94a3b8`. Elevation shadow: `0 4px 6px -1px rgba(19, 37, 52, 0.1), 0 2px 4px -2px rgba(19, 37, 52, 0.06)`.
- **Level 3 (Diagnostic Dialogs & Modal Overlays)**: `#ffffff` surface with a primary accent top border (2px `#0b8b7a`). Elevation shadow: `0 10px 15px -3px rgba(19, 37, 52, 0.15), 0 4px 6px -4px rgba(19, 37, 52, 0.1)`.
- **Focused State**: Hardware components or viewport handles selected by the engineer gain an exterior 2px ring: `0 0 0 2px rgba(11, 139, 122, 0.35)`.

## Shapes

The interface balances sharp technical precision with modern ergonomic refinement using an 8px (`0.5rem`) primary baseline:

- **Panels, Windows, & Cards**: 8px (`rounded`) corner radius.
- **Buttons, Segmented Switchers, & Inputs**: 4px (`rounded-sm`) to maintain tight edge fidelity in high-density parameter grids.
- **Telemetry Indicators, Tags, & Status Badges**: 4px radius with strict 1px inset borders.
- **Tool Handles, Coordinate Points, & Spline Anchors**: 0px (sharp squares) or 100% round circles to distinguish canvas-drawn geometries from workbench UI frames.

## Components

### Buttons & Interactive Controls
- **Primary Action (Arm, Calibrate, Commit)**: Solid `#0b8b7a` background, white label, 4px border radius. Hover: `#097365`. Active: `#07594e`.
- **Secondary / CAD Utility**: Solid `#ffffff` surface, 1px border `#cbd5e1`, slate `#132534` text. Hover: `#f1f5f9` with border `#94a3b8`.
- **Destructive / Emergency Stop**: `#dc2626` background, high-contrast white text with immediate focus indicators.

### Data Inputs & Parameter Fields
- **Compact Property Cells**: Split label-value layout with 24px height. Label fixed in Inter 11px uppercase (`#64748b`); value editable in JetBrains Mono 12px (`#0f172a`). Background `#f8fafc`, transitioning to `#ffffff` on active edit with a 1px `#0b8b7a` border.
- **Steppers & Slider Inputs**: Integrated numerical display with micro-increment scrub handles and direct mono text input fallback.

### Status Badges & Telemetry Chips
- **Nominal State**: `#f0fdf4` surface, `#16a34a` border and text, featuring a leading 6px pulsing dot.
- **Warning State**: `#fffbeb` surface, `#d97706` border and text.
- **Error / Loss State**: `#fef2f2` surface, `#dc2626` border and text.
- **Telemetry Chips**: Dark ink badge (`#132534`) with cyan (`#0891b2`) or teal (`#0b8b7a`) mono labels displaying real-time rates (e.g., `50 Hz`, `115200 BAUD`).

### Cards & Inspector Panels
- **Header**: Compact 32px height, slate `#f8fafc` background, 1px border-bottom `#e2e8f0`, Inter 12px semi-bold uppercase label, trailing tool actions.
- **Body**: Minimal interior padding (`8px`), direct grid or tabular layout with divider lines rendered in 1px `#f1f5f9`.

### Specialized Aerospace Widgets
- **Attitude / Horizon Indicator Overlay**: Precision 1px cyan and white vector overlays with a semi-transparent dark HUD layer (`rgba(19, 37, 52, 0.75)`).
- **Servo Bus Matrix**: Dense row listing containing PWM sliders, live pulse-width micro-labels in JetBrains Mono, and physical channel indicators.