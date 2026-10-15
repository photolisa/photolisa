# Vue SPA migration

## Audit

The active application had one Nuxt page (`/`), no active layouts, middleware, plugins, server routes, runtime configuration, API requests, localization, or dynamic metadata. Nuxt supplied the page mount, automatic imports, Tailwind integration, and static document title/theme metadata. The `old-photolisa-for-merge` directory is an untracked legacy reference and is excluded from the application and checks.

The editor's document model, commands, Pixi renderer, file adapters, persistence, and tests were already framework independent. Pinia was already used for lightweight UI state. Browser files and worker code remain in their existing modules.

## Implementation

- `main.ts` installs Pinia and Vue Router. `App.vue` hosts `RouterView`; `/` lazily loads `views/EditorView.vue`.
- `useEditorWorkspace` coordinates the existing editor composables and file actions. The view contains the existing component layout and bindings.
- Vue APIs, Pinia stores, composables, and editor components use explicit imports. Vite preserves both `@/` and `~/` aliases.
- Tailwind 4 owns the existing `chrome` and `accent` colors. Scoped component styles reference the shared theme for `@apply`.
- PSD and SVG adapters load when their formats are used. The Pixi editor engine remains independent of Vue.
- The static title and theme color live in `index.html`. There are no runtime environment variables or server secrets to migrate.

The SPA needs a host fallback to `index.html` for client-side routes. No editor feature required a server-side replacement.
