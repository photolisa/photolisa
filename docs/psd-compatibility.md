# PSD compatibility

Photolisa uses **ag-psd 31.0.3**. PSD support is intentionally described as a compatible subset, not full Photoshop compatibility.

## Preserved by Photolisa

- 8-bit RGB and grayscale PSD document dimensions
- Raster layer pixels, names, ordering, nested groups, visibility, opacity, and the `normal`, `multiply`, `screen`, and `overlay` blend modes
- Translated raster-layer positions
- Basic raster masks where ag-psd exposes decoded mask pixels
- A correct full-resolution composite preview generated from the Photolisa document on export

Photolisa adjustments have no equivalent private PSD representation. They are baked into the exported layer pixels and reported to the user. Scale and rotation are likewise baked while translations remain layer bounds. Unsupported PSD blend modes import as `normal` with a warning. Text, smart objects, vector content, effects, clipping, and linked data are imported from available raster previews or omitted, always with a compatibility note.

## ag-psd 31.0.3 limits

The installed library documents these limitations:

- Reading Indexed, CMYK, Multichannel, Duotone, and LAB modes is unsupported; writing is RGB only.
- 16-bit channels and PSB/Large Document Format are unsupported.
- Color palettes, animations, 3D effects, some metadata, newer Photoshop features, and some smart-layer filters are unsupported.
- Pattern support is limited to raw/RLE RGB or grayscale document pattern blocks. ZIP-compressed, Indexed, 16-bit patterns, and editable Pattern Overlay content are unsupported.
- Text support is incomplete, including vertical text and paragraph/character styles.
- ag-psd does not regenerate layer or composite pixels after changes to text, vector data, or blending. Photolisa supplies its own current composite and never claims those features remain editable.

## Safety policy

Before decoding, Photolisa validates the PSD signature, version, channel count, color mode, bit depth, dimensions, pixel count, and declared memory budget. It then performs a structure-only parse with layer/composite/thumbnail/linked-file pixels disabled. Layer count and aggregate layer-area budgets are checked before a second pixel decode. ag-psd is constrained to a 512 MiB total decode limit; linked file payloads are never decoded.

Current hard limits are 256 MiB per input file, 16,384 pixels per dimension, 100 megapixels per raster, 5,000 layers, and 512 MiB of estimated decoded channel/pixel memory.
