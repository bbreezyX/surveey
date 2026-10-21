# Surveey isolated VPS copy implementation plan

**Arsip rencana awal.** Ekspor/restore database pada rencana ini tidak selesai.
Keputusan berikutnya memakai aplikasi VPS dengan database/media Railway, lalu
autodeploy dan cutover domain diotorisasi terpisah. Untuk operasional yang
diterapkan, baca [handoff Railway–VPS](../../railway-vps-handoff.md); jangan
menjalankan rencana ini sebagai instruksi aktif pada produksi.

**Goal:** Prepare an independent copy on the Niskala VPS through ordinary OpenSSH over Tailscale, keeping Railway authoritative and preserving Niskala.

**Approved scope:** The user approved preparation on the Niskala VPS, preserving all Railway data, with no tests or verification. No cutover, DNS change, push, Niskala restart, access-policy change, or automatic synchronization is included.

**Architecture:** Use separate `/srv/surveey` files and dedicated Linux accounts. Build frontend assets locally. Keep PostgreSQL 18 and Python dependencies in application-owned runtimes so preparing Surveey does not install or restart shared OS services. Restore only into a fresh isolated database. Keep all new application units disabled and stopped; start the isolated database only for restoration, then stop it. A later activation can expose the copy through an SSH-forwarded loopback HTTPS listener.

## Constraints

- Access `ubuntu@100.64.182.105` through Tailscale, with existing host keys and SSH keys.
- Preserve `/srv/niskala-udara`, existing Caddy configuration/services, and CI access.
- Never write to the Railway database/bucket, pause production, or remove source objects.
- Store source snapshots and credentials outside Git with private filesystem permissions.
- Copy all bucket objects, including unreferenced objects; retain object keys.
- Use fresh target database passwords, Django secrets, and broker capability.
- Keep public delivery on its SELECT-only database role and without private-media filesystem access.
- Restrict new processes to `surveey.slice`, with lower CPU/IO priority and a combined memory ceiling.
- No tests, typechecks, lint, browser checks, health requests, checksum reconciliation, or post-change verification.

## Work

1. Read the source and target deployment prerequisites.
2. Add opt-in VPS media/broker configuration; retain Railway behavior.
3. Build only the public/admin deployment artifacts locally, bypassing validation scripts.
4. Export PostgreSQL using `pg_dump`; download the full bucket using read-only S3 operations.
5. Prepare private PostgreSQL/Python runtimes and dedicated accounts on the VPS.
6. Transfer the release and source snapshots through Tailscale.
7. Initialize a fresh target database, restore data, and apply separate runtime role grants.
8. Install inactive resource-limited units and private HTTPS configuration.
9. Stop the temporary target database and document preparation state and later activation.

Source snapshots reflect their export time. New Railway edits require a later refresh before any final cutover. No functional or restoration validation is claimed.
