# Photolisa architecture

All application source lives in `src/`. The editor domain (`src/core`) does not import Vue, Pinia, PixiJS, browser adapters, or DOM APIs. Vue observes the core through typed events and sends document mutations through commands. Browser-dependent commands implement the same command interface from `src/raster/commands`.

## Repository layout

```text
src/
  main.ts, App.vue, router.ts  Application entry and routing
  app/                        Application-owned service instances
  assets/                     Bundled CSS and images
  views/, components/         Vue presentation
  composables/, stores/, ui/  Vue coordination, UI state, and presentation helpers
  core/                       Framework-independent editor domain
    geometry/                 Layer coordinates and affine transforms
    commands/                 Metadata commands and history
  raster/                     Canvas, pixel assets, workers, and pixel commands
  renderer/                   Pixi scene, viewport, and interaction overlays
  tools/                      Browser input and editing gestures
  adapters/                   File validation, decoding, and encoding
  persistence/                IndexedDB and autosave
tests/                        Unit, browser, and benchmark suites
public/                       Files served unchanged
docs/                         Design and compatibility documentation
```

Vite's web root remains the repository root: `index.html` loads `/src/main.ts`, and `public/` retains its URLs. Both `@/` and `~/` resolve to `src/` for existing UI imports. Engine modules use relative imports so their resolution does not depend on Vite aliases. Test fixtures that import source modules through the development server use `/src/…` URLs.

`pnpm typecheck` checks the complete Vue application and then compiles `src/core` with `tsconfig.core.json`, without DOM or Vite types. Architecture unit tests reject core dependencies outside the domain (apart from Paper's geometry library), framework dependencies in engine modules, and engine imports from UI modules. Type-only imports are included in these boundary checks.

## Layers

- **Application (`app`)** — composition of shared services, currently the persisted color-library session. Browser storage is opened after mount.
- **UI (`views`, `components`, `composables`, `stores`, `ui`)** — the router loads the editor view, focused components render desktop chrome and dialogs, and composables coordinate editor sessions and file actions. `useCanvasWorkspace` owns the canvas integration lifecycle; `CanvasWorkspace.vue` owns presentation and forwards its existing public actions. Pinia contains only small UI values such as active tool and zoom.
- **Editor core (`core`)** — plain TypeScript documents, discriminated layer types, commands, command history, and a typed event bus. This layer is unit-testable in Node.
- **Renderer (`renderer`)** — owns PixiJS applications, GPU display objects, viewport transforms, and cleanup. It receives document snapshots without owning domain state.
- **Raster processor (`raster`)** — owns browser canvas surfaces and pixel reads. Large buffers stay here rather than in Pinia. Image resize, mask creation, and vector rasterization commands live in `raster/commands` because they allocate canvas assets; they still execute through `EditorCore` and the same bounded command history.
- **File adapters (`adapters`)** — browser image encoding/decoding boundaries.
- **Persistence (`persistence`)** — `idb`-backed IndexedDB project manifests and binary assets in separate stores, plus debounced recovery autosaves.

## Decisions

### Commands own mutations

Every undoable document change implements `Command`. `CommandHistory` is the only normal execution path, keeping undo/redo deterministic and making future dirty-state tracking straightforward.

`LayerManager` is the sole mutation surface for the recursive layer tree. Raster, vector, and group layers share stable IDs, transforms, opacity, visibility, locks, and blend modes. Vector layers store typed geometry and paint values rather than a bitmap; `SetVectorStyleCommand` and `SetVectorGeometryCommand` change those values without touching pixel assets. Commands retain only metadata objects and pixel-source IDs, so common edits never duplicate full-resolution buffers. Document serialization clones this metadata tree in-order and preserves every layer ID.

### Browser resources have explicit owners

The Pixi renderer is created only after Vue mounts. It owns its `Application`, display objects, canvas, and `ResizeObserver`, and destroys all of them on unmount. Canvas pixel resources will follow the same ownership rule.

Imported `ImageBitmap` and editable canvas instances are owned by `RasterSourceRegistry`, keyed by the lightweight `pixelSourceId` stored in a raster layer. The first pixel edit uses copy-on-write when a source is immutable or shared by duplicated layers, so editing one layer cannot mutate another. Zoom and panel resizing change only Pixi transforms and renderer dimensions; original image dimensions and bitmap pixels are never resampled. `Viewport` keeps CSS-screen coordinates separate from document pixels, while the Pixi renderer applies device-pixel ratio only to its backing surface.

### Pixel history is tiled

A brush, pencil, or eraser gesture is one command. Before the first dab touches a 128×128 tile, the raster processor captures that tile once; the completed command retains only the changed before/after region of touched tiles. Brush coverage accumulates from flow and pressure inside each stroke, then the stroke opacity caps the final composite against each tile's original pixels. Pencil uses integer pixel interpolation and a hard, square pixel tip, so it never introduces soft edge anti-aliasing. Escape, pointer cancellation, focus loss, and tool switches restore the captured tiles; pointer-up commits one command. Metadata commands retain transforms or scalar values rather than document snapshots. `CommandHistory` supports transactions and bounds retained undo and redo data by both entry count and estimated bytes.

Pointer input is converted from browser client coordinates to document coordinates by the renderer before it reaches a tool. The raster processor then applies the inverse layer transform to reach source-pixel coordinates. This keeps painting, selections, crops, and transforms stable at every viewport zoom and device-pixel ratio.

The optional pencil grid and drawing cursor are rendered in a separate client-only overlay. They are not exported and do not modify source pixels. The grid appears at 400% zoom or higher to avoid an unreadably dense overlay. Primary and secondary colors are small UI values; X swaps them. A sampled foreground alpha is honored for new brush and pencil strokes, while Brush/Pencil opacity remains a separate control.

### Adjustments are document data, not rendered pixels

Raster layers own an ordered list of discriminated `LayerAdjustment` values. Each value has a stable ID, enabled state, filter kind, and normalized JSON-safe parameters. `FilterRegistry` holds the ten independent filter definitions and a deterministic pixel-reference implementation; neither the document nor history stores Pixi filters, canvases, or generated pixels.

`AdjustmentPreviewSession` temporarily updates this small parameter stack for live feedback. Apply records one `SetLayerAdjustmentsCommand`; Cancel restores the original stack. Reorder, enable/disable, reset, and removal also retain only adjustment metadata, so the layer's source pixel reference is never replaced.

The Pixi adapter translates enabled adjustments into ordered GPU filters. Color operations use color matrices, Gaussian blur uses Pixi's multipass blur, and Levels and Sharpen use custom WebGL shaders. Preview refreshes are coalesced with `requestAnimationFrame`; source texture uploads are gated by raster-source revisions, and each render records its duration.

The renderer shares one texture set per pixel source, splitting oversized sources into hardware-safe tiles. Raster edits carry dirty source rectangles so only affected tile uploads are refreshed. Visible small groups may cache their composite; descendant changes invalidate that cache. The renderer pauses its frame queue while the tab is hidden and rebuilds live textures after WebGL context restoration. See [performance benchmarks](./performance-benchmarks.md) for measurements and remaining limits.

Full-resolution export starts from the source bitmap/canvas, applies the same normalized stack in a worker, and composites layers with document transforms, opacity, and blend modes. A bounded intermediate canvas cache is keyed by source revision plus parameters. This avoids GPU readback and guarantees export dimensions come from the document rather than the viewport.

### Domain objects remain non-reactive

`EditorDocument` is a regular TypeScript class. Vue receives it through a `shallowRef`; nested document state is never proxied. The core event bus is the synchronization boundary.

### Project sessions and cross-project transfers

`DocumentManager` owns one persistent `EditorCore` per open project. Tab switches exchange the active core without rebuilding the Pixi application or editor tool controller. Tool, selection, and viewport state are session-local; each core retains its own command history and dirty flag. Recently closed sessions remain in a bounded in-memory list for reopening. Closing a tab does not delete its document or pixel assets; a later browser reload requires a saved project or autosave recovery.

`LayerTransferService` is framework-agnostic. It collects selected roots in document stacking order (children of a selected group are not transferred twice), clones only layer metadata, assigns new layer and adjustment IDs, then delegates pixel references to an injected asset bridge. The browser bridge shares immutable `ImageBitmap` sources and privately copies editable canvas sources to prevent cross-project paint edits. Original document-space positions are retained by default; the center option shifts top-level transforms by half the difference in canvas dimensions.

Transfers use a destination `CopyLayersCommand` and, for moves, a source `MoveLayersCommand`. Copy keeps root names, Duplicate adds a ` copy` suffix, and Move removes the source roots after destination insertion. Both document transactions are prepared before source removal, and a failed operation rolls back inserted layers and new assets. Histories remain per-document: undo in the destination removes received layers, while undo in the source restores moved originals. Undoing both sides fully reverses a move. The service does not yet link these two history cursors into one global undo step.

### Files are validated at trust boundaries

The native `.photolisa` container starts with a fixed magic value and a bounded, versioned JSON manifest. Pixel assets are individually described and stored as binary PNG payloads after the manifest. Loading validates manifest size, unique IDs, offsets, non-overlap, decoded dimensions, and aggregate budgets before any bitmap is created. IndexedDB uses the same manifest while keeping every asset in its own record, so autosave does not put pixel buffers into Vue or Pinia.

PSD import uses a cheap 26-byte header preflight, followed by a structure-only ag-psd parse, budget validation, and only then pixel decoding. Compatibility losses are explicit data returned by the adapter and displayed in the UI. See [PSD compatibility](./psd-compatibility.md).

SVG import uses `DOMParser` only on the client. `SvgImporter` rejects DTDs, active elements, event handlers, links, external resources, and URL-bearing values before converting the supported shape subset into native vector layers. `SvgExporter` serializes the document tree directly, embedding raster layers as PNG data. Pixi `Graphics` objects and Canvas 2D export are separate views of the same editable geometry. See [SVG compatibility](./svg-compatibility.md).

`IcoAdapter` validates the Windows ICO directory, every payload bound, declared dimensions, and an aggregate decoded-pixel budget before decoding. The user chooses one embedded resolution; for BMP entries the MIT-licensed `icojs` decoder receives a newly constructed single-entry ICO, so it never decodes unrelated resolutions. PNG entries use browser image decoding. Export flattens the document at its source resolution, downsamples in high-quality stages, and writes a real multi-entry ICO with separate transparent PNG payloads. ICO import is a raster import: opening one resolution does not preserve the other embedded resolutions as editable layers. See [ICO compatibility](./ico-compatibility.md).

### Tool interactions stay outside Vue

`EditorToolController` owns pointer gestures and keyboard confirmation/cancellation. Vue components expose settings and route commands but contain no pixel or geometry logic. `InteractionOverlay` is a separate transparent canvas for selections, crop bounds, and transform handles, keeping transient interaction graphics out of both the document model and Pixi scene.

Five shape tools implement a common TypeScript interface. A drag is previewed only in `InteractionOverlay`; pointer-up creates one native vector layer through `AddShapeCommand`, while Escape or interrupted input discards the preview. Shift constrains the bounding box and Alt/Option expands it about the starting point. Shape geometry and style are ordinary serializable document data, so native save/reopen and SVG export retain their editability. Property changes use geometry/style/transform commands, and the existing transform handles operate on selected vector layers. `RasterizeVectorCommand` explicitly converts a supported shape into a local pixel asset, limited to 128 MiB, while retaining its original vector layer for undo. The command accounts for the raster asset in the history budget and releases an undone asset when its history entry is discarded. SVG paths, vector effects, masks, and SVG matrices are rejected for per-layer rasterization rather than silently flattened.

The eyedropper converts client coordinates through `Viewport` to integer document pixels, then extracts a 9×9 region at resolution 1 from Pixi's document scene. Hover reads are limited to one per animation frame; no full viewport framebuffer is downloaded. The checkerboard and outline are excluded, so alpha-zero pixels remain transparent. Active-layer mode temporarily excludes other layer displays during extraction and restores renderer visibility immediately afterward. Cached ancestor groups are disabled for the duration of active-layer sampling so hidden siblings cannot leak into its color. The sampled RGBA value and twelve recent swatches are small UI values, not document edits, and therefore are not part of document undo history.

Sampling reports the renderer's 8-bit RGBA output after browser image decoding and active GPU adjustments. The app does not currently offer explicit ICC-profile conversion, linear-light sampling, HDR/wide-gamut values, or proof-color matching; HEX/RGBA are the displayed 8-bit values. The brush's existing opacity control is independent of the sampled alpha channel.

### Colors are a separately persisted library

`ColorManager` is a framework-independent owner of foreground/background RGBA values, bounded color history, favorites, and named swatch collections. It validates channels and collection limits, assigns stable swatch IDs, and exposes a serializable snapshot. It does not reference documents, pixel buffers, Pixi, or Vue. `BrowserColorStorage` saves the versioned snapshot in a dedicated IndexedDB database; ordered writes prevent an older snapshot from replacing a newer edit. The UI store mirrors the small snapshot for controls and surfaces persistence errors. Browser storage opens only after client mount.

Brush and pencil take RGB plus alpha from the foreground color. New vector shape fills use the same RGB and fill opacity; enabling shape stroke starts with the background color. The picker accepts HEX, RGB, RGBA, and HSL, with checkerboard transparency previews. X swaps colors and D restores opaque black/white. Built-in palettes are read-only; favorites and custom collections are editable and persist independently of project files. Color changes are UI preferences, not document mutations, so they do not enter document undo history.
