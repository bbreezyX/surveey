# Secure online survey administration — proposed design

Date: 2026-10-08
Status: Local implementation added in the isolated worktree. Production infrastructure, broad verification and activation remain pending.

**Hosting decision, 2026-10-09:** production will use Railway. See `../../railway-deployment.md` for prepared service boundaries and infrastructure requirements; no live deployment has occurred.

**Superseding user decision, 2026-10-08:** approved-account password-only login replaces mandatory MFA and the Cloudflare/IdP gateway proposal below. Django password authentication, Argon2 hashing, operator/owner provisioning, CSRF, login throttling, session limits and revocation enforce the current application boundary. There is no public registration, default account or gateway bypass login. Historical gateway/MFA paragraphs describe the earlier proposal and are not current requirements. See `../../admin-operations.md` for the implemented workflow and deployment requirements. The user explicitly requested finishing features first and checking later; broad security/browser/restore validation remains deferred.

## Intent and confirmed requirements

Provide an online administration interface for updating survey points and photographs without editing repository files or deploying for every data change. The public OpenLayers map remains read-only. Authorized people can access administration from any browser, using approved accounts and password-only login, as explicitly selected by the user on 2026-10-08.

The user wants admin endpoints to be difficult to discover. Public visitors must not receive admin scripts, route definitions, links, or credentials. Complete endpoint secrecy is not achievable for a browser application: an authorized browser can inspect its requests, and a public hostname may be discovered independently. Knowing any endpoint must never grant permission to use it.

## Repository evidence and limits

- `index.html`, `custom.js`, and `custom.css` implement the public map.
- `layers/layers.js` loads survey data from `data/points.geojson`.
- Point geometry and `Longitude`/`Latitude` properties both contain coordinates; popup display prefers the properties.
- Photo references currently use `Foto Survey Awal`; `custom.js` resolves sanitized filenames beneath `images/`.
- `scripts/dev-server.py` has a localhost-only flag editor, not a production authentication system.
- October survey scripts update coordinates, dates, and current photo references together; previous image files remain in the repository.
- `Dockerfile` and `Caddyfile` describe a static Caddy deployment. `/images/*` has a 30-day cache lifetime.
- Caddy serves the copied `/srv` tree. The existing copy/exclusion approach is not an explicit allowlist of public files; a backend must not simply be added beneath this served tree.
- No live Railway, DNS, identity-provider, or storage configuration has been verified for this design.
- Existing dirty and untracked files belong to prior work and must be preserved.

## Approaches considered

1. **Separate admin service behind an identity-aware gateway (recommended).** Approved identities and mandatory MFA are enforced before the admin application is served. Application authorization remains mandatory. It supports ordinary browser access and keeps admin assets out of the public map.
2. **Separate admin service with application-managed login and MFA.** Avoids requiring an edge gateway but adds responsibility for enrollment, recovery, abuse prevention, and authentication maintenance. A maintained identity solution is preferable to custom authentication code.
3. **Private-network admin with an additional login.** Reduces public exposure further but requires a VPN/client. The user selected browser access with approved accounts and MFA instead.

## Proposed components

- Public map: Svelte 5, TypeScript, Vite, and OpenLayers, compiled to static assets served by Caddy. Preserve the existing map appearance, content, and behavior during migration.
- Admin interface: a separate Svelte 5/TypeScript/Vite build using OpenLayers for coordinate editing, delivered only through the protected admin origin. It is not a route or dynamically imported chunk within the public map build.
- Admin backend: a separate Django application serving authenticated same-origin API routes and the protected admin build. Use a supported Django LTS series, currently 5.2, with the current security patch verified and pinned at implementation time.
- Access gateway: Cloudflare Access on the admin hostname, backed by an identity provider capable of enforcing MFA. This is a proposed dependency, not an existing verified account configuration.
- Database: PostgreSQL, reachable by backend services through private networking.
- Images: private S3-compatible object storage; Railway buckets are one suitable option. Credentials are server-only.
- Public data delivery: a separate read-only service serving the active published GeoJSON snapshot and approved image derivatives. It has no admin routes or identity keys and uses read-only database/storage permissions.

The public map and admin have separate origins and separate build outputs. The admin uses same-origin server routes with CSRF protection, without a browser-accessible database connection or credentials. Public delivery never imports the admin route table. Vite is a development/build tool, not the production authentication boundary. First migrate and verify the public frontend according to `2026-10-08-public-map-modernization-design.md`; then implement the protected administration subsystem under its own detailed plan.

## Access and security boundary

1. The gateway permits explicitly approved accounts only and requires MFA. Email one-time codes alone do not satisfy the requirement. No public registration or automatic admin enrollment.
2. The backend validates the gateway token's signature, issuer, audience, expiry, and applicable time claims for every protected request. A header's presence or an asserted email is insufficient.
3. Map verified identities to explicitly provisioned application accounts using issuer and subject. Disabled or unprovisioned identities are denied. Initial account provisioning uses an operator command, never a public bootstrap endpoint.
4. Check application permissions for every page, operation, and target record. Editors may save drafts; publishers may publish; account administration is restricted to the owner. A sole owner may hold all permissions.
5. Reject direct-origin requests without a valid gateway token. Restrict origin ingress where the hosting platform permits it. Do not leave a provider URL as an alternate unprotected login route. No password fallback that bypasses the gateway or MFA.
6. Use secure, host-only, HttpOnly session cookies, deliberate SameSite settings, CSRF protection on writes, session rotation, and revocation. Production sessions have a proposed 30-minute application idle timeout and an 8-hour absolute maximum; Access/IdP lifetimes must be configured consistently.
7. Use HTTPS, explicit host/origin allowlists, production debug disabled, output escaping, CSP, request-size limits, upload limits, and request throttling. Rate-limit keys must not trust spoofable forwarding headers.
8. Store credentials and signing secrets in deployment secret configuration. Never expose them through JavaScript, URLs, logs, source maps, or GeoJSON. Administrative logs exclude tokens and upload contents.
9. Build public assets from an explicit allowlist. Exclude server source, admin assets, documentation, Git metadata, environment files, scripts, and deployment configuration from the public image. Do not list admin paths in public `robots.txt` or sitemaps.
10. A random URL, obfuscated JavaScript, CORS settings, or a hidden button is not an authorization control. The production service fails closed if required identity/security configuration is missing.

## Data model

- **Point:** immutable internal identifier, unique visible `Nomor`, allocation details, status, duplicate flag, archive state, and record revision.
- **Survey observation:** point relation, documentation date, observed coordinate pair, notes, source reference, evidence, and author/time metadata.
- **Photo asset:** immutable storage key, checksum, detected format, dimensions, upload author/time, and observation relation. Retain original evidence privately and create validated public display derivatives.
- **Draft revision:** proposed field values, selected current observation/photo, base record revision, and required change reason.
- **Audit event:** actor, action, timestamp, before/after values, affected records, and reason. Ordinary application roles cannot edit or delete audit events. This is application-level protection, not a claim of tamper-proof storage against infrastructure administrators.
- **Publication:** versioned public snapshot and approved-media manifest, with one active-publication pointer.

Coordinates have one authoritative pair. GeoJSON geometry and legacy coordinate properties are generated together. Keep allocation status separate from location verification. Preserve existing Cadangan counting rules, Belum Ditetapkan semantics, and the independent Duplikat flag.

An observation's date and coordinate should not automatically change because a new photo was uploaded. The operator must choose whether this is a photo correction or a new survey visit.

## Admin workflow

1. Find a point by Nomor, location, proposer, or status.
2. Inspect the current location, current photos, and previous observations.
3. Edit allocation details, propose a coordinate correction, or add a survey observation. Coordinate entry and pin placement update the same pair; pin dragging alone does not claim the location is verified.
4. Upload a photo, inspect it beside the old photo, and identify its observation/date/source.
5. Review before/after values, map positions, movement distance, and changes in official counts.
6. Validate and save a draft. Drafts and originals are accessible only through administration.
7. A publisher reviews and publishes the draft. If another edit changed the record, reject the stale save and show the conflict rather than silently overwrite it.
8. Restore an earlier state by making and publishing a new revision; history remains intact. Archive points instead of hard deletion in the first release.

Interface copy is Indonesian. Initial screens: point list/search, point detail/editor, upload preview, changes/publication review, and history. Owners also receive account access management.

## Image handling

- Initial allowed uploads: JPEG, PNG, and WebP; proposed maximum 20 MiB and 40 megapixels per image. Detect and decode actual content; reject mismatches, malformed files, SVG, and executable content. Bound processing resources.
- Generate opaque unique keys server-side. Never use an uploaded path as a storage key or replace bytes at an existing published URL.
- Keep original evidence private. Serve validated display derivatives through the read-only public media service; remove embedded metadata from these derivatives while retaining useful visible survey stamps.
- Create a new URL for every replacement. Keep previous assets linked to their historical observations.
- Upload and validate media before attaching it to a saved revision. Failed saves leave cleanup-eligible unreferenced uploads, not broken current photo references.
- Public media lookup requires membership in an approved publication's media manifest. Retain public manifests and their derivatives for at least the configured 30-day media cache lifetime after replacement, so already loaded maps continue working. A deliberate privacy revocation overrides retention. No bucket listing, arbitrary-key proxying, or access to draft/original assets.

## Publication and public-map integration

Build an immutable snapshot from validated revisions, along with its media allowlist. Activate it only when every referenced public image is ready. A database transaction switches the active pointer; failed generation leaves the old publication active. Display assets have immutable URLs and are retained long enough that previously loaded snapshots can still fetch their referenced images.

The public GeoJSON contains approved display fields only: no admin identities, edit reasons, private evidence, internal filesystem paths, or draft metadata. Preserve current field compatibility where needed and introduce a published photo URL that replaces Windows-path filename derivation.

Serve the read-only public data route behind the public origin so the existing `data/points.geojson` preload and layer URL can remain consistent. Use revalidation for the active snapshot and versioned URLs for media. Saving a draft does not change the public map; publishing changes data without a code deploy. A map already open must refresh or explicitly reload data to receive the new snapshot in the first release.

## Migration and operations

- Inventory the entire current dataset and images before import. Report duplicate identifiers, coordinate disagreements, missing files, unsupported status values, and unreferenced images; do not silently repair or delete them.
- Import legacy rows as baseline observations. Preserve Nomor, allocation text, public semantics, and original evidence. Explicitly account for missing photos and unplaced points.
- Existing unreferenced images become retained legacy evidence pending explicit review, not fabricated historical observations.
- After cutover, PostgreSQL is the authoritative editable store. GeoJSON and spreadsheets are exports. Old scripts must not silently become a second production write path.
- Stage migration and verify record-by-record equivalence and count rules before switching public delivery. Keep the previous static release recoverable.
- Back up database and image storage, test a restore, monitor authentication failures and publication errors, and maintain supported dependency versions.
- Required deployment inputs: controlled admin hostname/DNS, chosen identity provider with enforced MFA, explicitly approved initial owner identity, gateway issuer/audience, database and storage credentials. Supply these during provisioning; do not invent addresses or identities or commit secrets.

## Verification before production

- Anonymous requests cannot obtain admin HTML/assets, drafts, originals, history, or perform writes.
- Direct-origin access, forged/missing/expired/wrong-audience tokens, unapproved identities, and disabled accounts are rejected.
- Confirm missing MFA blocks access through the gateway; no alternate login/reset route bypasses it.
- Editor-to-publisher escalation, cross-record permission violations, CSRF attempts, stored HTML/script injection, and conflicting edits fail safely.
- Invalid image signatures, excessive size/dimensions, malicious filenames, and malformed payloads are rejected with bounded resource use.
- Photo replacement uses a new URL; old observations retain evidence; save failures cannot publish broken references.
- Migration preserves point identities, authoritative coordinate consistency, status semantics, and official counting rules.
- Drafts remain private. Failed publication keeps the previous snapshot active. Published GeoJSON and allowed media are consistent.
- Public browser requests and downloaded assets contain no admin URLs, admin code, secrets, or administrative metadata. Public image/path probing cannot expose private objects.
- Test desktop/mobile editing, keyboard navigation, coordinate/photo previews, gateway/session expiry, and database/image restore in staging.

## Scope of the first implementation

Include the online editor, observation/photo history, access protection, draft/publication workflow, audit trail, data migration, backups, and the verification above. Reusable spreadsheet imports and broader data-quality dashboards follow after this foundation. No public access endpoint can be promised invisible or the system absolutely invulnerable.

## Primary references

- Authorization checks and default denial: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- Session controls: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- CSRF: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Upload validation: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- Identity-aware access: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/
- Access token validation at origin: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- Supported Django releases: https://www.djangoproject.com/download/
- Private S3-compatible Railway storage: https://docs.railway.com/storage-buckets
- Versioned media caching: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- GeoJSON coordinate order: https://www.rfc-editor.org/rfc/rfc7946.html

## Approved routing amendment (2026-10-09)

User explicitly chose the original public-map domain with `/admin` and the latest local admin UI. Use `https://survey.esdm.cloud/admin/` and private reverse proxying to the admin service. This supersedes separate-origin requirements above. Authorization/CSRF remain mandatory; cookie Path does not provide origin isolation.
