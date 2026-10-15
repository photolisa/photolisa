# Architecture audit and source migration

Audit date: 2026-10-14. Scope: the active TypeScript/Vue application, configuration, unit and browser tests, and benchmark entry points. `old-photolisa-for-merge/` is historical reference material, excluded from application compilation and linting; its code has not been migrated into the active application.

## Changes and verification stages

1. Established a baseline: strict application type checking, 32 unit suites / 138 tests, and production build passed. ESLint reported one missing Vue list key and 27 formatting warnings. The build reported a large editor chunk.
2. Moved the complete active source tree into `src/`, retaining its existing module groups. Updated the HTML entry, TypeScript and Vite aliases, formatting paths, unit imports, browser source URLs, and benchmark source URLs. Type checking, all unit tests, and the build passed after migration.
3. Repaired domain ownership: moved affine/layer coordinates from raster into `core/geometry`; moved three canvas-dependent command modules into `raster/commands`; replaced bundler aliases with relative imports throughout the engine; changed the tool controller's tool ID dependency from the Pinia store to the existing domain type. Moved the color-library service instance from `composables/useColors` into `app/colorSession`. Type checking, all unit tests, and the build passed.
4. Extracted canvas integration from `CanvasWorkspace.vue` into `useCanvasWorkspace`, preserving props, event payloads, exposed actions, renderer options, and cleanup order. Added the existing list's missing stable key. Added independent core compilation and executable import boundary checks. No dependency or document-format changes were required.

The browser suite exposed duplicate module identity when a source alias ended in `/`: aliased imports and direct `/src/…` test imports could instantiate separate editor sessions. Both source aliases now use the canonical path without a trailing slash. All five object-manipulation browser tests passed after this correction, followed by a full browser rerun.

## Final verification

| Check | Result |
| --- | --- |
| Application and independent core type checking | Passed |
| Unit tests, including architecture boundaries | 33 suites, 140 tests passed |
| Production build | Passed; existing large-chunk warning remains |
| Configured formatting check | Passed |
| ESLint | Zero errors; 27 existing Vue style warnings |
| Complete Chromium suite | 54 passed; two responsive-layout failures reproduced on the untouched checkout |
| Presentation comparison | Other Vue components/views match baseline apart from import paths. Canvas template matches after accounting for its stable list key and extracted action callback. |

Browser coverage exercised imports/exports, undo/redo, raster painting, selections, adjustments, masks, text, vectors, transforms, document tabs, and cross-document transfers. Benchmark import paths were migrated; performance benchmarks were not rerun.

## Ownership review

| Area | Assessment |
| --- | --- |
| Application entry and configuration | One Vue SPA route, explicit `/src/main.ts` entry, public assets unchanged. Strict application checking remains enabled. Core has an additional compiler configuration without browser types. |
| Document model and history | Plain TypeScript objects, typed events, metadata commands, transactions, and bounded history remain the editing backbone. Canvas-dependent commands now have an explicit browser-layer home. Selection and UI preferences retain their existing history semantics. |
| Geometry and vector processing | Shared affine transforms belong to the domain. Paper remains the existing geometry dependency. No algorithm replacements were needed. |
| Rendering | Pixi owns scene objects, texture caching, display filters, and viewport rendering. Document objects remain the editing authority. Input and presentation integration stay outside core. |
| Raster and worker processing | Registry-owned assets, copy-on-write editing, dirty regions, tiled stroke history, and adjustment workers remain intact. Original pixels and transparency were not converted or resampled by the refactor. |
| File adapters | Existing image, native-project, PSD, SVG, and ICO validation and compatibility boundaries remain in place. Heavy formats retain their existing lazy imports. |
| Persistence | IndexedDB manifests/assets, debounced autosave, stale-snapshot detection, and retry handling remain outside the model. Shared color persistence is composed at the application boundary. |
| Vue presentation and state | Components and stores keep existing controls and state. Canvas orchestration is now a typed composable. Existing focused panels and tool modules were retained rather than fragmented further. |
| Tests and maintenance | Unit and browser source references follow the new tree. Architecture checks cover static imports, re-exports, and literal dynamic imports. Historical reference code stays excluded. |

## Remaining risks and deliberate limits

- Two responsive-layout browser assertions fail on the untouched checkout: header overflow at 600px and right-panel positioning in a narrow layout. This refactor preserves the UI; those layout defects require separate product fixes.
- A GPU stroke-sampling assertion failed in the first migration run, then passed in both an isolated untouched-checkout run and the final full suite. Browser/GPU checks must be assessed separately from deterministic geometry tests.
- Production builds still warn about an editor chunk exceeding 500 kB. A dedicated loading/performance change should measure first-edit latency before splitting Pixi or input code; this migration does not hide the warning or add arbitrary chunks.
- ESLint's existing Vue style warnings remain. This migration fixes its missing-key error without reformatting unrelated components.
- `RasterSourceRegistry` is application-wide, while histories and recently closed sessions retain asset IDs. Safe reclamation across live documents, undo/redo, clipboards, and reopened sessions needs explicit shared ownership accounting before aggressive cleanup can be introduced. Deleting assets just because a tab closes would break existing behavior.
- Renderer initialization is asynchronous. Unmounting while Pixi initializes deserves a dedicated cancellation/lifecycle regression test; the extraction preserves existing initialization and cleanup semantics rather than changing them incidentally.
- Tool controllers still coordinate several gesture families, and raster vector-gradient painting still uses the renderer's gradient helper. These are existing couplings outside the domain boundary. Splitting them safely requires focused gesture and export coverage; moving them merely to shorten files would not establish a better contract.
- Validation covers the existing test scenarios; it is not a claim of exhaustive security, accessibility, color-management, memory-pressure, or cross-browser certification. Existing format limitations are documented in the compatibility documents.

## Maintenance rules

Keep new runtime source under `src/`. Place pure document operations and geometry in core, canvas/pixel commands in raster, rendering in renderer, and browser orchestration in tools or composables. Use the existing command interface for undoable edits. Avoid UI imports and bundler aliases in engine modules. Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, and relevant browser tests for subsequent changes.
