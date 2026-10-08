# Public map modernization design

Date: 2026-10-08
Status: Design and implementation plan approved by the user. Local migration implemented; verification and review are recorded in ../validation/2026-10-08-public-map-modernization.md. No production deployment performed.

## Purpose and scope

Replace the public map's monolithic/global JavaScript architecture with Svelte 5 components, strict TypeScript modules, explicit OpenLayers imports, and a Vite production build. Preserve its current appearance, Indonesian copy, data, and interactions. This is the first independently deployable stage of the online-admin work, not completion of the admin subsystem.

The later admin has a separate frontend build and a Django/PostgreSQL backend, approved accounts, mandatory MFA, and private image storage. Its draft security architecture is in `2026-10-08-secure-online-admin-design.md`. No admin route, identity setting, upload code, write endpoint, or credential belongs in the public build.

## Verified baseline

Inspected local repository and browser on 2026-10-08:

- `custom.js`: 4,815 lines, 186,713 bytes; one IIFE with DOM manipulation and shared globals.
- `index.html`: 15 scripts whose ordering supplies dependencies.
- Vendored OpenLayers identifies itself as 10.7.0; use that version initially to isolate the migration from a map-library upgrade.
- Dataset: 550 features, 500 counted units, 50 Cadangan, two Belum Ditetapkan, and 22 true Duplikat flags. No repeated Nomor and no coordinate disagreements were found in this snapshot.
- Browser initial view shows 500 counted units grouped into 10 kabupaten/kota; these are current baseline values, not permanent allocation constraints.
- Local Node.js is 24.21.0 and Python is available. Existing npm commands launch the Python server at 127.0.0.1:8123.
- Existing uncommitted edits and untracked import/export tools must be retained.

## Architecture

1. `src/public/` contains only public UI, map code, and read-only data-loading modules.
2. `src/shared/survey/` contains framework-independent types, coordinate utilities, status rules, and search/display behavior that a future admin can reuse. Public code may import this directory; it must not import future admin code.
3. An imperative OpenLayers adapter owns map objects, sources, styles, overlays, and listeners. Svelte owns the surrounding UI and selection/filter state. Map-to-state communication uses explicit callbacks, not `window.map` or other globals.
4. `index.html` keeps metadata, icons, font declarations, and the application mount point. A single module entry imports the Svelte app and CSS.
5. Vite builds `dist/public/`. A narrowly scoped asset-copy step includes only intended public media/assets/data. The container copies this output, never the repository root, into Caddy.

No server-side rendering or SvelteKit is required for this static public application. Use supported compatible stable Vite, Svelte 5, TypeScript, and Svelte-plugin releases, pinned through npm's lockfile. The production target is ES2022, with desktop Chromium/Firefox/WebKit and mobile WebKit browser checks.

## Modules and interfaces

- Survey types represent properties, GeoJSON input, normalized display records, and independent status flags. Each record uses Nomor as its stable public selection key rather than its position in an array.
- `parseSurveyCollection(value: unknown)` validates the collection, feature types, unique identifiers, finite in-range coordinates, and optional properties. It tolerates empty photos and absent optional legacy fields. It reports malformed data visibly rather than render an empty map as success.
- `getPointFlags`, `countOfficialPoints`, coordinate query parsing/formatting, RT/RW-aware search, photo path compatibility, proposer aliases, and allocation-title formatting preserve existing behavior as pure functions.
- `loadSurveyDataset(signal: AbortSignal)` fetches points and geographic boundaries. Pending requests are aborted on disposal; retry does not create a second map instance.
- `createSurveyMap(options)` returns an adapter with `setSelection`, `setVisiblePoints`, `fitToPoints`, `setLayerVisibility`, `updateSize`, and `dispose`. Non-reactive OpenLayers objects stay outside deeply reactive state.
- Shared Svelte state uses `$state` for user choices and `$derived` for filtered records/counts. Effects handle only map/network synchronization and are cleaned up.

## Behavior to preserve

- Official counts exclude reserves and include unplaced and verification-flagged units. Duplicate flags remain independent from allocation status.
- Region membership uses administrative polygons as today. Preserve current fallback behavior and identify it explicitly; do not rename or silently relocate points.
- Text search supports point IDs, proposer/location text, word-prefix matching, exact normalized RT/RW numbers, and coordinate pairs in either order with the current tolerance.
- Preserve desktop sidebar, kabupaten grid, kecamatan grouping, navigation/back behavior, list selection, fit-all, photo popup, Google Maps routes, and layer toggles.
- Preserve Google default/Esri fallback, attribution, province mask, zoom-dependent dots/pins, selected-pin treatment, and complete coverage. Decluttering must remain disabled.
- Preserve selected-point focus offset around the sidebar and mobile sheet, immediate point-click feedback, and suppression of double-click zoom.
- Preserve mobile bottom-sheet states/gestures, popup placement, keyboard focus, accessible labels, and reduced-motion handling. Responsive threshold remains 960px.
- Preserve loading/error/retry UI and protection from stale async requests. A valid empty dataset is a distinct successful empty state, not an endless spinner.
- Existing legacy photo references continue to resolve, and empty photos are legitimate for unplaced units. Do not alter original files or coordinate precision.

The localhost flag-editing UI is excluded from the new public bundle so it contains no write endpoints. Its Python helper and legacy development command remain available until the protected admin replaces that workflow.

## Development and deployment

- `npm run dev` starts Vite at 127.0.0.1:8123 with strict port handling; `npm run dev:legacy` retains the existing Python-based baseline.
- Do not change the root package to ESM in a way that breaks the existing CommonJS `scripts/run-python.js`. New Node helpers use `.mjs`; Vite configuration uses `.mts`.
- `npm run check` runs Svelte/TypeScript checking separately from transpilation. `npm test` runs pure-domain tests. `npm run test:e2e` checks browser flows. `npm run build` emits the production artifact after relevant checks.
- Hashed bundles replace manually versioned JavaScript/CSS references. Data keeps revalidation; preload URLs and map requests stay identical. Fonts/images/branding retain their existing delivery until measured changes justify adjustments.
- Explicit public asset allowlists exclude docs, tooling, admin assets, server code, source maps, environment files, and Git metadata. No arbitrary directory is copied to public output.
- Do not change live services, push, or deploy as part of this first local migration without the corresponding release step being authorized.

## Verification and performance

Baseline and migrated public builds must be compared under equivalent browser/network/cache conditions. Record JavaScript transfer size, time until data/map/list are usable, and search/selection responsiveness. Do not claim a speed gain merely because a compiler was introduced.

Meaningful tests cover status counting, coordinate order/precision/tolerance, RT/RW search, duplicate IDs, optional/missing media, malformed versus empty datasets, and output isolation. Browser checks cover initial counts/grouping, search-to-photo selection, route coordinates, layers, viewport fit, keyboard input, load failure/retry, cleanup, and mobile panels at 375px and 390px. WebKit is a useful browser-engine check but is not proof of physical iPhone Safari behavior.

Migration completion requires no active legacy IIFE/global map bridge, strict type checks, passing domain/browser tests, a verified production build, and a public artifact containing no admin/write/security settings. Retain legacy source files for rollback only until equivalence is verified; they must not be served in the final production output.
