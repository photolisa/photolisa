# Vector and shape editing

Photolisa keeps vector geometry in the document model and renders it with the existing Pixi renderer. Vue controls send commands; geometry, paint, selection, clipboard, and transform services do not depend on Vue.

## Tools and interactions

- The shape flyout includes rectangles, rounded rectangles, circles, ellipses, polygons, triangles, lines, arrows, stars, and custom presets. Shift constrains shapes; Alt draws from the center. Lines and arrows snap to 45-degree increments with Shift.
- The creation-mode control can add a new subpath to the active vector layer, using its existing paint. New shapes can also be inserted into a selected group.
- Stars retain editable point count and inner radius. Polygons retain their side count. Rectangles retain corner radii. Save a selected vector as a custom preset to reuse it in other projects; presets are kept in browser storage.
- `P` selects Pen, `U` selects Rectangle, and `A` selects Direct Selection. Pen clicks create corners, drags create Bézier handles, clicking the first anchor closes a path, Enter finishes an open path, and Escape discards the draft. The curvature and freeform tools create editable cubic curves.
- Path Selection supports Shift selection, a marquee, moving multiple shapes, Alt-drag duplication, overlap cycling with Ctrl/Cmd-click, and keyboard nudging (Shift nudges by ten pixels). Direct Selection moves anchors and handles; Alt separates handles. Drag a segment to bend its controls without moving its endpoints; Alt-click a segment inserts an anchor through exact cubic subdivision.
- Properties can convert shapes to paths, reverse/open/close paths, convert anchors to smooth or corner points, split at an anchor, and join open subpaths within one layer or across selected sibling layers.
- Transform has eight resize handles and a rotation handle. Shift preserves proportions or snaps rotation; Alt resizes from the center. Transform origin is configurable. Shared transforms for multiple selected vectors use affine matrices without rewriting their curves. Enter applies, and Escape cancels.

## Paint, operations, and layers

Fill supports solid colors, transparency, linear/radial gradients, stops, angle, position, and opacity. SVG gradient transforms, focal points, and stop opacity are retained. Stroke supports width, opacity, alignment, caps, joins, custom dash arrays, arrowheads, and a scaling switch. Sample Fill and Sample Stroke use the existing eyedropper as a one-shot property edit.

Alignment includes selection/canvas edges and centers, center distribution, equal spacing, and matching dimensions. Snapping uses canvas and other objects' edges/centers. Grouping, ungrouping, ordering, flips, and rasterization reuse existing layer/history commands. Ungrouping a transformed group preserves child positions.

Union, subtract, intersect, exclude, and divide create live boolean groups. Their source vector layers remain available in the layer tree. Editing a source recomputes the result. Flatten explicitly replaces the group with an editable compound path. Results are cached while source geometry, paint, visibility, and transforms remain unchanged.

Ctrl/Cmd-C, X, and V use an internal vector clipboard when vector layers are selected without a pixel selection. It preserves geometry, paint, and ancestor transforms between open documents. Existing pixel-selection clipboard behavior takes precedence when a pixel selection exists. Native projects retain paths, gradients, parametric shape data, affine transforms, and boolean source trees.

## SVG and safety

Import supports rect, circle, ellipse, line, polygon, polyline, path, groups, viewBox, affine transforms, and fill gradients. Export supports the whole document or the selected layer trees; vector paths and paints remain vectors. Existing raster layers are embedded as PNG data when exporting a mixed document.

Scripts, executable elements, event handlers, DTDs/entities, external resources, and external CSS are rejected. Safe paint references refer only to local gradient IDs. Source size, coordinates, path grammar, gradient stops, document dimensions, and boolean complexity are bounded before expensive work. Rasterization retains the existing allocation checks.

## Implementation map

- `core/vector/`: Bézier/path geometry, grammar validation, paint coordinates, path edits, affine transforms, alignment, boolean caches, clipboard, and reversible paint previews.
- `core/commands/`: shape/paint commands, boolean grouping/flattening, and matrix transform history.
- `tools/`: shape geometry and focused vector/multi-selection interaction controllers alongside the existing tool controller.
- `renderer/`: GPU vector contours, explicit hole cutouts, gradient ramps, and high-DPI frame-scheduled overlays. Raster paint and thumbnails share the gradient implementation.
- `components/editor/`: compact flyouts, contextual controls, geometry, paint, and operations panels.
- `persistence/VectorShapeLibrary.ts`: validated reusable custom presets.

Paper.js core is used only for geometry (SVG path parsing, exact curve bounds, and robust Bézier booleans). Pixi remains the canvas renderer. GPU gradient ramps use bounded 256×256 textures; vector contours are never rasterized during editing. Owned gradient textures and vector graphics contexts are released when displays are replaced. Geometry edits replace only affected vector displays; interaction redraws are batched through requestAnimationFrame.

## Current boundaries

- Alignment targets selection or canvas. The editor has no artboard model.
- Joining separate paths requires sibling layers. Boolean groups likewise operate on sibling vector layers.
- Imported SVG text, patterns, filters, masks, arbitrary clipping, gradient inheritance through href, and stroke gradients are outside the editable subset. Unsupported passive elements are reported; external/executable content is rejected.
- SVG export preserves boolean appearance as compound paths; the live source group is retained in native `.photolisa` projects.
- Stroke non-scaling uses the affine determinant as an effective scale; anisotropic/skewed transforms do not have a single exact stroke-width scale.
- Mouse workflows are exercised in Chromium. Pointer events support touch and stylus, but physical touch/stylus hardware and other browser engines have not been validated.
- A 60 FPS guarantee for hundreds of objects has not been established by a benchmark.

## Validation

The final checks passed TypeScript, ESLint, all 118 unit tests, the production build, and 24 Chromium workflows covering vectors plus raster, text, layers, and tabs. Vector browser tests verify anchor/handle movement and deletion, gradients through GPU pixel sampling, inside/outside stroke clipping, boolean flatten/undo, star parameters, shared transforms and pointer cancellation, custom presets, native save/reopen, and cross-document vector paste. The build retains Vite's warning about the editor chunk exceeding 500 kB.
