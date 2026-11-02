# Repository review and implemented changes

## Fixed

- Unrestricted registration POST, role assignment from submitted data, and OAuth auto-registration: replaced with a configured existing owner ID; account creation and management routes are disabled.
- Broad authenticated filesystem serving and submitted filesystem paths: replaced with database-ID document routes scoped to the owner, generated content-addressed object names, and guarded legacy fallback paths.
- Filename-dependent duplicate hashes and query-string drafts: new raw and canonical hashes deduplicate renames; persistent attempts hold drafts; review uses POST requests with CSRF protection.
- Inconsistent save/archive handling and swallowed persistence errors: immutable file storage precedes a transaction covering payslip updates, history, source linkage and attempt completion. Errors propagate and attempts can retry.
- Missing pending directories and redirect loops: the new Imports view reads database attempts. Legacy indexing explicitly handles absent folders.
- Hardcoded session secret, transient sessions and unrestricted mutation requests: environment secret, PostgreSQL sessions, secure production cookies, CSRF tokens, OAuth state and login throttling.
- Academic-year gaps/overlaps and local-time date shifts: independently calculated next-year boundaries, exclusive end dates, validated years and PostgreSQL DATE strings.
- Heading-only validation and empty parser fallbacks: mandatory layout sections, signed decimal validation, gross/deduction/net reconciliation, rate checks, and explicit review of unknown layouts. Optional blank YTD values remain absent rather than being invented as zero.
- PDF.js could misread pooled Node Buffers during real uploads: extraction now passes an isolated Uint8Array.
- Conflicting Uppy/custom upload handlers and accidental clear submissions: one local upload implementation, explicit button types, PDF limits, and temporary file cleanup.
- Inconsistent CDN-based UI: shared EJS structure, local assets, responsive finance dashboard, library, grouped review, history and import status.
- Dependency audit: removed unused parsing and export packages, replaced the unsupported Excel exporter, applied compatible fixes, and overrode ExcelJS's UUID dependency with a patched compatible version. The locked dependency audit reports zero known vulnerabilities at implementation time.

## Operational improvements

- Read-only Nextcloud WebDAV scans use ETags, conditional GET and a second metadata check; recursive scans never propagate remote deletions to the local archive.
- An advisory lock serializes worker runs; import transactions also serialize owner writes. Retry state survives application restarts, and unchanged invalid files wait for review.
- Existing IDs, accounts, historical hashes and local PDFs remain available. Legacy indexing and additive migrations prepare existing data without automatic deletion.
- Supplied systemd service/timer templates, protected backup script, environment example and operations guide make deployment reproducible.

## Remaining deployment checks

The live database has not been migrated, services have not been restarted, and Nextcloud has not been contacted. Configure the owner, session secret and Nextcloud credentials; back up; migrate and index legacy PDFs; verify sign-in and an initial sync; then enable the timer. See OPERATIONS.md.

The supported extractor is still specific to NHS ESR text PDFs. It does not provide OCR or reliably infer unfamiliar layouts. Unknown layouts require parser support or a corrected original export. Existing PDF corpus coverage was one PDF; it passed validation. New tests include a synthetic complete layout and a generated PDF, plus disposable-database and browser checks. Google OAuth still requires a live redirect check with the configured existing identity.
