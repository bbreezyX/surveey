# Same-domain admin routing validation

User approved the latest local admin UI and the original public-map domain with `/admin` on 2026-10-09. Initial activation used local uploads from the isolated modernization worktree. The subsequent Git-backed release is recorded below.

## Preparation checks

- Four new Django routing/session/CSRF tests were observed failing before implementation, then passing after the prefix/cookie changes. Together with seven delivery tests, 11 tests passed.
- Admin and public `svelte-check` reported zero errors and warnings; both Vite builds completed. Fourteen public unit tests passed.
- Before deployment, public HTML and both entry JavaScript/CSS assets matched the production bytes exactly. Existing snapshot publication was `0e9fde94-f1a5-48e3-ad1e-80f9010bdc48` with ETag `249d9c747350a27ea0b84f21281758300feafd03056832794abe88c623838933`.
- First Railway admin build `26a8e2ac-071e-45d8-adc8-533297115eaa` failed because its Docker COPY list omitted the latest UI's shared `src/public/state/list-model.ts`. The exact module was added; replacement `22665dfc-cc12-4f37-9cb9-f1fbdf521025` reported SUCCESS. No database/data migration occurred.
- Replacement admin verified through its temporary external HTTPS hostname before proxy cutover: owner login/logout, missing and foreign-origin CSRF rejected, cookie flags and `/admin/` scope, 550 points and map positions, prefixed photo delivery, login assets available, authenticated app entry denied anonymously.
- Focused read-only reviewer found no introduced prefix/cookie/CSP/asset defect. This is not a broad security certification.

## Existing concern outside routing amendment

The login IP throttle currently keys on Gunicorn's loopback socket peer (`REMOTE_ADDR`), so the 30-attempt/15-minute IP bucket is shared by remote visitors. Account throttling remains separate. This predates this amendment; a trusted client-identity/proxy rate-limit fix remains necessary to prevent one visitor consuming the shared login allowance. Do not blindly trust client-supplied forwarding headers.

## Live cutover

- Public-map deployment `ba0310a2-1b75-4b8c-8cd2-75ecf1ddf2a1` built but failed startup/healthcheck: Windows CRLF made `sh` reject `set -eu`. Startup source normalized to LF and Docker additionally strips CRLF.
- Replacement public-map deployment `e273ed61-e94e-4457-89c9-e245354fac89` reached SUCCESS. Admin deployment `22665dfc-cc12-4f37-9cb9-f1fbdf521025` reached SUCCESS.
- Canonical HTTPS `/admin/`: latest login build and assets served; approved owner login/logout succeeded; missing/foreign CSRF rejected with 403; anonymous APIs/app assets denied with 401; old root API returns 404. Cookies are Secure, HttpOnly, Strict and Path=/admin/. The earlier bare `/admin` check observed 200 without a Location header but did not assert a nonempty body; it therefore did not establish that login rendered at that URL. The correction below addresses this gap.
- 550 points and 550 map positions returned; official 500, reserve 50, unplaced 2 and duplicate/verification 22 counts preserved. Authenticated prefixed photo display returns JPEG.
- Public HTML, JavaScript and CSS remained byte-for-byte equal to the pre-cutover files. Snapshot bytes/publication unchanged; conditional ETag returned 304 and public derivative delivery returned JPEG.
- Actual Chromium check: latest province-map login, owner login, point/photo selection, five read-only admin tabs and logout passed, with zero admin HTTP errors and zero page exceptions. Login at 390px had no horizontal overflow. Screenshots saved only in ignored `.local/`; broader responsive checks remain deferred.
- Removed the old generated admin domain `survey-admin-production.up.railway.app`; final admin service has no public domains or TCP proxies. External old-host HTTP check returned 404. Private admin networking and media broker remain in use.
- ALLOWED_HOSTS variable was tightened for the next admin deployment with skipDeploys=true after removing the old domain; current container may retain the now-unrouted old hostname in its runtime allowlist until the next restart/deploy. This does not restore any public routing.
- Private initial-login file URL now points to `https://survey.esdm.cloud/admin/`; password was unchanged and never emitted.

Broader role/upload/concurrency/session-revocation testing, full responsive visual regression and backup/restore rehearsal remain deferred as previously recorded.

## Source-release preparation

The user explicitly requested all changes pushed to production. Distinct source changes from the primary checkout and implementation worktree were combined, including the admin mockups and portable local launcher. Credentials, local databases, generated builds and OCR crops remain ignored. Shell scripts use LF through .gitattributes. Current documentation and operator smoke routes now match the deployed architecture.

Fresh public/admin builds and Svelte checks passed, along with 14 public unit tests and 11 Django tests. Cross-browser checks passed 54 tests across Chromium, WebKit and Firefox; three serving-header cases were skipped in the local preview and then all three passed against production. The raw drag test now waits for fonts, suppresses incidental startup motion and keeps its target in the viewport; product behavior/UI was not changed. Known credential values were checked against all staged files, Python source compiled, and git diff --check passed.

## Git-backed production release

- User authorized all changes pushed to production. All 174 publishable source paths were committed and pushed to `bbreezyX/surveey@master` as `8dc5af743a06a50e90d9d2d09c0b49b8c1d77597`; direct remote SHA matched the tested commit. The primary checkout was fast-forwarded and clean. Its previous pending source was preserved in a recoverable stash; the 33 ignored OCR crops remain local. The implementation worktree and private local credentials/database remain available.
- All application services were attached to the master branch with their existing Dockerfiles/healthchecks retained. All reported SUCCESS and commit metadata `8dc5af743a06a50e90d9d2d09c0b49b8c1d77597`: admin `06e77eff-476a-45a3-8871-513483fa0d26`, private delivery `ef3f183e-922c-4746-a9e6-08eb651e282c`, public map `c3f2e4bd-8fe1-4c0d-b905-9ac061a01ed5`.
- Post-deployment HTTPS checks passed approved-owner login/logout, CSRF rejection, cookie flags/path, anonymous access denial, all 550 points/map positions, admin photo delivery, publication/snapshot preservation, ETag 304 and public derivative delivery. Public JavaScript/CSS bytes matched the pre-release assets. Cross-platform emitted HTML differed only by a blank line; nonblank HTML content matched. No public layout/product behavior changed.
- Actual Chromium admin browser check passed login, point/photo selection, five read-only tabs, logout and mobile login overflow checks with zero page exceptions/admin HTTP errors. All three production cache/CSP/artifact checks passed on Chromium, WebKit and Firefox. Together with the 54 local browser cases, all 57 browser cases were exercised successfully across the appropriate local/production environments.
- This documentation update is a subsequent master push to exercise the newly connected GitHub autodeploy workflow. Running services still have private networking, separate database roles, and no publicly exposed admin-service/delivery domains or database TCP proxies. Existing broad backend checks and the shared-IP login-throttle concern remain recorded above.

## Bare admin entry regression (2026-10-09)

The reported white page before login reproduced at `/admin`: HTTP 200 with an empty body and no Location header. `/admin/` returned the login HTML and nonempty JavaScript/CSS. The running Caddy adapter interpreted `redir /admin/ 308` as an inner `/admin/` path matcher with destination `308` and status 302. That inner matcher could never match its enclosing `/admin` route.

Changed the directive to `redir * /admin/ 308`; production's Caddy adapter now emits an unconditional inner redirect with Location `/admin/` and status 308. No frontend or authentication behavior changed. `node scripts/check-admin-entry.mjs https://survey.esdm.cloud` is a repeatable anonymous production check for the redirect, nonempty login form, login assets, MIME types and private/no-store responses. It failed against the old production route with `200 !== 308` before the fix.
