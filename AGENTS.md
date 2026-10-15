# Photolisa — Engineering Guidelines

Photolisa is a professional, browser-based, layer-based photo editor written in TypeScript. Build real editing capabilities with a compact, professional interface and preserve users' work, image fidelity, and transparency.


## Product and technology

- Use Vue 3 Composition API, Vite, TypeScript strict mode, Tailwind CSS, Pinia, and Vue Router for the application UI.
- Use PixiJS v8 with WebGL for GPU rendering, Canvas APIs for browser raster work, and IndexedDB through the existing persistence layer for local projects.
- Reuse installed libraries, including ag-psd for PSD, Paper.js for vector geometry, PDF.js/pdf-lib for PDF, and existing image-format adapters.
- Keep core editing client-side. Do not introduce Nuxt, React, Rust, or a backend for core image editing.
- Use versions and scripts in `package.json` and the existing lockfile. Do not upgrade dependencies as a side effect of unrelated work.
- Keep the engine independent of Vue and Vite so it can be reused in a future desktop application.

## Architecture and ownership

Follow the existing layout rather than creating a parallel `src/engine` tree:

| Location | Responsibility |
| --- | --- |
| `src/core` | Document model, layer state, geometry, commands, history, and domain events |
| `src/raster` | Browser raster surfaces, pixel operations, raster commands, and processing workers |
| `src/renderer` | PixiJS rendering, texture caches, viewport, and visual overlays |
| `src/tools` | Editing tools and interaction behavior |
| `src/adapters` | File import/export, format conversion, and file validation |
| `src/persistence` | Local project storage, autosave, and recovery |
| `src/components/editor`, `src/views`, `src/ui` | Components, workspace presentation, and UI definitions |
| `src/composables`, `src/stores`, `src/app` | Vue integration, application state, and orchestration |
| `tests/unit`, `tests/e2e` | Domain tests and real-browser workflows |

1. Keep `src/core` free of Vue, Pinia, PixiJS, DOM, and Vite dependencies. Preserve the separate `tsconfig.core.json` check.
2. Keep browser-dependent code in browser adapters, raster modules, renderers, or UI integration. Avoid browser API access when importing platform-independent modules.
3. The full-resolution document model owns editing state. PixiJS objects and textures are derived rendering resources, never the source of truth.
4. Separate UI state, persistent document state, rendering caches, and history. Route UI edits through existing engine services and commands.
5. Keep Vue components small and focused. Do not put large editing algorithms, format parsers, or engine orchestration into `App.vue` or other SFCs.
6. Reuse current abstractions before adding services, folders, or dependencies. Do not reorganize unrelated modules to match an idealized layout.

## TypeScript and maintainability

- Preserve `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` checks.
- Avoid `any`, unchecked casts, and non-null assertions used to hide invalid state. Validate external data as `unknown` and narrow it at boundaries.
- Prefer small modules, explicit interfaces, discriminated unions, and understandable control flow.
- Prefer proven open-source libraries for complex algorithms. Check browser compatibility, bundle cost, maintenance, and licensing before adding a dependency.
- Preserve required third-party license notices and attribution.
- Make errors actionable. Do not silently swallow failures or report success before an operation finishes.

## Document mutations and undo/redo

- Every document mutation must be undoable unless an exception is explicitly documented. Viewport movement and transient UI state do not need document history.
- Use the existing `Command` and `CommandHistory` abstractions, including raster commands where appropriate.
- Group a user gesture, such as a brush stroke or transform drag, into one meaningful history action. Keep previews temporary and restore state on cancellation.
- Undo and redo must restore affected pixels, masks, geometry, layer ordering, and metadata as applicable.
- Account for retained bitmap memory through command memory costs. Dispose resources when history entries are discarded; avoid full-document snapshots for small edits.
- Keep asynchronous processing results tied to the originating document and revision. Ignore or cancel stale results after edits, document switches, or closure.
- Failed or cancelled operations must leave the document and history consistent. Prepare and validate resources before committing a mutation.

## Image fidelity and file safety

- Preserve full-resolution source data and alpha. Zooming, panning, thumbnails, and previews must not resample the document destructively.
- Make flattening, rasterization, resizing, lossy encoding, and transparency removal deliberate operations. Explain relevant export limitations to the user.
- Keep document, layer, viewport, and device-pixel coordinates explicit. Verify transforms at different zoom levels and device pixel ratios.
- Reuse `src/adapters/FileSafety.ts` and its limits. Validate file size, dimensions, pixel counts, decoded bytes, layer counts, and allocation arithmetic before allocating wherever metadata permits; revalidate decoded results.
- Budget aggregate memory for layers, masks, history, temporary buffers, and GPU textures, rather than validating each bitmap in isolation.
- Treat project manifests, SVG, PSD, PDF, and other imported content as untrusted. Bound parser work and reject malformed or unsupported data safely. Do not execute imported scripts or fetch embedded external resources implicitly.
- Keep format limitations explicit. ag-psd does not support every Photoshop feature; verify supported import/export behavior with representative fixtures rather than promising lossless PSD compatibility.
- Export from document content, excluding selection handles, guides, and other workspace overlays.

## Performance and resource lifecycle

- Keep large pixel buffers, canvases, workers, and PixiJS objects out of deep Vue reactivity. Use `shallowRef` or `markRaw` at UI boundaries where appropriate, with explicit update notifications. See [Vue performance guidance](https://vuejs.org/guide/best-practices/performance).
- Avoid unnecessary bitmap copies, whole-document redraws, texture uploads, and GPU-to-CPU readbacks. Reuse caches and update affected regions when supported by current abstractions.
- Profile representative documents before adding performance complexity. Track interaction latency and memory as well as frame rate.
- Respect device GPU limits; do not assume the maximum import dimension fits a single GPU texture. Use bounded rendering or a clear error when limits are exceeded. Manage texture ownership and destruction explicitly. See [PixiJS performance guidance](https://pixijs.com/8.x/guides/production/performance-tips/).
- Move expensive independent pixel processing to the existing worker architecture when it improves responsiveness. Feature-detect OffscreenCanvas and provide a supported fallback or clear limitation. See [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas).
- Transfer worker buffers only when ownership can move safely: a transferred ArrayBuffer is detached from its sender. Never transfer the only buffer still needed by the document or undo history. See [transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects).
- Clean up event listeners, subscriptions, observers, animation frames, workers, object URLs, ImageBitmaps, render textures, and owned GPU resources on disposal. Do not destroy shared resources while another document or cache uses them.

## Persistence and recovery

- Reuse IndexedDB storage and autosave services. Version serialized formats and provide tested migrations when schemas change.
- Keep writes transactional where possible and retain the last recoverable project when a save fails. Mark work saved only after persistence succeeds.
- Handle quota exhaustion, unavailable storage, corrupted records, and interrupted writes visibly. Browser storage can be evicted; autosave must not be presented as a guaranteed backup.
- Use storage estimates or persistence requests when appropriate, while handling denial and unavailable APIs. Keep explicit project download/export available. See [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

## User interface

- Build real, connected functionality. Hide or clearly disable unavailable actions; do not add decorative controls that imply implemented features.
- Preserve a compact workspace with clear tool state, layer selection, progress, errors, and undo/redo feedback.
- Provide accessible names for icon buttons, visible keyboard focus, and usable keyboard interactions. Avoid intercepting editor shortcuts while users type in inputs.
- Preserve the original baseline workflows: create a document, open PNG/JPEG, zoom and pan, add/remove/reorder layers, change visibility and opacity, and export PNG. Extend current behavior incrementally rather than restarting the original milestone.

## Development workflow

Before each change:

1. Inspect relevant code, tests, repository instructions, and current Git changes. Preserve unrelated user work.
2. Explain the implementation approach briefly. For substantial features, identify state ownership, undo behavior, cleanup, and failure handling first.
3. Reuse existing abstractions and implement one logical feature at a time. Avoid speculative rewrites and unnecessary dependencies.

After each change:

1. Run type checking, relevant tests, and the production build. Use the existing package scripts below.
2. Add meaningful tests for new editor behavior and regression tests for fixes. Cover state changes, undo/redo, invalid inputs, and cancellation when relevant.
3. Use Vitest for deterministic engine logic. Use Playwright for browser APIs, GPU/canvas integration, pointer interaction, and import/export workflows that unit tests cannot validate.
4. Assert real outcomes: document state, decoded export pixels/dimensions, transparency, or recovered projects. A visible button or screenshot alone does not prove editing correctness.
5. Keep browser tests isolated; prefer accessible locators and waiting for observable state over fixed sleeps. See [Playwright best practices](https://playwright.dev/docs/best-practices).
6. Report checks run, results, limitations, and modified files. If checks are blocked or fail, state that explicitly and distinguish existing issues from the change. Never claim unverified completion.

The repository declares pnpm in `package.json` and includes `pnpm-lock.yaml`. Prefer pnpm; avoid creating another package manager's lockfile.

```bash
pnpm typecheck
pnpm test -- tests/unit/<relevant-file>.test.ts
pnpm test:e2e -- tests/e2e/<relevant-file>.spec.ts
pnpm build
```

Run `pnpm test` for the complete unit suite when changes span multiple engine areas. Run `pnpm lint` for code changes and the configured formatting checks where applicable. Do not add artificial tests for prose-only changes; review documentation for accuracy and consistency.

## Sources and maintenance

The linked documentation informed the recommendations above; project-specific requirements are engineering decisions for Photolisa. Reviewed on 2026-10-15. Additional format reference: [ag-psd documentation and limitations](https://github.com/Agamnentzar/ag-psd).

Check documentation against the versions actually installed before using an API. These guidelines describe the expected standard; they do not assert that every existing module already meets it.
