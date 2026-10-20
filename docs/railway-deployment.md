# Railway production connection

Direct connection was authorized on 2026-10-09. This uses the existing `survey` project, ID `ebebdd21-0358-4ab1-a0d5-1afe4ee2673b`, production environment `6abf965b-42d4-44ad-8b15-55c8be2adc76`. Actual deployment/cutover results are in `superpowers/validation/2026-10-09-online-admin.md`; broad verification and restore rehearsal remain deferred.

## Resource layout

| Resource | Dockerfile / source | Networking |
| --- | --- | --- |
| `surveypjuts` (`09469b8d-578c-4c02-89dd-0b62de14d6ca`) | `server/deploy/Dockerfile.railway-public-map` at cutover | `survey.esdm.cloud` and existing Railway domain |
| `survey-admin` (`55d8e517-529a-4985-bc66-0bad6f5e16d4`) | `server/deploy/Dockerfile.admin` | `survey.esdm.cloud/admin/` through public-map Caddy; private admin on 8080 and broker on 9001 |
| `survey-public-data` (`873d72e9-1711-495d-b62d-825681972117`) | `server/deploy/Dockerfile.public-data` | `survey-public-data.railway.internal:8080`; no public domain/TCP proxy |
| `Postgres` (`ca38ef07-1f75-4191-a905-af3a9af4a423`) | PostgreSQL 18 SSL template and persistent volume | `postgres.railway.internal:5432`; temporary operator proxy removed after setup |
| `survey-private-media` (`47e77464-c207-4932-b355-2d3773dd05bb`) | Private Railway S3-compatible bucket, Singapore | Authenticated HTTPS storage API |

Keep repository root as every build context. Live service settings explicitly select the Dockerfile, region, limits, healthcheck and restart policy. Railway MCP rejected configuring a JSON Config as Code path as deprecated; the JSON examples are earlier references, not the active configuration. Caddy is pinned to 2.11.7. All CLI uploads use explicit project/environment/service IDs because the original folder previously inherited an unrelated project link.

The initial activation used local uploads, temporarily disconnecting the old public-service trigger to protect uncommitted implementation code. The user subsequently requested all source changes pushed to production. The canonical repository is now `bbreezyX/surveey`, and all three application services are connected to its `master` branch. Their custom Dockerfile and healthcheck settings above remain active. Push with `git push origin master`; Railway builds each service from that branch. Verify each deployment reaches SUCCESS and its commit metadata matches the remote SHA. The initial Git-backed code release was `8dc5af743a06a50e90d9d2d09c0b49b8c1d77597`; see the same-domain validation record for live checks. The older `bbreezyX/surveypjuts` remote alias resolves to this canonical repository; the primary checkout now uses the canonical URL.

## Security boundaries

Railway supplies HTTPS. Admin Caddy listens on injected port 8080 with a 21 MB request limit, connecting only to Gunicorn on loopback 9000 and replacing a private HTTPS assertion. Gunicorn trusts it only from loopback. Admin cookie names are `survey_admin_session` and `survey_admin_csrf`, scoped to `/admin/`. Cookies are Secure, HttpOnly and SameSite Strict; Django enforces CSRF. No manual origin certificate is needed. Never expose 9000 or 9001 through public domains/TCP proxies. Processes run as an unprivileged OS user with a writable home; unused Gunicorn control sockets are disabled.

Public Caddy forwards `/admin/*` to the private admin service, and `/data/points.geojson` and `/media/*` to private delivery. `/admin` redirects to `/admin/`. Admin responses keep their own restrictive CSP and no-store policy; map headers apply only to public paths. That image contains no account app, admin routes/build, login templates or sessions. Its separate PostgreSQL login belongs to `survey_public_read`, with SELECT privileges on delivery tables only. Admin has a separate `survey_admin_write` login, without update/delete privileges on audit, revisions, observations, evidence, publications or grants. Migrations/cleanup use operator credentials. Live role checks verified these boundaries; grants are in `server/deploy/roles.sql`.

Railway bucket credentials do not document prefix-scoped read-only keys. Public delivery therefore receives **no S3 credentials**. It calls a capability-protected broker inside the trusted admin container at `survey-admin.railway.internal:9001`. This registers only `GET /media/<32 hex ID>`, requires a random service token, independently checks publication membership, revocation, retention and a `display/*` key, then retrieves the derivative. No original-file or administration routes are registered. Public admin Caddy never forwards to that listener. The client disables HTTP proxies/redirects so its capability stays on the private endpoint. Railway encrypts private service traffic with WireGuard.

Bucket-wide credentials remain in the trusted admin/operator boundary. Unique keys and conditional writes protect originals at application level; Railway does not provide Object Lock/versioning here. Retain independent backups. The static map receives no database, bucket, broker or admin secrets. Its cutover image excludes all legacy original images and the obsolete static points file; it copies only public build assets, branding/icons and regional geometry. Public UI/styles are preserved.

## Variables

All Django services need `SURVEY_DEPLOYMENT=railway`, separate random `DJANGO_SECRET_KEY` (50+ characters), explicit `ALLOWED_HOSTS`, restricted `DATABASE_URL`, `DB_SSLMODE=require`, `PORT=8080`, and a random private `MEDIA_BROKER_TOKEN` (50+ characters). Railway injects its environment ID. Local mode is rejected online.

Admin also needs `ADMIN_ORIGIN`, `PUBLIC_ORIGIN` for private broker settings, and `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `S3_ADDRESSING_STYLE`. Use `ADMIN_ORIGIN=https://survey.esdm.cloud`. Its host allowlist includes `survey.esdm.cloud`, the existing map Railway hostname, and `survey-admin.railway.internal`. Use the actual S3 bucket name and URL style reported by bucket credentials.

Public delivery also needs `PUBLIC_ORIGIN=https://survey.esdm.cloud`, both existing map hostnames in its allowlist, and `MEDIA_BROKER_URL=http://survey-admin.railway.internal:9001`. Its image selects public settings and receives no `S3_*` credentials. Public map needs `PORT=8080`, `PUBLIC_DATA_HOST=survey-public-data.railway.internal`, `PUBLIC_DATA_PORT=8080`, `PUBLIC_ADMIN_HOST=survey-admin.railway.internal`, `PUBLIC_ADMIN_PORT=8080`. Admin healthcheck uses `/admin/`; delivery uses `/health`, which requires an active publication. `healthcheck.railway.app` is explicitly allowed.

Public map and admin both need `VITE_GOOGLE_MAPS_KEY`, the Map Tiles API key. Their Dockerfiles declare it as a build `ARG`, so a change takes effect on the next build, not a restart. It is visible in the bundle by design and guarded by its Google Cloud restrictions: HTTP referrer `https://survey.esdm.cloud/*` (plus local dev origins), API Map Tiles API only, and a daily request quota. Without the key, or once Google refuses it, both maps fall back to Esri. See docs/basemaps.md.

## Operator access and recovery

The explicitly approved first owner is `danny`. Its generated initial password is stored only in ignored `.local/railway-admin-login.txt`, restricted to the local Windows user. Change it through the password form after login. No public signup/default account exists. Normal recovery uses `python manage.py provision_account <approved username> --role owner` with private password prompts; never place passwords in shell arguments, Git or chat.

`scripts/railway-operator.py` captures credentials privately and sends secret variable values through stdin. Operator configuration is kept in ignored owner-readable `.local/railway-operator.json`. This helper contains verified non-secret IDs for this deployment; it is not a generic discovery tool. The temporary SSL PostgreSQL proxy is removed after setup. Later operator jobs should use Railway SSH/tunnels or a controlled private process.

Inventory includes 550 points and 582 originals, four missing photo references and 38 unreferenced originals preserved privately. Full coordinate precision is retained. Import refuses to overwrite existing points/photos and does not publish automatically. Baseline publication uses the approved owner's permission and creates an immutable snapshot/manifest. Later edits pass through drafts; refreshed maps receive published changes without redeploying JavaScript.

Pause writes/publication for consistent backups. Keep a PostgreSQL custom-format dump with every referenced original/derivative and a verified checksum manifest. Commands are in `admin-operations.md`; restore into an isolated database and empty bucket. Railway documents no automatic bucket backup, Object Lock or versioning. Full restore, broader upload/role/concurrency/browser checks, and final visual regression remain outstanding.

## Primary references checked on 2026-10-09

- [Railway HTTPS edge](https://docs.railway.com/networking/public-networking/specs-and-limits)
- [Encrypted private network](https://docs.railway.com/networking/private-networking/how-it-works)
- [Private buckets and limitations](https://docs.railway.com/storage-buckets)
- [Healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Config as Code migration](https://docs.railway.com/infrastructure-as-code#migrating-from-config-as-code)
- [Caddy 2.11.7](https://github.com/caddyserver/caddy/releases/tag/v2.11.7)

## Same-domain routing amendment

The user approved the latest local admin UI and requested the original public-map domain on 2026-10-09. Production public map is `https://survey.esdm.cloud/`; administration is `https://survey.esdm.cloud/admin/`. Local admin is `http://127.0.0.1:8130/admin/`. The path is not a security secret: account authorization, CSRF, scoped cookies, throttling and private services enforce access. Sharing a hostname also shares the browser origin; cookie Path limits where cookies are sent but does not isolate the admin from scripts on that origin. Keep public scripts and CSP protected. This supersedes the earlier separate-admin-host requirement. Deployment evidence is recorded in `superpowers/validation/2026-10-09-same-domain-admin.md`.

## Offline and weak-signal delivery

The public map registers `/sw.js` (source `scripts/service-worker.js`, filled in by `scripts/build-public-assets.mjs` after `vite build`). It precaches the hashed shell, answers `/data/points.geojson` and `/data/regions.json` network-first with a 5-second grace before the stored copy, keeps the 60 most recent `/media/*` photos, and stores esdm.cloud's public build-progress list the same network-first way so pins keep their stage offline. It never handles `/admin/`, imagery tiles or any other cross-origin request; the Lapor link opens the esdm.cloud field app, whose own worker opens `/lapangan` and queues reports offline once the phone has visited it online. The page refreshes itself without resetting the reader's place: on `online`, on returning to the tab after five minutes, every 30 seconds while showing a stored copy, and when the worker reports that a slow download brought different data. Caddy serves `/sw.js` with `no-cache` so a deploy reaches phones on their next visit, and `file_server { precompressed br }` serves the build's max-quality `.br` files. `Dockerfile.railway-public-map` copies those files by name: a new top-level public file must be added there too.

Satellite imagery is never stored for offline use: Google's Map Tiles policies forbid offline use and caching beyond `Cache-Control`, and Esri's offline use needs an ArcGIS licence. Without a connection the map switches to a pale land background with dark kabupaten lines, and a status chip (`ConnectionStatus.svelte`, fed by `src/public/state/connection.svelte.ts`) says "Tidak ada internet". The same chip reports "Memuat data titik…" on phones. Data or visible imagery pending for more than 3 seconds starts a connection-quality check. Each sample downloads the existing approximately 9 KB `/favicon.ico` with `no-store`, including its body: HEAD alone misses low bandwidth with fast response headers. "Sinyal lemah" requires three consecutive independent slow samples, scheduled 5 seconds apart. A sample is slow when its total exceeds 3 seconds, or at least 4 KB transfers for at least 500 ms below 16 KB/s; receiving headers before the 8-second body timeout also establishes slow transfer. One fast sample clears the warning even if the imagery provider is still slow. Browser 2G estimates, hidden layers, abandoned views and released tiles do not establish weak signal. This estimates connection quality rather than measuring Wi-Fi radio strength. An unsuccessful quality sample alone does not mark the page offline; browser events and probes triggered by failed data/tile requests retain that responsibility, so a dead link never switches the basemap to Esri as if Google had refused the key.
