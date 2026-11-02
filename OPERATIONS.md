# Paybook operations

This is a single-owner Express/EJS/PostgreSQL application. The implementation keeps existing payslip IDs, legacy hashes and account records. It disables registration, user administration and OAuth account creation. The supplied service files are templates; they have not been installed or activated.

## Configure and back up

Use Node 18.20 or newer (an actively supported Node LTS is recommended). Install locked dependencies with `npm ci`. Merge `.env.example` into your existing `.env`, without overwriting existing credentials. Protect it with mode 600.

Set `OWNER_ID` to the existing `users.id` that owns your payslips. Inspect IDs and providers with `SELECT id, username, provider FROM users;`. The owner restriction also applies to already-issued sessions. Local login requires a password hash on that record; Google login requires that record's existing `provider='google'` and `provider_id`. This app does not merge separate local and Google identities. Configure `GOOGLE_CALLBACK_URL` in Google OAuth settings; the existing `https://pay.tomoutlaw.co.uk/auth/google/callback` default is preserved.

Generate `SESSION_SECRET` with `openssl rand -hex 32`. Production requires HTTPS at the reverse proxy for secure cookies. Set `TRUST_PROXY` to the actual trusted address/CIDR (`loopback` for a local proxy), never an unrestricted boolean. The app binds to 127.0.0.1:52535 by default. Forward HTTPS scheme headers from the proxy and set its upload limit to at least 20 MB plus multipart overhead. `PGDATABASE` is the correct database variable; the old `PGNAME` examples were incorrect.

Before migration, stop writes to the old server. Supply PG credentials through a protected `PGPASSFILE` or PG environment variables and run:

```sh
bash deploy/backup.sh /absolute/private/backup-directory
npm run migrate
npm run import:legacy
```

The migration is additive and repeatable. Legacy indexing builds canonical fingerprints for valid saved rows and imports old `uploaded` PDFs without moving or deleting originals. Invalid legacy rows remain unchanged; potential matches require review. Keep the backup outside the web root. Restore the dump into a separate database and extract the file archive to verify the backup before relying on it.

Install the supplied `deploy/payslips_server.service` after checking its User and paths. The service reads `.env` with systemd EnvironmentFile syntax, so use simple KEY=value lines. Restart the app after setting the owner and secret; previous memory-store sessions will be signed out. Confirm sign-in, payslip totals, exports and legacy PDF access before enabling sync.

## Nextcloud

Set `NEXTCLOUD_URL` to the HTTPS server base URL (include its installation subdirectory if needed, but omit `/remote.php/dav`). Set `NEXTCLOUD_USERNAME`, `NEXTCLOUD_APP_PASSWORD` and `NEXTCLOUD_FOLDER` relative to that user's files root. Create a revocable app password in Nextcloud's personal security settings. Credentials are never exposed through the status API.

Run `npm run sync` once to check the connection and review initial import results. The first scan processes all PDFs recursively. After that successful check, install `deploy/payslip-sync.service` and `deploy/payslip-sync.timer` in `/etc/systemd/system/`, reload systemd, and enable the timer:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now payslip-sync.timer
systemctl list-timers payslip-sync.timer
```

The worker runs five minutes after its preceding run finishes. “Sync now” starts an asynchronous scan in the app; a PostgreSQL advisory lock serializes it with timer runs. A request flag records intent if a running process exits; the next timer run scans regardless of that flag. It is not a push/webhook integration. Remote deletion never deletes local records. No requests write to Nextcloud.

## Import behavior and recovery

PDFs are limited to 20 MB, signature checked and stored in `payslips/objects/<SHA-256>.pdf` before persistence. Paths sent by clients cannot select filesystem objects. Attempts and documents are accessed by owner-scoped IDs. Keep objects in backups; do not clean them automatically. An interrupted transaction may leave an unreferenced object, which is harmless and retained for recovery.

Amounts are validated in integer pennies. Mandatory sections, identity fields, dates, pay and deduction totals, and net pay must reconcile. Numeric paid-quantity × rate checks allow the greater of the existing 10p baseline and a precision-based bound (half a displayed unit in hours and rate, plus half a penny); summary reconciliation allows 1p. Optional absent YTD balances stay null. Uncertain parsing goes to review. Review offers grouped fields and advanced JSON editing. It does not bypass arithmetic validation. Unsupported/encrypted/scanned PDFs may require an original ESR export or parser support; OCR is not included.

Identical bytes or canonical parsed content deduplicate across names. A changed known source replaces its current record only after validation, preserving its original ID and prior versions. Identity or pay-date changes and matches to legacy records require explicit comparison/confirmation. Multiple legacy matches remain blocked pending data cleanup. Invalid replacements leave the last good record active. Source paths are tracked individually; a renamed file deduplicates when scanned at its new path.

A new version stores parsed data and its PDF. A legacy snapshot attempts to preserve the old processed PDF; if that file is missing, its parsed data is retained and PDF availability is shown accordingly. Legacy original files are served only from the configured owner's processed directory.

Transient download failures back off from five minutes up to 24 hours. Files whose validation failed are not repeatedly parsed at the same ETag. Retry requests another parse or makes a failed download eligible for the next scan. Worker runs recover queued attempts left by interrupted processing. Sync errors appear on Imports; systemd also records worker failure. Authentication failures should be fixed by updating the app password, then requesting a sync. Expired session rows are removed as sessions are saved.

## Verification

```sh
npm test
bash test/run-postgres.sh
BROWSER_SMOKE=1 bash test/run-postgres.sh
```

The last two commands create a disposable PostgreSQL 15 cluster under `/tmp`, use Unix sockets on port 55439, and delete it afterwards. They never connect to the application database. Adjust `PG_BIN` if PostgreSQL is installed elsewhere. The browser check uses installed `/usr/bin/chromium`; screenshots go to `/tmp/pay-browser`. Integration tests are skipped without `TEST_PG_SOCKET`. Browser and integration fixtures use synthetic identities and monetary values. Import-persistence tests stub PDF extraction; parser units and the browser upload flow also extract a generated complete PDF. The browser checks review editing, saving and document access. Live Nextcloud compatibility and your real PDF corpus still need a deployment check.

Do not run the old `test_*` scripts as a test suite: several modify files or insert into a configured database. Use the new npm test command.


## Parser recovery (November 2026)

Run `node scripts/reprocess-imports.js` for a read-only corpus check. Run with `--apply` to retry review imports; this first writes an owner-scoped JSON backup under `private/backups` (mode 600). Add `--repair-saved-tax` to re-extract saved tax-office/reference/code columns, retaining before/after version snapshots and leaving dates and monetary fields intact. Identical imports still deduplicate and replacement confirmations are respected. Originals and ignored documents stay in place.

ESR extraction now retains PDF column positions, including blank quantity/rate cells, single-row payment/deduction tables, decimal standard hours and wrapped tax codes. Bank/locum/ad-hoc job or filename evidence sets `wage.employment_type=ad_hoc` when no annual salary is printed. Missing salary stays null, never a fabricated annual estimate. Refund suffix R normalises to a negative deduction. Zero-payment refund slips may have no payment lines if all totals reconcile.

For unsupported layouts, the review screen provides an empty manual draft alongside the original PDF. Fill every identity, payment, deduction, YTD and date field from the PDF. Choose `ad_hoc` for ad-hoc work with no annual salary. Use advanced JSON to add/remove lines. This route uses the same reconciliation checks. OCR and the separate agency pay-advice template are not implemented.

Tax-year grouping uses the printed PAY DATE and the half-open interval [6 April, next 6 April), never filenames or period-end dates. The parser stores a derived tax-year label in the period summary. Dashboard totals warn that unresolved imports across all years may make totals incomplete. Summing YTD values across payslips would double count earnings: future tax analysis should sum period taxable pay and signed PAYE deductions, reconcile YTD separately per employer/assignment/year, and use P45/P60 documents as evidence rather than additional payments.

## Employment filters and mapping review

Library, dashboard, API and exports support `grade`, `location` and `locumType`. Their values must match the lists in `lib/categories.js`; `Unknown` selects unresolved mappings. Set `year=all` for all years, or retain a tax/academic year filter. Exports preserve these filters. Categories never alter the pay date or financial totals.

Source fields remain intact. Canonical display labels expand known abbreviations and can recover malformed legacy job columns from the source PDF. Local aliases live in `private/category-overrides.json`, keyed by the exact combination of source job/location/department/payscale and salary-validation employment type. A changed source combination is classified afresh. Back up this file with the database and PDFs. These files are private and excluded from Git.

`node scripts/category-mappings.js` regenerates `private/mapping-review/employment-mappings.xlsx` and `uncertain-mappings.csv` from the configured owner database and PDF objects. The workbook has uncertain saved mappings, all saved mappings and pending unsupported imports. Mark complete saved mapping rows `confirmed=yes`; validate with `node scripts/category-mappings.js --input /absolute/edited.xlsx`, then apply with `--apply`. Invalid categories fail before any update. Apply retains a configuration backup and writes atomically; the next request sees the changes. Pending-import suggestions require review when those PDFs can be recovered and are not automatically applied.

## One-time historical PDF recovery

The 26 unsupported historical PDFs were manually transcribed and saved on 2 November 2026. Their source documents, per-document drafts, validation results, before/after records and category provenance are under `private/manual-recovery`; `summary.csv` and `README.md` describe the saved entries and limitations. This does not add ongoing parser support for these layouts.

For the LAK format, employee pension printed as negative earnings is normalised into employee deductions, and payment/deduction totals are both increased by that amount; net pay remains exactly as printed. Printed totals and employer pension remain in the period summary. Gross YTD before pension is unreported, so it remains null: validation allows this only with explicit manual-transcription provenance, `ytd_gross_not_reported=true`, and a valid taxable YTD balance. Printed post-pension YTD balances are preserved separately. Import 90 has source YTD discrepancies, and import 100 has a repeated printed tax week; saved source notes flag these. Future annual tax reconciliation must inspect these notes before trusting cumulative balances.

## Owner-approved rounding exceptions

On 2 November 2026, the owner explicitly approved the printed paid-quantity/rate discrepancies on imports 22, 37, 52, 53 and 64. Each affected payment line retains its original figures and a rounding_acknowledgement recording the exact description, paid quantity, rate, amount, source hash, approval time and reason. Validation accepts only those recorded line figures; changing them requires a fresh acknowledgement. Payment/deduction sums and net-pay checks remain mandatory. Audit snapshots and results are under `private/rounding-approval`.
