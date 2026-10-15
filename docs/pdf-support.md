# PDF support

## Import

File > Open and canvas drag-and-drop accept real PDF files. PDF.js runs the parser in a dedicated worker. The import dialog displays cropped, rotated page dimensions in PDF points (1/72 inch), thumbnail previews, page-range selection (`1, 3-5`), password entry/retry, DPI presets or a custom value, and cancellation.

Each selected page becomes a transparent raster layer in a separate project tab, in original page order. The alternate destination inserts all selected pages as raster layers into the active project, with one undoable command. Layer placement is at the document origin, at the chosen pixel resolution; it does not resize the destination document. Existing cross-project copy/move controls work with imported pages and retain separate histories. Imported tabs store page number, rotated crop dimensions, rotation and DPI in native project metadata.

Import stages the selected canvases before changing projects. Cancellation or a rendering error discards staging buffers. Successful import releases the PDF worker and page resources; the editor retains the raster assets. Raster assets remain available to undo and the existing recently closed tab cache (five sessions); session eviction/destruction releases retained import assets. The existing editor may retain additional editing/clipboard assets independently.

## Export

File > Export As PDF exports the active project, or any selected open projects in current tab order. Original size uses the document's stored resolution to calculate physical dimensions. A4, A3, Letter and custom sizes use portrait/landscape orientation. Original size preserves the document's aspect and orientation. Custom dimensions and margins are millimetres. Fit contains the document, fill crops it, and actual size preserves physical scale. All modes clip content to document bounds and page margins.

Flattened export reuses Photolisa's visible-layer compositor. PNG embedding is lossless and preserves alpha; JPEG quality is configurable and has an opaque background. White/custom page backgrounds do not erase a document's own background. Empty transparent pages appear white in most PDF readers. DPI controls the embedded page bitmap dimensions and does not mutate source pixels, document metadata or histories. The compositor paints directly into the bounded page canvas, avoiding an intermediate full-document bitmap. Native shapes use the requested scale; text remains rasterized by the existing text painter; existing raster effects and group adjustments retain their native processing behavior. Preview images show the page composition before encoding, so JPEG compression artifacts are visible only in the final PDF.

Vector mode retains opaque solid rectangles, circles, ellipses and lines as PDF drawing operations, including layer and SVG affine transforms. Pages containing other visible content flatten in full, with warnings displayed before export. This conservative fallback preserves stacking and compositing. Hidden layers and empty raster layers do not force fallback. Text font embedding, paths/polygons, rounded corners, groups, gradients, special strokes, masks, blending and effects currently require flattened pages. No mode promises editable PDF text or round-trip object editability.

## Limits and security

- Maximum input file: 100 MiB; header must start with `%PDF-`.
- Maximum PDF: 100 pages; maximum DPI: 1200 (minimum 1).
- Page canvas and temporary effect/mask buffers: at most 8192 pixels per side and 16,777,216 pixels.
- Import batch/export bitmap budget: 67,108,864 pixels. Lower DPI or split the job when a limit is exceeded.
- PDF.js also caps embedded image decoding at 16 megapixels. Oversized embedded images may be omitted by that safety limit; verify previews for such documents.
- PDF JavaScript actions and links are never invoked. XFA is disabled. PDF.js 6 no longer exposes the older eval-based font compilation option; no scripting/viewer sandbox is instantiated. Only in-memory input bytes are opened; no PDF URL, external action, attachment or remote document resource is fetched. PDF.js fonts, character maps and decoder assets are bundled and served locally.
- File size/page count/pixel limits reduce resource exposure but are not a hard browser process memory ceiling. Parser internals, decompression, fonts, native effect buffers, PDF serialization and the editor's existing document assets require additional memory.
- PDF.js render tasks can be cancelled immediately; export checks cancellation between asynchronous stages/pages and during serialization yields. Individual canvas painting and image embedding operations finish before cancellation takes effect. Large individual page compositing can temporarily occupy the main thread.
- Preview URLs, staging canvases, export canvases, PDF workers and temporary rendering caches are released after use/cancellation. Native save-picker cancellation produces no file; download fallback is used when native saving is unavailable.

## Editable import feasibility

Investigated PDF.js's public `getTextContent`, `getOperatorList` and page viewport APIs. Text extraction supplies positioned text runs, rather than source text boxes with authoring semantics. Operator lists contain PDF painting instructions and graphics state; paths, glyph positioning, clipping, image masks, fonts and transparency groups cannot be mapped reliably to native editable layers from text extraction alone. PDF.js's operator list is designed for rendering, and is not a lossless object-editing representation.

Editable import is therefore deferred. No unsupported element is presented as an editable text/vector object. A future implementation needs explicit mapping contracts, font licensing/embedding assets, clipping/group support and per-feature visual/round-trip tests before exposing a partial editable mode.

References: [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [PDF.js document loading options](https://mozilla.github.io/pdf.js/api/draft/api.js.html), [pdf-lib image embedding and document API](https://pdf-lib.js.org/docs/api/classes/pdfdocument).

## Verification

Vitest covers signature/selection/allocation validation, physical sizing at different DPI, custom pages/margins, resource disposal and the supported vector subset. Playwright covers real PDFs, rotation/crop boxes, selected/all pages, multipage export, encrypted PDF retries/cancellation, corruption, raster layer undo/redo, PNG fidelity/transparency, supported vector drawing output, PDF round trips, drag-and-drop and error recovery. Existing format tests remain in the regression suite.
