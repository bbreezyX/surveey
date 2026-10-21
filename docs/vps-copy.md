# Surveey di VPS dengan database dan media Railway

Mulai dari [handoff Railway–VPS](railway-vps-handoff.md). Untuk perangkat baru,
gunakan [panduan Mac](mac-operations.md), bukan helper Windows `.local` yang
pernah digunakan saat persiapan.

## Arsitektur dan layout yang diterapkan

Produksi menggunakan Cloudflare Tunnel menuju aplikasi di VPS; PostgreSQL dan
media tetap Railway. Aplikasi Railway dipertahankan sebagai cadangan aplikasi
dengan sumber data yang sama. Tidak ada salinan database produksi terpisah di VPS.

Setelah autodeploy pertama, layout aplikasi menggunakan rilis versi:

| Path | Penggunaan |
|---|---|
| `/srv/surveey/releases/<id>` | Rilis kode, aset dan virtualenv per rilis |
| `/srv/surveey/current` dan `/srv/surveey/previous` | Pointer rilis aktif/sebelumnya |
| `/srv/surveey/app`, `/srv/surveey/public-app`, `/srv/surveey/static` | Alias melalui current |
| `/srv/surveey/releases/before-autodeploy` | Baseline sebelum konversi layout |
| `/srv/surveey/deploy` | Konfigurasi edge/tunnel di luar paket rilis |
| `/srv/surveey/private` dan `/srv/surveey/tls` | Env/token/certificate privat, tidak ikut Git |
| `/srv/surveey/media`, `/srv/surveey/snapshots/initial`, `/srv/surveey/postgres` | Salinan awal media dan cluster kosong yang tidak dipakai produksi |

Pada uji **21 Oktober 2026 pukul 23.15 WIB**, deploy VPS dari push master dan
pemeriksaan baca berhasil. Railway masih queued dan akses HTTP cadangannya
belum lolos. Lihat [hasil uji](autodeploy-test-2026-10-21.md) serta
[alur autodeploy aktif](autodeploy-vps.md). Hasil itu mencatat keadaan saat uji,
bukan bukti kondisi live setelah setiap commit berikutnya.

## Arsip pelaksanaan awal

Catatan berbahasa Inggris di bawah mempertahankan riwayat persiapan sebelum
autodeploy. Batas scope seperti belum boleh push, cutover atau tes mengacu pada
tahap historis tersebut; tahap berikutnya diotorisasi dan dicatat terpisah.
Sumber skrip/template terkait kini ada di [direktori operasional VPS](../server/deploy/vps/README.md).
Jangan menjalankan kembali installer awal pada produksi atau Mac hanya untuk
melanjutkan pekerjaan dari perangkat baru.

The approved scope includes activating Surveey applications, configuring direct private web access through Tailscale, and temporarily moving production routing for `survey.esdm.cloud` to the existing Niskala VPS, keeping PostgreSQL and media on Railway. The user subsequently deferred the proposed Railway application shutdown and explicitly requested that Railway remain running as the main standby. Keep all three Railway application services, PostgreSQL, its volume and the bucket available. The attempted zero-replica and CLI shutdown operations returned errors; the dashboard deployment removal confirmation was cancelled. Do not resume application shutdown without a new user instruction. The user authorized the PostgreSQL TCP proxy and accepted a brief database interruption if needed. Testing remains opt-in for each task. No Git commit/push or changes to Niskala's existing public listener are included.

The full recovery guide is [Mengembalikan produksi Surveey ke Railway](return-to-railway.md). It distinguishes returning with the database/media that are already on Railway from a future migration if production data later moves to the VPS. No production PostgreSQL dump was successfully produced during the VPS copy preparation.

The frontend `surveypjuts` autodeploy was briefly disabled during shutdown preparation and was restored to `master` with **Auto deploys when pushed to GitHub** after the user deferred shutdown. No deployment removal was confirmed. The other two application autodeploy settings, database, bucket, VPS and Niskala were not changed by the cancellation. No new application or database checks were run for this cancellation.

## Temporary public production origin

The user subsequently authorized temporary production routing to the VPS. A separate remotely managed Cloudflare Tunnel named `surveey-niskala-vps` was created in account `b609d8c1b1f93a0ef108139c90542382`, with ID `6e53a53e-ff83-45c6-a2a4-dd30fa5c33e5`. The VPS connector is its own `surveey-tunnel.service`, running as a dynamic unprivileged account within the existing Surveey resource slice, with a 128 MiB individual memory ceiling. The slice's 704 MiB memory and 75%-of-one-core CPU ceilings remain unchanged.

`configure-public-origin.py` installs only Surveey files, adds `survey.esdm.cloud` and `https://survey.esdm.cloud` to the existing host/origin lists, and imports the separate `Caddyfile.production` into Surveey's Caddy configuration. The production origin is HTTPS on **127.0.0.1:18444**. Existing private access on Tailscale port 18443 is retained. The connector's token is stored in a root-only file and exposed only to its service through systemd credentials; it is never included in command arguments or application environment files.

The production origin uses its own self-signed certificate for `survey.esdm.cloud`, created with 365-day validity. Cloudflare Tunnel is configured with service `https://127.0.0.1:18444`, **Origin Server Name** and **HTTP Host Header** `survey.esdm.cloud`, and **CA Pool** `/srv/surveey/tls/production-origin.crt`, leaving **No TLS Verify** disabled. The private origin certificate is trusted explicitly by this connector; public visitors use Cloudflare's edge certificate. Renewal of this origin certificate must be coordinated with the connector trust pool if this temporary deployment remains in place. The dedicated loopback origin redirects visitor HTTP to the canonical HTTPS URL using Cloudflare's overwritten `X-Forwarded-Proto` header; Django's forwarded-header trust remains disabled.

The installer returned exit code **0** for both restarting the four Surveey application/edge services and enabling/starting the connector. This records command completion, not functional health. The Cloudflare route and DNS save actions are recorded separately from VPS preparation in `/srv/surveey/PUBLIC_ORIGIN_CONFIGURED.json` and `/srv/surveey/PRODUCTION_CUTOVER.json` when applicable. No application HTTP request, login, database probe or post-change verification is authorized.

Before cutover, the Cloudflare DNS console showed `survey.esdm.cloud` as a **CNAME to `kly7n6wa.up.railway.app`**, **DNS only**, **TTL Auto**, with no comment or tags. The snapshot is stored in the ignored local preparation directory and `/srv/surveey/private/production-dns-before.json`. The public route save returned **Route added successfully**. The existing DNS record was then edited in place; the save result showed CNAME **`6e53a53e-ff83-45c6-a2a4-dd30fa5c33e5.cfargotunnel.com`**, **Proxied**, **TTL Auto**. This is evidence of provider configuration saves, not a DNS propagation or application request test. Railway's services, original custom-domain association and verification TXT record are retained.

To return production to Railway, first reactivate its application deployments if they have been stopped, following [the recovery guide](return-to-railway.md). Then edit only the existing `survey.esdm.cloud` record back to CNAME `kly7n6wa.up.railway.app`, set **DNS only** and **TTL Auto**, after confirming the recorded Railway target is still assigned. This rollback instruction has not been executed. It needs no database restore because both deployments use the same Railway database and bucket. Do not remove verification TXT records or overwrite unrelated DNS records. Cache propagation can leave clients on either deployment temporarily during either transition.

Cloudflare Tunnel setup follows the [official tunnel deployment guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/), [origin TLS parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/), and [token-file service parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/). The Cloudflare connector returned internal errors for this operation, so the authenticated browser console is used for the provider changes.

## Current activation record

On 21 October 2026, `systemctl enable --now surveey-admin.service surveey-public.service surveey-broker.service surveey-edge.service` completed with exit code **0**. All four units were registered for automatic startup. This records the activation command's result; it is not a functional health check or evidence that every process remains healthy.

The previous endpoint configuration returned `configured_inactive` with `database_endpoint_configured=true`. That preparation record is retained as history; activation is recorded separately in `/srv/surveey/ACTIVATED.json`.

- Application code, built public/admin assets and private Python dependencies are installed under `/srv/surveey`.
- `SURVEY_DEPLOYMENT=vps` and `SURVEY_DATA_SOURCE=railway` select Railway storage and the Railway application database credentials.
- The existing Railway admin database role is used by the admin service. Public delivery and the local media broker use the separate public database role. Database operator credentials are not installed in application configuration.
- Admin and broker use the original Railway bucket over HTTPS. Public delivery receives no bucket credentials and obtains only published derivatives through the capability broker on loopback.
- Admin uses the existing production Django signing secret so it can interpret sessions in the shared production database. The local broker has its own capability token; Railway's broker token was not changed.
- PostgreSQL on the VPS is no longer a dependency of the application services. The previous empty local cluster and copied media are retained and unused.
- The admin, public delivery, broker and private edge units were enabled and their start command completed. PostgreSQL on the VPS was not started. `/srv/surveey/private/railway-db-endpoint.json` supplies the configured external database endpoint.
- No manual database connection, HTTP request, login attempt, migration, media upload, restore, test, browser check or post-change verification was performed. Normal application startup was the requested operation.

`/srv/surveey/HYBRID_CONFIGURED.json` records configuration preparation. `/srv/surveey/ACTIVATED.json` records the later activation action. Neither is proof of application health or working database connectivity. Earlier `CONFIGURED.json` is retained as historical isolated-copy preparation state.

## Private access

On 21 October 2026, direct HTTPS access was configured for the private Tailscale addresses on port **18443**, retaining the existing loopback listener. A separate Tailscale grant was saved for `mdanyprayudhaa@gmail.com` to reach `100.64.182.105` and `fd7a:115c:a1e0::4729:b66a` on **TCP 18443**. Existing Windows and CI SSH grants, tag ownership and the empty Tailscale SSH policy were preserved.

From a device connected to the same tailnet and owned by that account, the configured addresses are:

- Public interface: <https://100.64.182.105:18443/>
- Admin: <https://100.64.182.105:18443/admin/>
- MagicDNS alternative: <https://niskala-udara.tailc60422.ts.net:18443/>

An SSH forward is no longer required by this configuration. HTTPS uses a separate self-signed certificate with a 90-day validity period and SANs for the Tailscale IPv4/IPv6 addresses, MagicDNS FQDN and existing loopback alias. Browsers will not trust it automatically. No browser/system trust store was changed, and tailnet-wide HTTPS certificate issuance was not enabled. Backend TLS continues to use the existing preview certificate.

Only Surveey's own Caddy configuration and its explicit application host/HTTPS origin lists were updated for private access. The Niskala Caddy process on public ports 80/443 was not changed or restarted. Binding to specific private addresses follows the [Caddy bind directive](https://caddyserver.com/docs/caddyfile/directives/bind); access is restricted by the tailnet's [grants policy](https://tailscale.com/docs/reference/syntax/grants). This earlier Tailscale access operation did not change Cloudflare/DNS or Railway configuration; the later public routing authorization is documented above.

The preparation script is `server/deploy/vps/configure-tailnet-access.py`, with `Caddyfile.tailnet` and `configure-railway-data.py` staged alongside it. It keeps previous private configuration in `/srv/surveey/private/configuration-history/tailnet-*`, stores the permitted web hosts/origins in `/srv/surveey/private/web-access.json`, and restarts only `surveey-admin`, `surveey-public`, `surveey-broker` and `surveey-edge`. The Railway credential refresh configurator reads the retained web access metadata so it does not discard these hosts/origins later. The initial loopback-only `Caddyfile` remains available for the earlier isolated-copy workflow.

The Surveey restart command returned exit code **0**, and the Tailscale console displayed **Saved tailnet policy file**. `/srv/surveey/TAILSCALE_ACCESS.json` records the configuration action. Neither outcome is a runtime health check. No web request, login, database probe, browser application check, build for validation or post-change verification was performed. The old loopback URL `https://surveey.localhost:18443` remains configured if an existing SSH forward is used.

To revoke this private web access later, remove only the grant for this account to TCP 18443 and restore Surveey's previous edge configuration and web environment keys from its private history. Preserve the existing SSH/CI grants and all database/media configuration. Do not restore the entire tailnet policy over later unrelated changes. Revocation is documented here but has not been performed.

## Applied database networking

Source PostgreSQL service: `ca38ef07-1f75-4191-a905-af3a9af4a423`. Project: `ebebdd21-0358-4ab1-a0d5-1afe4ee2673b`. Production environment: `6abf965b-42d4-44ad-8b15-55c8be2adc76`.

The original source had no public TCP proxy. The user-approved networking change has now been applied, and the endpoint returned by Railway has been installed in all three VPS application connection strings.

Applied PostgreSQL TCP proxy:

- Patch ID: `dcddfedf-23eb-47d9-9100-ea35e359b7e6`, containing only application TCP port **5432** on this Postgres service when approved/applied.
- Commit response: `committed=true`, deployment workflow triggered.
- Workflow: `commitChanges/6abf965b-42d4-44ad-8b15-55c8be2adc76/dcddfedf-23eb-47d9-9100-ea35e359b7e6`.
- Proxy ID: `89d76739-0ba4-4c2d-8396-a50d96f83fb7`.
- External endpoint: **`centerbeam.proxy.rlwy.net:29929`**, forwarding to PostgreSQL **5432**.
- Railway reported proxy synchronization status **ACTIVE** in the endpoint lookup required to configure the VPS. This is platform state, not an application connectivity test.

VPS environment files now use this external endpoint while retaining each application's original restricted database role and database name. PostgreSQL TLS remains required (`DB_SSLMODE=require`). The endpoint record explicitly says `connection_tested=false`; no SQL connection or application request was made to demonstrate connectivity.

## Refreshing endpoint configuration

The local `.local/vps-copy/configure_hybrid.py` reads required source application variables privately and sends selected credentials to the root-owned VPS configurator through ordinary OpenSSH over Tailscale. Credentials travel through stdin, not shell arguments or chat output. The database operator username is used to reject operator credentials; its password is never sent to the VPS.

The historical Windows command was `.venv/Scripts/python.exe .local/vps-copy/configure_hybrid.py --db-host centerbeam.proxy.rlwy.net --db-port 29929`. That private local helper is not part of Git and is not required on a Mac. For later endpoint or credential changes, obtain the actual provider values, edit the server's private configuration through authorized administration, and preserve the separate roles, required PostgreSQL TLS and local broker pairing. Use the Mac and current autodeploy guides above; do not rerun initial unit/layout setup as a credential refresh. Never invent a hostname or port.

The endpoint configurator does not start, restart or enable applications. Since services are now enabled, subsequent environment-file changes take effect on a later authorized restart of the Surveey services. Do not restart Niskala to apply them. Public routing and testing remain separate operations. No other Railway configuration was included in the networking commit.

## Credentials, isolation and resource limits

Selected application database credentials, admin session signing secret and media bucket credentials are installed only in root-owned mode-0600 files under `/srv/surveey/private`. Do not print, commit or copy them into the static site root. Public delivery receives no bucket credentials. Previous environment files and Surveey unit definitions are retained in private configuration history.

Linux accounts remain `surveey`, `surveey-public` and `surveey-db`. Public delivery runs from a separate code directory, with private application source, old media, snapshots and PostgreSQL files inaccessible. Admin and broker have no writable local media directory in this mode. The static root excludes private originals and source files.

The Surveey slice has CPU quota 75% of one core, CPU/IO weights 25, memory pressure threshold 512 MiB, memory ceiling 704 MiB and swap ceiling 128 MiB. Individual service ceilings are admin 320 MiB, public delivery 160 MiB, broker 128 MiB and edge 64 MiB. These are configured ceilings; runtime capacity has not been tested.

Backend listeners remain admin TLS `127.0.0.1:18490`, public delivery TLS `127.0.0.1:18492` and broker HTTP `127.0.0.1:18491`. Surveey's separate edge is configured for HTTPS on `127.0.0.1:18443`, `100.64.182.105:18443` and `[fd7a:115c:a1e0::4729:b66a]:18443`, with its own configuration and self-signed certificate. No system/browser trust store or public DNS was changed.

Existing `/srv/niskala-udara`, its Caddy configuration and CI access were not edited or restarted. The Tailscale policy gained only the scoped Surveey web grant described above. Tailscale SSH remains disabled; existing SSH grants and Cloudflare records were not changed. `systemctl daemon-reload` registers Surveey unit changes without restarting Niskala.

## Shared production data behavior

Railway and VPS applications are configured to use the same production data. Edits, uploads, publications and session updates through the VPS affect the same database and bucket used by Railway. There is no isolated database copy for the VPS app. Future schema migrations must be coordinated across both deployments and require separate authorization.

## Retained earlier copy preparation

The earlier media copy contains 1,190 objects totaling 145,343,971 bytes, retaining all source keys. Its initial snapshot is under `/srv/surveey/snapshots/initial`; working files are under `/srv/surveey/media`. These copies were not removed and are not used as the media source in the current mode. No PostgreSQL dump was produced or restored.

The local PostgreSQL 18 runtime and empty cluster are retained. `server/deploy/vps/install-copy.py` now refuses to run when `HYBRID_CONFIGURED.json` exists, preventing accidental local database setup or restoration over the current mode. The prepared `export-database-via-bucket.py` is deferred. No exporter or transit bucket was created because Railway returned `Deploys have been paused temporarily` during that attempt.

Sources: [Railway private networking](https://docs.railway.com/networking/private-networking), [Railway TCP proxy](https://docs.railway.com/networking/tcp-proxy), [Railway logical backup guide](https://docs.railway.com/guides/postgres-backups-restores).
