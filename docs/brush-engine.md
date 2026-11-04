# Brush engine

The Brush tool has 18 presets grouped into Basic, Artistic, and Special brushes.
Choose a preset in the existing options bar. Selecting a preset restores its
recommended settings; the foreground color is preserved. Size, hardness, opacity,
flow, and spacing remain in the options bar. The Settings popover provides a live
stroke preview, applicable texture/scatter/nib controls, pressure toggles, and
custom dash lengths. Reset restores the current preset's defaults.

Opacity caps the whole gesture; flow controls pigment deposited by each dab.
Airbrush and Spray Paint also deposit every 40 ms while held still. A mouse uses
constant pressure. A pen can control size and ink strength independently. Pixel
Brush uses integer square marks and inclusive integer lines; its size rounds to
whole source pixels. Spacing and dash lengths are relative to brush diameter.
Watercolor, oil, and dry media use procedural pigment/texture approximations;
this is not a fluid or physical paint simulation.

## Ownership and extension

- `src/raster/BrushPresets.ts` defines typed presets, recommended settings, and
  finite numeric limits. Add a preset here using an existing tip, or add a new
  `BrushTip` and its rasterization behavior.
- `src/raster/BrushTip.ts` is independent of Vue, PixiJS, and browser globals. It
  emits bounded pixel coverage for a single dab. Stable seeded noise makes
  particles reproducible within a stroke and keeps grain consistent across dabs.
- `src/raster/RasterStroke.ts` snapshots settings, interpolates source-space
  positions and pressure, carries spacing/dash phase across pointer events, and
  composites tip coverage through the existing selection/mask and tile patches.
  Redo restores recorded pixels rather than regenerating random tips.
- `src/tools/EditorToolController.ts` owns the airbrush animation frame and
  cancels it on commit/abort, including pointer cancellation, tool changes,
  focus loss, disposal, and document suspension. Catch-up deposition is bounded.
- `src/stores/ui.ts` owns transient brush configuration; it is not document data.
  Erasing uses a round tip, independent of the selected painting preset.
- `src/components/editor/BrushSettings.vue` owns the compact settings popover and
  preview. It uses the same tip rasterizer and throttles previews to animation
  frames while the popover is open.

Every gesture uses the existing raster command: one undo action with changed
pixel patches, source memory accounting, full-resolution transparency, and exact
redo. Cancelled strokes restore their original pixels and source references.
No project format or dependency changes are required.

## Validation

`tests/unit/BrushEngine.test.ts` checks presets, numeric bounds, material
coverage, pressure, rotated nibs, pixel alignment, deterministic particles,
spacing, and dash periods. `tests/e2e/brush-presets.spec.ts` checks all presets
through real pointer gestures and decoded PNG exports, exact undo/redo,
stationary airbrush buildup/cancellation, and settings/reset interactions.
`tests/e2e/brush-pencil.spec.ts` preserves the existing brush/pencil regressions.
