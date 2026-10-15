# On-canvas object manipulation

The Move tool provides direct manipulation for raster, vector, text and group layers. Auto-select is enabled by default; the existing Auto-select checkbox still allows dragging the selected layer without changing the selection. Raster pixel selections remain available through the marquee/lasso tools.

## Interactions

| Action                | Interaction                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Select                | Click an unlocked object; Shift-click toggles membership.                                                                                      |
| Overlapping objects   | Ctrl/Cmd-click repeatedly cycles through overlapping unlocked objects.                                                                         |
| Object marquee        | Drag empty workspace; Shift adds intersecting objects. Clicking empty workspace clears object selection.                                       |
| Move                  | Drag a selected object. Shift restricts movement to one document axis.                                                                         |
| Nudge                 | Arrow: 1 document pixel; Shift-arrow: 10 pixels, including nested transformed groups.                                                          |
| Duplicate             | Alt-drag creates copies once movement begins. Duplicate and movement share one undo step.                                                      |
| Resize                | Eight handles. Shift preserves proportions; Alt uses the center; Shift+Alt combines both. Per-object aspect locks force proportional resizing. |
| Rotate                | Round handles outside each corner. Shift snaps the resulting angle to 15-degree increments.                                                    |
| Skew                  | Ctrl/Cmd-drag an edge or corner handle.                                                                                                        |
| Affine free transform | Ctrl/Cmd+Alt-drag a corner: move the corner while fixing the opposite edge.                                                                    |
| Transform origin      | Floating Transform menu offers center and corner origins; the existing tool origin setting is shared.                                          |
| Vector points         | Double-click a vector to enter existing anchor and Bézier-handle editing.                                                                      |
| Rectangle radius      | Drag the inset round Radius handle. Rectangles retain their parametric geometry.                                                               |
| Text                  | Double-click to edit in place. Ctrl/Cmd+Enter commits, Escape discards, blur commits.                                                          |
| Text resizing         | Transform menu: resize the wrapping text box or scale the font visually through the object transform.                                          |
| Images                | Double-click to crop. Resize handles change the clip frame; dragging inside repositions original pixels. Enter or Done crop exits.             |
| Cancel                | Escape, pointer cancellation, lost capture, window blur, canvas navigation or tool/document switch restores an unfinished gesture.             |

The floating controls offer Duplicate, Delete, Lock/Unlock, Group, Arrange, Transform and vector fill/stroke colors. Group is available for multiple sibling layers. Arrange sends selected roots to the front or back while retaining relative order. The controls and popup adjust to the workspace viewport.

## Snapping

Enable Snap to canvas in the existing options bar or Snap in the floating Transform menu. Snapping includes canvas edges/center, visible object edges/centers, optional grid spacing and custom horizontal/vertical guides. Tolerance is measured in screen pixels and converted through zoom. Grid size and guide coordinates use document pixels. Enter comma-separated guide positions in the menu. Nearest-neighbor spacing measurements appear while moving.

Locked layers and descendants of locked groups cannot be transformed. Locked objects remain valid alignment targets. Selected ancestors exclude their descendants from shared transforms to prevent double movement.

## Architecture and modified modules

- `core/transform/ObjectTransform.ts`: framework-independent affine frame, resize, rotation, skew, free-transform, snapping and state functions.
- `core/transform/ImageCrop.ts`, `SmartGuides.ts`: crop constraints and nearest-neighbor spacing geometry.
- `core/commands/ObjectTransformCommand.ts`: one mixed-layer transform command per gesture, including crop/text-box state; undoable aspect locks.
- `tools/ObjectManipulation.ts`, `ObjectBounds.ts`, `ObjectHandles.ts`, `ObjectInteractionState.ts`, `ObjectSelectionGeometry.ts`: Pointer Event adapter, frame scheduling, object selection, mixed selection transforms, contextual actions and coordinate-aware bounds. Snap candidates are captured once per gesture; selection bounds only measure selected objects.
- `tools/ObjectGesturePreview.ts`, `ObjectContextActions.ts`, `ObjectManipulationOverlay.ts`: focused preview, undoable contextual-command and screen-overlay adapters.
- `tools/OnCanvasTextEditor.ts`: native accessible textarea placed using the full world matrix and viewport coordinates.
- `tools/EditorToolController.ts`, `VectorToolController.ts`, `MultiVectorTransform.ts`: connects direct manipulation and explicit double-click editing, capture, navigation and cancellation to existing tools. Existing explicit Transform and document Crop tools remain available.
- `components/editor/ObjectToolbar.vue`, `CanvasWorkspace.vue`, `stores/ui.ts`: compact contextual UI and snapping/text-layout preferences.
- `core/model/types.ts`, `EditorDocument.ts`: optional aspect locks, wrapping text-box dimensions and raster clip-frame metadata, validation and deep serialization.
- `renderer/InteractionOverlay.ts`, `PixiViewportRenderer.ts`, `LayerThumbnailRenderer.ts`: bounds, handles, readable feedback, guides, spacing and shared-texture GPU clip frames. Crop previews update masks and content offsets without resampling or replacing original textures.
- `raster/TextPainter.ts`, `ImageCrop.ts`, `LayerCoordinates.ts`: shared text wrapping and crop export/paint coordinates.
- `tools/LayerHitTest.ts`, `MoveSnapping.ts`: cropped image bounds in existing hit testing and snapping.
- `adapters/ImageExportAdapter.ts`, `SvgExporter.ts`, `PsdAdapter.ts`: matching raster clip-frame output. Native documents retain original assets and optional model metadata. PSD export bakes transforms/crops as required by its existing export path.
- `core/commands/ImageResizeCommand.ts`: scales clip-frame metadata with deliberately resampled source dimensions and restores it on undo.
- `tests/unit/ObjectTransform.test.ts`, `ObjectManipulation.test.ts`, `ImageCrop.test.ts` and `tests/e2e/object-manipulation.spec.ts`: geometry, history, cancellation, interaction, source-preservation and export coverage. Existing vector tests now focus the canvas without clicking empty workspace when they intend to retain a selection.

## Boundaries

Free transform is affine: it preserves editable source geometry/pixels and supports scale, rotation and shear. Perspective distortion and mesh warping are not included. Multi-object selection uses a shared document-axis frame; individual objects retain their own world transforms. Text-box resizing applies to a single selected text layer; mixed selection resizing scales all selected objects together. Spacing is measured between axis-aligned world bounds of separated neighbors.

Snapping settings and custom guides are workspace UI preferences for the current session. Original raster assets remain intact during object manipulation and cropping. Deliberate Image Resize remains a resampling operation with its existing restrictions on SVG matrices and nonuniformly resized rotated layers.
