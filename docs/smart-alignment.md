# Smart alignment and snapping

Choose the Move tool (`V`) and drag a layer. **Smart snap** is on by default and
can be disabled in the options bar. The tolerance defaults
to six screen pixels and can be changed from zero to forty; its visual capture
distance stays the same when zooming. A captured target stays magnetic until the
pointer passes 1.5 times the capture tolerance, preventing jitter between nearby
targets. Zero tolerance highlights exact matches.

During a move, pink guides mark matching canvas edges/centers and visible layer
edges/centers. Equal gaps between neighboring layers snap into place and show two
emphasized distance labels prefixed with `=`. Other nearby distances use ordinary
labels. Distances are document pixels, including fractional values. Hold Shift
to constrain a drag to its dominant axis. Snapping never changes the constrained
axis. Disable Smart snap for free movement. Grid spacing and custom guides remain
available in the floating toolbar's Transform options.

Select layers, then open **Align** in the floating object toolbar:

- Align left, right, top, bottom, or horizontal/vertical centers.
- Choose Selection bounds or Canvas as the reference. A single layer uses Canvas.
- With at least three editable layers, distribute centers or make horizontal or
  vertical gaps equal. The outermost layers stay fixed. Different layer sizes can
  produce different results for equal centers and equal gaps.

Raster, vector, text, and group layers share the same commands. Bounds are measured
in document coordinates after transforms; rotated layers use their axis-aligned
bounding boxes. A selected group and its selected children move only once. Hidden
layers and locked layers/ancestors are excluded from edits; visible locked layers
remain useful snapping targets. Multiple selected layers snap as one bounding box.
Equal-gap matching uses neighboring objects that overlap along the other axis.

Each drag or alignment action records one history entry. Escape cancels a live
drag without history; guides and distance labels clear when dragging ends. These
workspace overlays do not appear in exports. Alignment changes transforms rather
than resampling pixels, altering masks, or changing crop frames. No additional
bitmap buffers, textures, or dependencies are needed for snapping.

The reusable geometry lives in `src/core/transform/SmartSnapping.ts` and
`LayerAlignment.ts`. Browser interaction reuses the object tool's animation-frame
updates and cached target bounds. `AlignLayers.ts` prepares all changes before
executing an `ObjectTransformCommand`; failed validation cannot partially align
the selection.
