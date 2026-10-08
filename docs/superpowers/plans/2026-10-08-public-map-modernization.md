# Public Map Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver a working Svelte 5/TypeScript/Vite public map that preserves current behavior and creates a clean foundation for the separate protected admin.

**Architecture:** Svelte owns UI and state; typed pure modules own survey rules; an imperative OpenLayers adapter owns mapping and lifecycle. A separate production output contains only explicit public assets. The online admin remains the next subsystem under the linked security design and requires its own implementation plan.

**Tech Stack:** Svelte 5, TypeScript, Vite, OpenLayers 10.7.0 initially, Vitest, Playwright, Node.js, Caddy.

**Spec:** `docs/superpowers/specs/2026-10-08-public-map-modernization-design.md`; later admin design: `docs/superpowers/specs/2026-10-08-secure-online-admin-design.md`.

## Global Constraints

- Preserve existing appearance, content, interactions, Indonesian copy, and original survey/image data.
- Strict TypeScript; no blanket `any`, `@ts-nocheck`, or unchecked casts to conceal migration errors.
- Initially OpenLayers 10.7.0, production target ES2022, responsive threshold 960px, development address 127.0.0.1:8123.
- Decluttering remains disabled; Cadangan excluded from official counts; Belum Ditetapkan and independent Duplikat flags remain counted.
- Public build contains no admin code, write endpoints, credentials, source maps, server code, docs, tooling, or environment files.
- Preserve unrelated dirty/untracked work; do not turn root package ESM on in a way that breaks the CommonJS Python launcher.
- No production deployment or push in this implementation plan. Any commits must include task-owned changes only and follow repository plain imperative commit wording.

## Review Focus

- Missing photos and absent optional properties render usable details, while malformed identifiers/coordinates produce a visible data error.
- RT 03 searches must not accidentally include RT 30–39; coordinate precision and pair order remain consistent with Google Maps links.
- Overlapping points and flagged units remain selectable and counted rather than hidden through decluttering or mistaken deduplication.
- Failure/retry/unmount and viewport changes never create duplicate map listeners, maps, requests, or late updates to disposed UI.
- Output copying must not accidentally publish admin bundles, secrets, tooling, raw source, or unrelated repository files.

## File structure

- `src/main.ts`, `src/public/App.svelte`: mount and public application composition.
- `src/shared/survey/{types,coordinates,status,search,display,media}.ts`: typed domain rules extracted from current custom.js.
- `src/public/data/{parse,load,regions}.ts`: runtime validation, fetch lifecycle, and geographic grouping.
- `src/public/state/survey.svelte.ts`: application query, filters, navigation, selection, and derived results.
- `src/public/map/{create-map,layers,styles,controls}.ts`: explicit OpenLayers imports and lifecycle adapter.
- `src/public/components/{Sidebar,RegionGrid,PointList,PointPopup,LayerPanel,MapView}.svelte`: preserved UI responsibilities.
- `src/public/styles/{tokens,layout,sidebar,popup,controls,motion}.css`: existing CSS split by responsibility without a redesign.
- `vite.public.config.mts`, `tsconfig.json`, `svelte.config.js`, `vitest.config.mts`, `playwright.config.ts`: build/check/test configuration.
- `scripts/build-public-assets.mjs`: narrowly scoped data/media copying and boundary asset conversion.
- `tests/{survey,search,data,public-output}.test.ts`, `tests/browser/public-map.spec.ts`: behavior and artifact checks.

---

### Task 1: Preserve and type survey behavior

**Files:** Create shared survey modules and `tests/survey.test.ts`, `tests/search.test.ts`; modify package scripts/lockfile and check configuration only as needed for this deliverable.

**Interfaces:**
- `SurveyPoint` includes Nomor, authoritative longitude/latitude, allocation fields, optional documentation date/photo, and independent reserve/unplaced/verification flags.
- `getPointFlags(properties: SurveyProperties): PointFlags` and `countOfficialPoints(points: readonly SurveyPoint[]): number`.
- `parseCoordinateQuery(value: string): CoordinatePair | null`, `formatCoordPair(lat: number, lon: number): string`, `coordinateTolerance(value: number): number`, `matchesQuery(point: SurveyPoint, query: string): boolean`.
- `legacyPhotoUrl(path: string | null | undefined): string | null`, display-title and proposer-normalization helpers retain current algorithms and explanatory comments.

- [x] Add fixture tests: reserve excluded, unplaced/verification counted, equivalent legacy boolean flags normalized; RT 03 matches RT 3 and excludes RT 30; longitude-first and latitude-first searches equivalent; formatting retains six-decimal evidence; empty photo returns null and Windows paths resolve as currently sanitized.
- [x] Pin compatible stable dependencies in package-lock; preserve existing Python commands as `dev:legacy`/`start:legacy`; run tests before implementing extracted functions and confirm a meaningful failure.
- [x] Extract pure algorithms without changing their semantics; use explicit types and test only behavior meaningful to users.
- [x] Run `npm test -- tests/survey.test.ts tests/search.test.ts` and the configured type check; require all assertions to pass.

### Task 2: Validate and load public data

**Files:** Create data modules, `scripts/build-public-assets.mjs`, `tests/data.test.ts`, and frozen minimal fixtures.

**Interfaces:**
- `parseSurveyCollection(value: unknown): SurveyPoint[]`; typed validation error includes field and record context without secrets.
- `loadSurveyDataset(signal: AbortSignal): Promise<SurveyDataset>`; dataset includes points and region geometry.
- `resolveRegion(point: SurveyPoint, boundaries: RegionFeature[]): RegionAssignment` preserves polygon and existing fallback behavior.
- `SurveyDataset` feeds Task 3's adapter and Task 4's state, without OpenLayers-dependent objects in the pure data layer.

- [x] Test duplicate Nomor, invalid/out-of-range coordinates, geometry/property disagreement, malformed collections, and successful empty collections. Verify optional photo/proposer fields are accepted, and coordinate consistency errors are reported rather than silently corrected.
- [x] Test representative polygon assignment including the existing fallback; convert generated `layers/BatasKabupaten_1.js` JSON into a public GeoJSON asset without `eval` and without editing the original.
- [x] Implement unknown-input validation and abort-aware fetching. Define successful empty state separately from loading/error; retry uses a fresh controller and discards stale results.
- [x] Run `npm test -- tests/data.test.ts`; perform a read-only full current-dataset audit and compare 550 total/500 counted/50 reserve/two unplaced/22 true verification flags against the recorded baseline. Production does not hardcode these totals.

### Task 3: Replace global map setup with an adapter

**Files:** Create map modules and MapView component; add adapter lifecycle tests/browser assertions in `tests/browser/public-map.spec.ts`.

**Interfaces:**
- `createSurveyMap(options: { target: HTMLElement; popup: HTMLElement; dataset: SurveyDataset; onSelect: (nomor: string | null) => void }): SurveyMapAdapter`.
- Adapter methods: `setSelection(nomor: string | null): void`, `setVisiblePoints(ids: ReadonlySet<string>): void`, `fitToPoints(ids: ReadonlySet<string>, options: FitOptions): void`, `setLayerVisibility(key: LayerKey, visible: boolean): void`, `updateSize(): void`, `dispose(): void`.
- `FitOptions` carries duration, maxZoom, and viewport padding; `LayerKey` is an explicit union of current basemap/boundary/mask/point-layer keys.

- [x] Verify baseline layer defaults, attribution, immediate click selection, no double-click zoom, complete point visibility, and selected-pin focus offsets through browser fixtures.
- [x] Recreate needed qgis2web setup using explicit imports from `ol`, initially at 10.7.0. Port cached pin/dot styles, mask, boundaries, controls, layer switching, overlapping-point selection, and popup overlay behavior; no reliance on `window.map` or generated global variables.
- [x] Implement adapter cleanup for listeners, ResizeObserver, overlays, layers, and target. MapView mounts once through onMount and disposes on destruction; HMR must not duplicate the map.
- [x] Test retry/unmount/remount and viewport changes for duplicate listeners and stale updates; verify controlled selection callbacks and layer toggles in the browser.

### Task 4: Migrate the visible interface to Svelte

**Files:** Create App, state, UI components and CSS modules; modify index.html and src/main.ts; extend browser tests.

**Interfaces:**
- `createSurveyState(dataset: SurveyDataset)` provides query, statusFilter, activeRegion, selectedNomor, panel state, and derived visiblePoints/counts. Expose explicit methods for navigation, selecting, clearing selection, and fit requests.
- Components receive typed properties/callbacks. They do not independently mutate OpenLayers sources or recreate shared derived data.

- [x] Add behavior assertions for initial 500/10 grouping against the frozen baseline, text/coordinate search, opening a point and its correct photo, route destination, group/back navigation, status filters, and closing selection.
- [x] Port markup, SVGs, status strings, allocation titles, and CSS without redesigning. Use keyed point lists and escaped Svelte text; any deliberate SVG/HTML insertion must be trusted static content or separately sanitized.
- [x] Preserve sidebar/bottom-sheet gestures, mobile popup, motion timings, hints, accessibility names, focus, reduced-motion behavior, and loading/error/retry UI. Exclude localhost flag-editing code from public modules; retain its legacy helper separately.
- [x] Run `npm run check`, domain tests, and Svelte autofixer on final changed Svelte files. Test desktop plus 375px/390px and the 960px threshold in Chromium and WebKit; report actual physical-device coverage separately.
- [x] Confirm no active legacy script chain or monolithic/global compatibility bridge remains. Check photo-less unplaced records and overlapping pins explicitly.

### Task 5: Build only public assets and verify deployment output

**Files:** Modify public Vite configuration, package.json/lockfile, Dockerfile, Caddyfile, .dockerignore, .gitignore, and README's relevant sections; add `tests/public-output.test.ts` and browser/performance evidence.

**Interfaces:**
- `npm run dev` serves the modern public app at 127.0.0.1:8123 with strict port handling.
- `npm run check`, `npm test`, `npm run test:e2e`, and `npm run build` are repeatable checks; production output is `dist/public/`.
- Asset copying permits only branding/icons, intended webfonts, survey images, required GeoJSON, and manifest. Import-built JavaScript/CSS is hashed. No root-directory copy or arbitrary recursive fallback.

- [x] Test the built output with sentinel admin/env/docs files to ensure they are excluded; assert emitted HTML references hashed entry assets and contains no write/admin route definitions, server settings, source maps, or legacy vendor bundle references.
- [x] Configure Vite and the copy step, keeping preload and data-fetch URLs identical. Build only modules reachable from the public entry; no shared multi-entry output that includes admin chunks.
- [x] Update Docker to a reproducible Node build stage followed by a Caddy runtime stage copying only dist/public. Preserve security headers and data revalidation; replace manual code-token rewriting with hashed assets. Keep CommonJS helpers working and preserve unrelated VS Code/import/export edits.
- [x] Run `npm run check`, `npm test`, `npm run build`, then `npm run test:e2e` against the production build. Run the final browser pass with CSP/cache headers equivalent to Caddy, not only the permissive development server.
- [x] Compare baseline/migrated transfer size and time-to-usable map under equivalent conditions. Document measured differences, behavioral coverage, external tile failures, and any remaining limitations rather than promise a percentage improvement.
- [x] Review the final diff, verify data/image hashes are unchanged, and document rollback and modern/legacy commands. Do not push or deploy in this stage.

## Subsequent subsystem

After the modern public map is verified, prepare the separate administration implementation plan against the security/backend design: protected frontend output, Django API, PostgreSQL migration, private image storage, draft publication, authorization, audit, conflicts, and restore checks. Identity-provider/DNS/account setup must be resolved before production activation. The frontend milestone does not satisfy the full online-admin request by itself.

## Execution recommendation

Native implementation in this chat is recommended for this five-task migration because data, map, and component interfaces are tightly coupled and existing dirty work must be handled consistently. Review each task's evidence before continuing and obtain a final independent review according to the applicable execution skill. The user approved native execution in this chat. Task implementation and verification are complete; the separate validation record tracks final independent review and delivery limits.
