# Surveey database and media migration to VPS

Authorized scope: move Surveey PostgreSQL and media to the existing VPS; retain
all Railway data and keep Niskala and its shared Caddy untouched. Preserve the
current application release, sessions, public/admin separation, TLS, tunnel,
and the existing Surveey resource limits. No frontend or load testing.

1. Record protected service PIDs/configuration hashes and current Surveey
   configuration. Prepare a separate PostgreSQL 18.6 cluster at
   `/srv/surveey/postgres-production`, port 15433, under `surveey.slice`.
   Keep the original unused cluster. Create a fresh source dump before pausing.
2. Hold the autodeploy lock. Stop only Surveey's application/edge units; disable
   source application logins and make the Railway database default read-only.
   Terminate source database sessions so both VPS and Railway application
   writers are fenced. Preserve original source settings for rollback.
3. Export the final database. Capture all public-table row fingerprints,
   sequence state, schema migrations, effective application privileges, and
   media references. Copy the current complete bucket inventory to a new media
   directory; compare all referenced SHA-256 checksums and stable bucket inventory.
4. Restore the complete database into a new database with separate operator,
   admin and public roles. Compare every table, sequence and effective table
   privilege before opening writes. Preserve a database dump, media archive,
   inventory, configuration backup, and migration manifest.
5. Atomically switch Surveey env files/media; add local-database dependencies
   and appropriate filesystem access for admin/broker. Preserve public media
   isolation. Update the receiver to accept an explicitly configured local-data
   deployment. Start only Surveey units. Keep Railway fenced and intact to
   prevent split writes. After local writes open, do not automatically revert
   to the old Railway snapshot.
6. Save a private migration snapshot on the operator's Windows machine and
   update operational docs. Record commands/operation receipts and integrity
   comparison results. Do not run browser/login/edit/smoke/load tests.

Recovery: before local writes open, restore saved configuration and original
source login/read-only settings and resume the old Surveey services. After
local writes open, keep the VPS authoritative and repair forward; returning to
Railway requires copying all newer VPS data under a new write pause.
