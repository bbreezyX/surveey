# Survey administration

Implemented locally and connected to the existing Railway `survey` project on 2026-10-09 at the user's request. Approved-account **password-only** access supersedes mandatory MFA/Cloudflare Access. The approved first owner is `danny`; its generated initial password is in the ignored private local login file. See `railway-deployment.md` and the validation record for deployment/cutover evidence. Broad verification remains deferred.

## Local setup

Use Python 3.12 and the existing Node/npm toolchain. Run from the implementation worktree:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r server/requirements.lock
npm ci
npm run build:admin
npm run admin:local -- migrate --noinput
npm run admin:local -- import_legacy --geojson data/points.geojson --images images --report .local/import-report.json
```

The last command is a dry run. Review every reconciliation error/warning and the per-record/photo inventory, then import into an empty local database:

```powershell
npm run admin:local -- import_legacy --geojson data/points.geojson --images images --report .local/import-report.json --apply
npm run admin:local -- provision_account <approved-account-name> --role owner
npm run admin:local
```

Provisioning prompts privately for a new password of at least 15 characters. No default account/password exists. Visit `http://127.0.0.1:8130/admin/`. The local command binds loopback, keeps its random session secret, SQLite database and private originals in ignored `.local/`, and never modifies repository data/images. Local mode is deliberately explicit and must not be used online. Existing public preview remains on its existing port and static data until cutover.

## Workflows

- Search a point, inspect its current state, then save a reasoned draft. A pending draft does not change public data.
- Enter coordinates or click/drag the map pin; both use one longitude/latitude pair. Location verification stays a separate flag.
- A photo/data correction retains the existing survey date and observation identity. A new visit requires an explicit date, source and photo. Original evidence and previous revisions remain private and recoverable.
- Publisher/owner: review changes, distance, photo comparison and count impact; select up to 100 drafts, at most one per point; publish. Concurrent/stale revisions return HTTP 409. A failed publication rolls back point changes and the active publication together.
- Restore a historical revision by creating a new draft with a reason. Archive instead of deleting points. New points begin archived and require an activation draft.
- Owner: provision approved accounts; set roles, reset passwords, disable access. Access/password changes revoke previous sessions. The last active owner cannot be removed through the API.
- Public media revocation is an explicit owner action with a reason. Historical originals stay private. Display responses revalidate to honor revocation; already downloaded bytes cannot be retrieved from a visitor's device.
- Publication screen exports the active GeoJSON and a spreadsheet-compatible CSV. Unreferenced legacy photos remain in “Bukti lama”; no historical visit is fabricated for them.

## Production boundaries

**Hosting target selected 2026-10-09: Railway.** Use [railway-deployment.md](railway-deployment.md) and its service JSON/Dockerfiles for that path. Its edge HTTPS and encrypted private network replace the generic manual-origin-TLS setup below. The generic setup remains an alternative deployment template.

The public map and admin have separate builds (`dist/public`, `dist/admin`) and origins. The public image copies only allowlisted static files. The public-data Dockerfile does not copy the account app, admin URLconf, login templates or admin build. Public data has only the active snapshot and allowlisted derivative routes. Public JS needs only `/data/points.geojson` and opaque `/media/<id>` URLs, no administration routes. Authorized administrators can still inspect their own browser requests; passwords protect access, not URL visibility.

Production fails closed when required configuration is absent; no local SQLite or filesystem fallback is permitted. Run migrations with an operator role, then apply `server/deploy/roles.sql` and grant its privilege groups to separate login roles. Keep migration ownership away from services. The generic external-S3 variant uses a display-only read key. Railway gives public delivery no S3 credentials, instead using a private capability-protected derivative broker. Its live settings are documented in the Railway guide; the generic certificate templates below are not used on Railway.

Deploy `server/deploy/Dockerfile.admin` and `Dockerfile.public-data` separately. Gunicorn serves TLS using mounted origin certificates; the private reverse proxies must validate those certificates with a trusted CA. Do not set `tls_insecure_skip_verify`. Keep application origins private/firewalled and use the request-size-limited admin proxy. TLS is recognized from the actual connection rather than spoofable forwarding headers. Set host allowlists to the proxy-preserved controlled hostname. Separate public delivery needs only its own `PUBLIC_ORIGIN`, never admin identity/password configuration.

The example Caddy handlers target the current documented `tls_trust_pool` syntax and explicitly preserve the incoming Host header across HTTPS proxies (Caddy 2.11+ otherwise changes it). They are **templates**, not an activated cutover; verify syntax against the selected deployed Caddy version before use. Add only the two public read routes to the existing public Caddy site after staging approval; preserve its other CSP/static/UI behavior. Build the public map once to include the opaque-photo URL resolver. Existing static data/images remain a recoverable prior release. Following activation PostgreSQL is the editable authority; repository scripts are offline export/legacy utilities and cannot reach the private database without operator credentials.

## Backups and recovery

Pause admin writes/publication during a consistent backup. Use operator credentials privately (never shell arguments containing a literal secret):

```text
pg_dump --format=custom --file=survey.dump <operator connection configured through protected environment/service file>
python server/manage.py backup_media --output <new private backup directory>
```

The media command copies every DB-referenced original and derivative and verifies SHA-256. Store dumps/manifest/objects together in encrypted backup storage with restricted access and retention. Restore into a **new isolated staging database and empty storage**, never the active service:

```text
pg_restore --no-owner --exit-on-error --dbname=<new isolated database> survey.dump
python server/manage.py restore_media --input <backup directory>
python server/manage.py restore_media --input <backup directory> --apply
```

The dry run verifies all checksums/path shapes before any write. Restoration refuses to overwrite existing objects. After restoring, reconcile point/observation/revision counts, active checksum and every manifest image; test login, permissions and a complete new publication. A database/storage restore rehearsal has not yet been run. Rollback traffic to the previous static release while repairing the new service; keep its snapshots and evidence intact.

`cleanup_uploads` reports unreferenced temporary uploads older than 24 hours; `--apply` requires separate operator delete credentials. It protects saved revisions, pending drafts, observation evidence, published media and all original legacy evidence. Run cleanup only with writes paused to avoid a race with draft saves. Sessions/rate-bucket housekeeping and storage-orphan inventory should be scheduled operationally; no schedule has been installed.

## Deferred validation

The user requested features first, then explicitly authorized direct Railway activation. Live startup/TLS, approved-owner login/logout, CSRF rejection, cookie flags, anonymous API/assets denial, database privilege checks, complete source-data reconciliation, active snapshot/ETag delivery and sample derivative checksums were verified during connection. The private media boundary has seven passing Django tests. See the validation record for exact successful deployment IDs and public cutover evidence.

Full throttling/session-expiry/password-reset/disable coverage, every role, malicious uploads, stale/competing publication transactions, historical media retention, responsive/keyboard flows, final visual regression and a complete backup/restore rehearsal remain deferred. The connection checks are not a broad security certification.

Dependencies were checked against Django's supported-release list and package registries on 2026-10-08 and pinned in the lockfiles. Django 5.2.18 is the chosen LTS patch. See [Django releases](https://www.djangoproject.com/download/), [deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/), [Railway private buckets](https://docs.railway.com/storage-buckets), and [CISA's MFA explanation](https://www.cisa.gov/audiences/small-and-medium-businesses/secure-your-business/require-multifactor-authentication) for the protection that password-only omits.
