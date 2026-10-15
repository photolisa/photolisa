# Selection work — verified foundation

## Architecture audit

The previous marquee lived as one rectangle in `EditorToolController`; the tool controller also passed that rectangle directly to `RasterStrokeService`. `DocumentManager` kept a second rectangle per tab, so selection edits could not participate in command history. `InteractionOverlay` drew only a static bounding rectangle.

The reusable boundaries are `EditorCore` (one per project tab), `CommandHistory`, the client-only `InteractionOverlay`, and the raster stroke service's document-to-layer coordinate transform. The new selection state uses those boundaries rather than Vue/Pinia or the authoritative document layer tree.

## Foundation delivered

`SelectionMask` represents immutable 8-bit coverage in document coordinates. Rectangle creation preserves fractional edge coverage; new/add/subtract/intersect, select-all, and inversion operate on masks. A selection command records before/after masks in each project's history without marking its project file dirty. Raster strokes sample coverage after converting source pixels into document coordinates, so the active selection constrains brush, pencil, and eraser at any viewport zoom. Cropping clears the incompatible selection and restores it on undo. The rectangle gesture commits only on pointer-up; cancelled gestures leave history untouched.

The current overlay still shows a static bounding rectangle. Ellipse/lasso geometry, accurate mask contours and animated marching ants, Magic Wand/Quick Selection, feather/expand/contract, fill/copy/delete, and layer masks are later milestones. This foundation does not claim those tools are complete.
