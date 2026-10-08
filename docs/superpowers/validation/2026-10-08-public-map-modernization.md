# Public map modernization validation



Date: 2026-10-08. Implementation: `codex/public-map-modernization`, isolated managed worktree. Original checkout and its existing dirty files preserved. No push or production deployment.



## Earlier verified baseline

This section records the initial frontend validation. Subsequent restoration of original layer controls/map behavior increased the bundle to 432.07 KB (131.34 KB gzip), and the unit suite passed 14/14. The latest targeted Chromium layer/selection/reserve checks passed 3/3. The full suite for the final restored UI and the new public-photo URL resolver has **not** been rerun: the user requested finishing admin features first and checking later. Performance numbers below describe the earlier bundle.

### Initial run



- `npm run check`: zero errors and zero warnings.

- `npm run build`: successful hashed public entry, approximately 423 KB JavaScript / 129 KB gzip as reported by Vite; no production source maps.

- `npm test`: 13 tests pass across five files. Covers status counting, normalized RT/RW search, coordinate order/precision/tolerance, malformed/duplicate IDs, invalid/mismatched coordinates, optional photos, geography fallback, stalled-request cancellation and output allowlisting.

- `PUBLIC_TEST_URL=http://127.0.0.1:8125 npm run test:e2e`: 33 tests pass across Chromium, WebKit and Firefox. The production flows run against the actual Caddy configuration; lifecycle tests use a development-only fixture at port 8127.

- Browser coverage includes counts/grouping, search/photo/route, valid empty data, failure/retry, filters/layers, Google default, unplaced records without routes, shared-coordinate selection, mobile dragging, keyboard focus restoration, repeated actual Svelte unmount/remount and pending-request cancellation.

- Responsive checks: 375px, 390px, 959px, 960px and desktop. Selected pins remain visible after resizing. Visual inspection used real satellite tiles and the original Tanjung Raden 007 photo.

- Actual Caddy validation succeeds. Serving checks confirm CSP/nosniff, immutable hashed bundles, revalidated data, and 404s for repository/server/legacy/write paths. Admin management API is disabled in this static runtime.

- SHA256 comparison: all 585 captured data/image files unchanged. Dataset remains 550 records: 500 official, 50 reserves, two unplaced, 22 verification flags.

- Svelte analysis reports no remaining structural issues in the changed components. Suggestions about effects/bind:this were assessed: effects synchronize external map/DOM behavior, refs own imperative lifecycle, and locally constructed Maps are derived computations rather than persistent reactive collections.



## Performance evidence



Three fresh Chromium contexts per build; same 1280×720 viewport, local Caddy 2.8.4 servers and existing real external providers. Baseline serves the original checkout; migrated serves dist/public. No CPU/network throttling. Time-to-usable means the 500-unit list is visible and two animation frames have rendered; it does not wait for all external satellite tiles.



| Build | JavaScript decoded bytes | JavaScript encoded body bytes | Median time-to-usable |

|---|---:|---:|---:|

| baseline | 2,213,574 | 641,268 | 1785 ms |

| migrated | 423,190 | 135,781 | 1729 ms |



The encoded JavaScript body is about 79% smaller; decoded JavaScript is about 81% smaller. This comes from explicit OpenLayers imports and removing unused vendor/legacy scripts, including the large icon script. The local timing difference is modest and only three samples were collected; it is not evidence of a universal speed improvement. External request failures before the usable measurement: zero in these samples. Satellite-provider availability and later tile completion remain external factors.



## Delivery and limitations



The backend/admin, approved-account admission, mandatory MFA, database, private storage and publication workflow are not implemented in this milestone. Their proposed design and next implementation plan are separate documents. GeoJSON/photos remain the static source and still need a rebuild to publish updates.



Docker Desktop's Linux daemon was unavailable, so a container build/run was not performed. The Node build and actual Windows Caddy runtime were tested separately. Physical iPhone/Android testing was not performed; WebKit coverage is an engine check.



Legacy rollback/local flag tooling remains available using `npm run dev:legacy` and `/legacy.html`; it is excluded from dist/public. Production rollback should restore the preceding release rather than expose the repository.



## Implementation decisions



- Windows-native task bookkeeping replaced the skill's POSIX helper scripts; equivalent test/RED-GREEN evidence is retained in the ignored plan workspace. Cost if wrong: less automated bookkeeping, with fresh command evidence still available.

- CSS was split at contiguous existing section boundaries and kept in the original import order, with the established later responsive overrides together. Cost if wrong: module names are less pure by responsibility; preserving the cascade avoids a visual change.

- Pin rendering uses one shared vector layer with independent visibility predicates instead of three status layers. Counting/filter semantics and complete pin visibility are preserved; only numeric labels may declutter, as in the baseline. Cost if wrong: future per-layer controls need adapter changes rather than raw layer access.



Independent final review is pending; its result will be recorded here before handoff.
