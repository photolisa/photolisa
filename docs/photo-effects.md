# Photo effects

Open **Effects → Browse effects** or press **Ctrl/Command+Shift+F**. Select an unlocked raster layer or a regular group. The drawer leaves the image visible while you browse, edit, compare, and apply a stack.

- Search the library or filter by category. Clicking an effect previews its actual processor on the canvas. Library thumbnails use the selected raster source (a sample photograph for empty layers/groups); neutral adjustments use illustrative thumbnail parameters.
- In **Stack**, select an effect to edit its sliders or numeric fields. Toggle visibility, reorder, remove, reset, or change its opacity and blend mode.
- **Preview** compares your draft with the previously committed stack. **Show Before** displays the original layer without effects. **Apply** records one history entry for the complete draft; **Cancel**, Escape, and closing the drawer restore the committed stack.
- A raster selection is captured in source coordinates when a new effect is added with **selected area only** enabled. Moving or changing the selection afterward does not alter the effect's saved mask. Existing effects retain their saved coverage. Selection effects support a source of up to 16 megapixels and 1 million coverage runs; a message explains oversized/overly complex selections.
- **Presets** offers built-in looks and locally stored favorite combinations. Presets remain editable stacks. Image-specific selection masks are excluded from reusable looks. Up to 50 custom presets, 64 effects per stack, and 4 MB of preset data are supported. Storage errors are shown without discarding the draft.
- Color Lookup supports `.cube` 3D LUT files with 2–33 samples per axis, RGB domain 0–1, and trilinear interpolation. The initial LUT is a warm look. LUT data is embedded in projects and presets; no external file is needed on reopening.

## Implementation

The existing `src/core/filters` registry and `LayerAdjustment` union are extended rather than duplicated. `EffectCatalog.ts` defines parameter ranges and categories; `ColorEffects`, `BlurEffects`, `ArtisticEffects`, and `DistortionEffects` contain processors. All processors work on copied full-resolution RGBA buffers. Spatial interpolation/convolution uses premultiplied alpha to avoid hidden-color fringes. Deterministic grain/noise seeds keep renders reproducible.

Effects remain separate from `pixelSourceId`. Existing adjustment commands, ordered stacks, native project serialization, and autosave continue to own committed state. Preview sessions register their original stacks on the document; serialization substitutes those originals and preview changes do not mark a saved project dirty. Applying the draft removes the transient snapshot and records a command with its retained memory cost.

`EffectsPanel`, `EffectsLibrary`, `EffectStack`, `EffectControls`, `EffectPreview`, and `useEffectDraft` own presentation and temporary editing. Parameter changes coalesce for 40 ms. Worker preview requests coalesce per layer; stale completions are ignored. The selected document owns the preview lifecycle. Closing/switching documents disposes transient worker/source resources.

`EffectPreviewCache` asks `ImageExportAdapter` for full-resolution local content and uploads the resulting pixels into the existing tiled Pixi texture cache. Canvas previews and raster exports therefore share processing, crop, and mask order. Preview textures have a 128 MiB retention budget (one oversized layer may be retained on its own). Export's existing raster cache has a 64 MiB budget. `EffectPipelineCache` retains up to 64 MiB of source/intermediate stages, so changing a later effect can reuse an unchanged prefix.

The worker accelerates large point adjustments and Gaussian blur with WebGL2 where available. Gaussian blur uses float intermediate textures in bounded strips with source halos; glow, soft focus, clarity, unsharp mask, and tilt-shift reuse that blur. Shader/context/size failures fall back to deterministic CPU processing. Gaussian and box CPU blurs retain rolling rows rather than a full float image. More expensive artistic and spatial processors run in a worker. Pixel processing is still 8-bit sRGB, matching the current editor; it is not a RAW/16-bit color-managed Lightroom pipeline.

## Formats and compatibility

Photolisa projects preserve editable stacks, order, masks, opacity, blend modes, seeds, and LUTs alongside untouched raster assets. PNG/JPEG/WebP, ICO, and flattened PDF output use the common image exporter. PSD raster effects are baked into pixels; affected groups are baked into a raster layer so their appearance survives reopening, with compatibility notes. SVG export continues to reject effects it cannot represent rather than silently omit them. Save a native project to retain editability.

Liquify currently exposes a localized push with center, radius, and horizontal/vertical displacement controls. Perspective Warp exposes horizontal/vertical projective controls. These are real resampling effects; there is no freehand multi-pin Liquify brush or draggable perspective cage in this iteration. Lens blur uses a sampled polygonal aperture; surface blur is edge-aware smoothing. Limits and CPU fallback mean processing very large images with complex stacks can take time even though the worker keeps the UI responsive.

## Validation

- Unit coverage for every processor, neutral settings, transparency, opacity/blend/mask composition, malformed LUT/selection data, intermediate-cache isolation, draft serialization, and history.
- Browser coverage for library controls, visual canvas/drawer baselines, before/after, cancellation, custom presets, native save/close/reopen, selection coverage, PSD group output, every library effect's exported pixels, and GPU/CPU agreement.
- Existing adjustment and editor browser suites remain regression coverage for layer, mask, vector, tab, drawing, selection, and file workflows.
