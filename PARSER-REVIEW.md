# Payslip parser review — 2 November 2026

Reviewed all 162 imports awaiting review, and compared the saved ESR documents with their extracted tax fields.

Applied recovery: 129 newly saved imports and 2 duplicate imports, leaving 31 for review. Original PDFs and the 5 ignored documents remain intact. A private JSON backup was written before updates, and saved tax-field changes have before/after versions.

## Reported examples

- Refunds: R next to a deduction means a negative deduction. This applies to PAYE, pension and other deductions, including refund-only statements with zero payments.
- 219: annual salary and PT salary were present. Standard hours are 34.5; the old wage regex required whole hours. PDF columns now preserve salary, decimal hours and PT salary independently. Its PAYE refund now reconciles.
- 218: Bank/Locum work has no annual salary. It stores an explicit ad-hoc employment type and null salary, with the actual payments retained. Its printed pay date is 25 September, despite 26 September in the filename.
- 214: 142.81 × 32.6018 = 4655.863058, whereas the printed amount is 4655.97 (about 10.7p difference). Dividing amount by rate gives 142.81328 hours, which rounds to the printed 142.81. The validator uses integer-penny arithmetic and the range implied by displayed precision, retaining the existing 10p minimum allowance. Amount ÷ rate can be a useful diagnostic, but is not independent proof: it must lie within the printed quantity's rounding range. Total-payment and net reconciliation still allow only 1p.
- 201: text extraction glued the only pension deduction's description and amount together. Its tax code also spans lines. The previous splitter failed while pairing deductions; this was a layout failure, not a corrupt PDF. Column extraction fixes both cases.

## Tax data

Tax-reference parsing was also consuming leading digits from tax codes. Twenty-four previously saved slips had truncated tax codes. All 54 previously saved slips had their extracted tax-office/reference/code fields normalised using PDF columns; before/after versions preserve their history. No saved monetary amounts or pay dates were changed by that repair.

Tax-year filters already use [6 April, next 6 April), based on printed PAY DATE. Boundary regression tests cover 5/6 April. A derived tax-year label is now stored in newly validated period summaries. Filenames and period-end dates do not determine tax year. The dashboard warns that unresolved imports can make totals incomplete.

For the next tax-analysis stage: total period taxable pay and signed PAYE across employments; never sum cumulative YTD figures across statements. Reconcile YTD within each employer/assignment/tax year, retain cumulative/noncumulative tax-code status, and compare annual totals to P45/P60 evidence without counting those documents as additional earnings. Missing agency slips and uncertain dates must remain visible before estimating liability.

## Remaining work, in priority order

1. Support the separate agency pay-advice template: imports 90–105, 108, 114, 115 (19 documents). They are readable PDFs but do not have the ESR section markers. Add a separate parser selected by explicit template markers, with separate columns for employer contributions and employee deductions. Validate it against every document before saving. An empty validated manual-entry draft is now available beside the original PDF.
2. Obtain original exports or use reviewed OCR for imports 41, 44–48 and 59 (7 documents). Extracted text has broken labels and ordering. These should not be forced through ESR heuristics. Manual entry is now available.
3. Confirm the payroll rounding convention for imports 22, 37, 52, 53 and 64. Their totals reconcile, but the printed paid quantity and rate exceed the implemented rounding range. Differences are about 13–17p. Reverse division does not round back to the printed quantity; a larger global allowance would hide this distinction. Retain review until payroll precision/truncation is understood or a documented line-level acknowledgement workflow is added.

## Repeatable recovery

`node scripts/reprocess-imports.js` is read-only by default. `--apply` backs up owner records then retries review imports. `--repair-saved-tax` additionally repairs saved tax fields with version history. Saved and ignored imports are not retried; duplicate detection and replacement protections stay active.

## Verification and deployment status

All 24 unit/integration tests and the desktop/mobile browser smoke passed using a disposable database. Read-only live verification confirms 183 saved imports, 2 duplicates, 31 reviews and 5 ignored documents; imports 201, 214, 218 and 219 are saved in the expected tax years. The sign-in page returns HTTP 200.

Database recovery is applied. The running service has not reloaded the code: automatic approval review rejected the attempted restart because a live-service restart could disrupt users and deployment was not explicitly authorised. A service restart remains pending approval before the new parser and manual-entry UI are used by the running web process.
