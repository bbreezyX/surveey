# PUTS 2026 — UI/UX polish pass ("proper website")

Date: 2026-07-08
Trigger: design critique of the current build; user approved acting on all findings
("improve the UI/UX for everything, make it a proper website").

## Scope

Surgical fixes to the existing design system — no redesign, no new features beyond
web-platform hygiene. Everything traces to a critique finding or to "proper website"
completeness (metadata, loading state, language).

### Accessibility (red/yellow findings)
1. `--muted-2` #7e8fa0 fails AA at 3.3:1 → darken to `#64778c` (4.6:1 on white).
   Heals section labels, inactive tabs, item codes, footer, placeholders in one token.
2. Grouping tabs ~25px tap height → pad to ≈40px (`padding: 10px 4px 12px`).
3. Popup closer 28px → 36px.
4. Viewport meta drops `maximum-scale=1, user-scalable=no` → pinch text zoom allowed
   (OpenLayers handles its own map gestures).
5. Active tab underline: keep yellow but back it with a 1px ink edge (two-tone), same
   trick as the active item dot. State is already redundant via text color; this is polish.

### Usability
6. Layer switcher: `activationMode: 'click'` (was hover) with `label`/`collapseLabel`
   set to `''` so the SVG chip icon stays. Map click and Escape also close the panel.
7. Mobile sheet peek: raise `--sheet-peek` so the first list row peeks above the fold
   (also required anyway — taller tabs consume the old 178px). Landscape variant +4px.
8. "tampil" stat hidden when it equals the total (only meaningful when filtering).
9. Search placeholder shortened to fit 375px: "Cari nomor, nama, alamat...".
10. Group/pengusul names normalized at render: title-case words, preserve degree
    suffixes (SH, SE, ST, …) as uppercase. Fixes "PUTRA ABSOR HASIBUAN, SH" without
    breaking "Sapuan Anshori, SE". Applied at item build so grouping keys merge too.

### Correctness
11. Data-load watchdog: a load completing after the 20s timeout currently leaves a
    permanent error (`hasResolvedDataLoad` blocks recovery). Track a three-state
    `pending/done/failed`; `featuresloadend` recovers from `failed`.

### "Proper website" hygiene
12. `<html lang="id">` (page is Indonesian; currently "en").
13. Open Graph + Twitter card meta (no og:image/og:url — no canonical domain known).
14. Loading state in the list area (spinner + "Memuat data titik…") shown until init
    or error replaces it; static under `prefers-reduced-motion`.
15. `<noscript>` message card.
16. Radius token cleanup: `--radius-xs: 6px`, `--radius-sm: 8→10px`, replace hardcoded
    6/9/10px radii with tokens. 18px sheet corner stays literal (unique).
17. Bump `?v=` cache tokens on edited assets (repo convention).

## Explicitly out of scope
- About/info modal, og:image, self-hosted fonts, sheet drag physics, safe-area
  insets (would require viewport-fit=cover and a notch device to verify).

## Verification
Preview server at 1440×900, 375×812 and 740×360: contrast re-inspected via computed
styles, layer panel click/map-click/Escape behavior exercised, peek shows first row,
watchdog recovery not directly testable (code-reviewed), all states screenshotted.

## Found and fixed during verification
- Layer chip's own click also fires OL `singleclick`, which re-closed the panel →
  guard clicks originating inside `.layer-switcher`.
- Vendor `ol-layerswitcher.css` shown-state rule strips the chip icon and re-docks
  the button in click mode → restore chip, stack panel below it (both breakpoints);
  the mobile `margin-top: 56px` panel offset became redundant and was removed.
- `scrollIntoView` on list highlight scrolls `html`/`body`, shifting the fixed shell
  up 46px (pre-existing) → replaced with container-scoped scrolling of
  `.sidebar-scroll`.
- The popup card renders inside OL's `ol-overlaycontainer-stopevent` (a z-index:0
  stacking context) and was painted *under* the bottom sheet on tall cards
  (pre-existing) → lifted to z-index 21 on mobile.
