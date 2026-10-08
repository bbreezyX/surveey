# Online survey administration implementation plan

Date: 2026-10-08. Status: Local implementation authorized by the user's request to complete unfinished features. Password-only authentication supersedes gateway/MFA tasks. Production activation remains unapproved; broad checks were deferred at the user's request.

Authority: `../specs/2026-10-08-secure-online-admin-design.md`. The public frontend migration is a separate deliverable. This plan does not authorize production provisioning, activation, or cutover.

## Outcome and boundaries

Approved people can edit points, add survey observations/photos, review changes, and publish them without redeploying the public frontend. Mandatory MFA is enforced by the chosen identity provider and Access admission policy. Application authorization is enforced independently. Public visitors receive only published data and approved image derivatives.

Keep `dist/public` isolated. Add a separate admin entry/output, a Django backend, private PostgreSQL/storage access, and a separate read-only public-data service. Do not put the backend or admin files under Caddy's static public root. Endpoint discovery does not grant permission.

## 1. Verify authentication and deployment inputs

- Read current official Django, Cloudflare Access, PostgreSQL and storage documentation; pin supported patches and record compatibility.
- Resolve the controlled admin hostname, chosen identity provider, mandatory MFA policy, approved initial owner identity, Access issuer/audience, private service connectivity, and storage configuration. No invented identities or committed secrets.
- Define one policy module for JWT validation and account admission. Validate signature, allowed algorithm, issuer, audience, expiry and subject using trusted gateway configuration/JWKS. Reject direct-origin bypasses and forged identity headers.
- Write rejection tests before implementation: missing/forged/expired/wrong-audience assertions, unapproved/disabled accounts, revoked access, and account/subject mismatch. Prove mandatory MFA with real admission tests before activation; do not infer it merely from a token being present.

## 2. Establish the backend and authoritative data model

- Create isolated backend settings for local tests, staging and production. Use secure cookies, CSRF protection, narrowly defined allowed hosts/origins, request limits, server-only secrets and explicit default-deny permissions.
- Implement accounts/roles, allocated points, survey observations, media assets, immutable revisions, audit events, and publications. Preserve Nomor and the independent reserve/unplaced/verification semantics.
- Make one coordinate pair authoritative. Generate GeoJSON geometry and legacy properties from the same pair. Use database constraints and transactions to prevent partial updates.
- Apply migration/constraint tests and per-role API tests. Database and storage credentials used by the public-data service must have read-only access to published material.

## 3. Import and verify existing evidence

- Add a dry-run importer with record-by-record reporting: identifiers, coordinates, dates, status values, missing photos, unsupported media, and unreferenced image files.
- Preserve original survey evidence. Import legacy rows as baseline observations; retain unreferenced images as legacy evidence rather than inventing historical visits.
- Test the importer using the full current dataset and verify the baseline counts and image hashes. Do not hardcode baseline totals in production logic.
- Produce a reviewable reconciliation report. A data discrepancy needs an explicit decision before cutover; do not silently repair it.

## 4. Build protected point and photo workflows

- Add a separately built Svelte admin served through the protected origin. Initial screens: searchable point list, detail/editor, observation/photo preview, change review, publication review, history, and owner account controls.
- Coordinate entry and map dragging update the same draft pair. Keep observation date/source explicit. Replacing a photo alone must not imply a new survey or verified location.
- Detect and decode actual JPEG/PNG/WebP content with bounded bytes, pixels and processing resources. Generate opaque server-side keys and display derivatives. Keep original metadata/evidence private; public derivatives contain no embedded private metadata.
- Test malformed/mismatched/oversized files, unauthorized access to originals/drafts, missing-media recovery, orphan cleanup, and replacement URLs. Never overwrite bytes behind an existing published URL.

## 5. Implement review, conflicts, publication and history

- Use revision/version checks so stale saves return a conflict with before/after values rather than overwriting another person's work.
- Saving creates a draft. Publication validates the complete snapshot and approved-media manifest before atomically switching the active pointer. A failed publication leaves the prior version active.
- Restore by publishing a new revision. Archive points instead of hard deletion in the initial release. Keep an auditable account/action/time/reason/before-after record.
- Test concurrent edits, failed media preparation, failed snapshot generation, retry/idempotency, role restrictions, count changes, restoration, and atomic public visibility.

## 6. Connect published data to the public map

- Serve the active published GeoJSON behind the existing `/data/points.geojson` public URL. Export only approved display fields; omit identity data, edit reasons, private evidence, internal filesystem paths and draft metadata.
- Introduce approved public photo URLs while retaining compatibility during migration. Public media lookup must check an approved manifest; no arbitrary-key proxy or bucket listing.
- Retain published derivatives/manifests long enough for the configured media cache lifetime, except explicit privacy revocations. An already open map refreshes explicitly to receive a new publication in the first release.
- Verify anonymous read access, draft/original denial, active-snapshot cache behavior, old loaded-snapshot photo continuity, and public bundles free from admin/write routes and credentials.

## 7. Stage and activate only after operational verification

- Verify TLS, edge admission, direct-origin denial, application authorization/CSRF, upload limits, audit records, logs, dependency health, and separate public/admin artifacts in staging.
- Run cross-browser admin flows with each role, approved/MFA and rejected account paths, responsive coordinate/photo editing, conflict handling, publication and restoration.
- Back up PostgreSQL and storage; perform a restore rehearsal. Prepare a rollback that restores the previous public release and active publication.
- Present the concrete staging result, reconciliation report, access policy and restore evidence before production activation. After cutover, PostgreSQL is the editable authority and existing scripts cannot provide a second production write path.

## Review focus

Review gateway bypasses, spoofed identity, MFA admission, revocation, CSRF, authorization on every endpoint, evidence privacy, storage key boundaries, image decoding/resource limits, lost updates, atomic publication, audit consistency, and restore behavior. A hidden path is never treated as a security control. Obtain an independent code review and resolve important findings before activation.

## Implementation record (2026-10-08)

- [x] Separate Django admin/password boundary, explicit accounts, roles, session limits/revocation, CSRF and throttling. No default credentials or public enrollment.
- [x] Database models/migrations for points, immutable observation evidence, revisions, drafts, audit and atomic publication pointer.
- [x] Complete dry-run/import workflow, original preservation and per-record reconciliation report. Four missing referenced photos and 38 unreferenced images are accounted for explicitly.
- [x] Separate Svelte/TypeScript admin build: search, creation, editing, coordinate pin, correction/new visit, photo preview, draft review, publication, restore/archive, accounts/password, audit and retained legacy evidence.
- [x] Private validated originals/derivatives, read-only public GeoJSON/media service, manifests, retention/revocation, GeoJSON/CSV exports and safe public photo URL compatibility.
- [x] Fail-closed configuration, private-service Dockerfiles, privilege SQL, deployment templates and checksum backup/restore commands.
- [ ] Deferred: broad auth/security/concurrency/browser tests, PostgreSQL staging reconciliation, containers/TLS/private networking and restore rehearsal.
- [ ] External activation: controlled hostnames, approved initial owner/password entered privately, PostgreSQL/bucket/service credentials and production cutover approval.
