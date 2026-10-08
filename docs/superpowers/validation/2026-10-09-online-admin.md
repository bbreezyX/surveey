# Online administration implementation and Railway activation

Implementation lives in branch `codex/public-map-modernization`, isolated managed worktree; the original checkout's file changes are preserved. The user authorized a direct Railway connection on 2026-10-09. No commit/push has been made.

## Implemented

Password-only approved accounts with Argon2, CSRF, throttling, session expiry/revocation and editor/publisher/owner roles; point search/edit/create/archive; authoritative coordinate pair; correction versus new observation; private validated originals/derivatives; reasoned drafts, revision conflicts, history/restoration, transactional snapshots/manifests; revocable public derivatives; exports; owner accounts/audit; backup/restore commands. The public map UI is retained.

## Verified so far on 2026-10-09

- Existing Railway project `survey` resolved; both original and implementation directories explicitly linked to it. PostgreSQL, private bucket, admin and private delivery were provisioned; the existing public site stayed active during setup.
- PostgreSQL migrations applied. Separate service login roles created. Live privilege checks: public cannot read accounts or write publications; neither service role can update historical revisions. Running services do not receive migration ownership.
- Import completed: 550 points, 582 original images, 550 observations/revisions. All 1,164 original/derivative objects uploaded. All source coordinate pairs, point text/status/verification fields, normalized legacy photo/date links and original source checksums reconciled with database records. Counts: official 500, reserve 50, unplaced 2, verification flags 22. Four referenced photos were already missing; 38 unreferenced originals remain private.
- Approved owner `danny` provisioned with a generated random initial password kept only in ignored, owner-readable local storage. Login, CSRF rejection, anonymous API/assets denial, Secure/HttpOnly/SameSite Strict cookies and logout were tested through the real HTTPS admin hostname. Admin returned all 550 points and the expected category counts.
- Seven Django tests passed: private capability required including malformed Unicode input, published derivative bytes served, revoked media/original keys denied, writes denied, readiness requires a publication, and repeated manifest checks reuse one real HTTP connection. Python syntax compiles.
- Railway bucket docs do not demonstrate scoped read-only keys. Public delivery therefore receives no S3 credentials. A private token-protected derivative broker in the trusted admin container performs publication/revocation/retention/key checks; it has no original/admin routes. The broker client disables proxies and redirects.
- The first admin deployment exposed missing home-directory permissions in runtime logs. Its Dockerfile was corrected to create an owned non-root home; unused Gunicorn control sockets were disabled. Successful replacement deployments and live smoke checks were observed.

## Live activation evidence

- All four services reported terminal `SUCCESS`: PostgreSQL `04f178b6-d195-41ac-bb0f-82d8aeff994b`; admin `6f059974-922a-42c1-9ab3-104cc4ac20da`; private delivery `0dcb3f25-6e07-4eb7-a0dd-3c7cef9bad08`; public map `3de1012f-b965-4dc3-bd06-e49cfde0b408`.
- Active baseline: `0e9fde94-f1a5-48e3-ad1e-80f9010bdc48`, 550 features, checksum `249d9c747350a27ea0b84f21281758300feafd03056832794abe88c623838933`.
- Both `https://survey.esdm.cloud` and `https://surveypjuts-production.up.railway.app` returned that exact database snapshot and publication ID. Conditional snapshot requests returned 304. Three sampled derivatives on each origin returned JPEG bytes matching their stored SHA-256 and honored ETags. Admin paths, unknown media IDs and a legacy original image path returned 404 on public origins.
- Actual public JavaScript was retrieved and checked for admin-service references/account API paths and the configured Django/broker/S3 secrets; none were present. Public delivery has no public domains/TCP proxies and its variable inventory contains no S3 credentials.
- The temporary PostgreSQL proxy used for operator setup was removed after reconciliation/cutover. Final networking state is checked separately; later operators must use private jobs/SSH/tunnels.
- Final PostgreSQL proxy inventory is empty. The public service's legacy GitHub trigger was disconnected after cutover to protect the local-upload deployment until the approved implementation is committed/pushed and source wiring is restored.
- Live admin owner login/CSRF/cookie/logout checks passed again on the final deployment. The initial private login file and admin URL were queued in Codex for the user.

No broad security certification or completed visual/restore rehearsal is claimed.

## Deferred checks

Full role matrix, session expiry/password-reset/disable revocation, malicious uploads, stale and competing publish transactions, responsive/keyboard UX, final public visual regression and a complete backup/restore rehearsal remain deferred. Initial checks performed here are the minimum connection/runtime boundaries needed for this authorized activation, not substitutes for those checks.

See `docs/railway-deployment.md` for verified resource identifiers, hostnames, variables and the private media architecture. The older local import/build metrics were preparation evidence; this record now distinguishes live deployment results.

## Subsequent same-domain amendment

The user then approved the latest admin UI on `https://survey.esdm.cloud/admin/`. This supersedes the earlier separate admin hostname and the old statement that admin paths return 404 on public origins. The old generated admin domain was removed. See `2026-10-09-same-domain-admin.md` for actual deployment/browser/HTTPS results and an existing shared-IP login-throttle concern.
