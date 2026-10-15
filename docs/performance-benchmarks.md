# Performance and reliability pass — 2026-10-10

## Reproduce

Start the local Vite dev server, then run:

```sh
PHOTOLISA_BENCH_PROFILE=baseline-comparable node tests/benchmarks/photolisa.bench.mjs
PHOTOLISA_BENCH_PROFILE=baseline-comparable PHOTOLISA_BENCH_SOURCE_MODE=independent node tests/benchmarks/photolisa.bench.mjs
node tests/benchmarks/photolisa.bench.mjs
```

The first profile reproduces the original idle-frame, 240-point stroke, and PNG export sequence with shared sources. The second command assigns an independent patterned pixel source to every layer. The third measures 60 warm pan frames, first visible frame, stroke processing, and PNG export. Each scenario creates an editable document at the requested dimensions with the requested layer count. Source sizes are 512², 1024², and 2048² respectively; a full-document independent source on every layer would require much more memory.

Measurements below came from Playwright Chromium 133.0.6943.16, headless with SwiftShader, a 1280 × 800 viewport, and one run per scenario. Milliseconds are wall-clock readings from `performance.now()` in the app. Repeated runs varied substantially, especially for export and first paint; these numbers are directional rather than a throughput guarantee.

## Before and after

The initial probe was run before changes. It accidentally imported the test raster registry through a different dev-module instance from the renderer, so its canvas showed the checkerboard but not source layers. Its opening, frame, and render-submission readings are invalid for a before/after visual comparison and are intentionally excluded. The stroke processor and export adapter received the correct source registry, so their baseline values are usable.

| Document / layers | Stroke processor, before → after | Full-resolution PNG, before → after | JS heap after run, before → after |
| --- | ---: | ---: | ---: |
| 1920 × 1080 / 10 | 7.9 → 3.0 ms | 69.9 → 70.3 ms | 15.1 → 15.1 MiB |
| 4096 × 4096 / 20 | 10.3 → 9.0 ms | 215.6 → 147.4 ms | 15.4 → 15.1 MiB |
| 8192 × 8192 / 5 | 6.7 → 1.7 ms | 438.7 → 416.7 ms | 15.0 → 15.0 MiB |

Stroke time covers 240 document-space points and completion of one history command, excluding GPU upload. PNG time includes full-resolution compositing and encoding. The 1920 export is effectively unchanged in this sample; repeated post-change samples ranged roughly 37–102 ms, so more controlled runs are needed to establish an export improvement. The unchanged PNG byte counts across the original and final probes were 117,105, 501,616, and 1,416,501 bytes. The final harness also verifies SHA-256 digests of exported PNGs against committed browser-specific references.

The old renderer created a Pixi texture per visible layer. For shared 8-bit RGBA sources, that implies **estimated** texture payloads of 10, 80, and 80 MiB before the pass. The new cache reports 1, 4, and 16 MiB before the copy-on-write stroke, and 2, 8, and 32 MiB afterward. These are pixel-payload estimates, not measured GPU allocations. Driver overhead, mipmaps, render targets, and Pixi's internal caches are not included.

With **independent sources** per layer, the final run reported 10, 80, and 80 MiB estimated texture payloads. It retained 431, 594, and 594 KiB of history for the 240-point stroke because changed-pixel cropping avoided full tile snapshots. PNG digests matched the shared-source runs exactly. This workload demonstrates correctness with many independent layers; texture sharing cannot reduce memory when every layer owns different pixels.

## Current interactive profile

The continuous-pan profile in Chromium recorded first visible frame at about 163, 191, and 241 ms. Its 60 warmed `requestAnimationFrame` intervals had medians of 28.6, 24.9, and 24.8 ms, with p95 values of 40.1, 32.1, and 32.9 ms. A separate run produced medians of 19.9, 20.4, and 26.8 ms. The app's last CPU render-submission durations were 4.5, 19.1, and 41.1 ms in the first run. `requestAnimationFrame` intervals reflect scheduling and software-renderer load; render-submission duration does **not** measure completed GPU frame time.

CDP `Runtime.getHeapUsage` reports JavaScript heap only. It excludes GPU textures, canvas backing stores, browser process memory, and IndexedDB. The test does not claim those unavailable memory figures.

## Changes and checks

- Shared source textures and at most 2048-pixel tiles, capped further by the browser's `MAX_TEXTURE_SIZE`; changed source regions update only intersecting tiles.
- Hidden layers skip source texture allocation. Small visible groups can cache their composite, with a 64 MiB estimated group-cache ceiling and explicit invalidation on layer or source changes.
- Pixi render requests coalesce on animation frames. Rendering pauses while the tab is hidden; restoration refreshes changed sources. A real `WEBGL_lose_context` test passed loss and restoration with no reported renderer error.
- Sparse strokes retain only changed pixels within touched history tiles; copy-on-write strokes avoid redundant tile snapshots. History budgets reject invalid limits.
- Export adjustment cache is limited to 64 MiB of estimated RGBA canvas payload. Mask-only layers avoid an unnecessary full-size adjustment buffer.
- Autosave serializes writes, rejects snapshots changed during capture, retries failures with backoff, flushes on tab hide/pagehide where the browser allows, and keeps unsaved status after recovery. Manual save only clears dirty state if the saved revision is still current.
- A 4096 × 8 source produced two shared Pixi tiles. Updating its first five pixels changed only the intended tile and preserved the expected green RGBA pixel.

The most important remaining scaling limit is that an 8192² **independent** visible raster still needs roughly 256 MiB of texture payload at full resolution, plus tile canvases and document pixels. Viewport-aware tile paging or zoom-dependent preview levels would address that without altering original document data. Autosave on pagehide is best effort because browsers may terminate asynchronous work immediately; the visibility-change save is the primary recovery path.
