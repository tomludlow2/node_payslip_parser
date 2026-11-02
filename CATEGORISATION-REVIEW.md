# Employment-field categorisation proposal

Reviewed 183 saved payslips on 2 November 2026. This is a proposal; no employment labels or categories have been migrated. The pay service was restarted with approval and verified active; its sign-in page returns HTTP 200.

## Findings

There are 16 distinct job titles, 8 location values, 17 department values and 12 payscale values. Fourteen payscale descriptors are blank. Some saved legacy rows have merged department/title/descriptor text; three titles contain only `R4`. Re-extraction in the prior corpus audit produces intact columns for these examples. Repair source extraction before creating category aliases for malformed values.

Seven location fields say `Default Employee Home Address`: this is a payroll location placeholder, not evidence of a hospital or remote working. Keep the raw text and classify the site as unknown until confirmed.

Several fields mix different concepts. `Bank - Specialty Registrar (ST4)` combines role, grade and engagement type. `ACCS - Anaesthetics` combines programme and specialty. `Holt Agency Drs - AdHoc - Locum Independent Contractor` combines agency, engagement wording and role. `CHFT Staff Bank` describes a staffing unit rather than a clinical specialty. A payscale such as `ST3+ Doctor Bank` is a pay band and does not prove the doctor's actual training year. The printed phrase `Independent Contractor` alone should not determine tax treatment.

## Options

| Approach | Benefits | Limitations |
| --- | --- | --- |
| Free text with suggestions | Quick, accommodates new wording | Typos, aliases and mixed concepts persist |
| One fixed dropdown per existing field | Consistent choices | Forces ambiguous source wording into a single category and loses detail |
| Original values plus controlled linked categories | Preserves evidence, supports consistent filters and corrections | Requires reference lists, alias mappings and an unresolved queue |

Recommend the third approach, using searchable selects with stable database IDs and server-side validation. Do not rely on an HTML datalist: it still accepts arbitrary text.

## Proposed fields and initial categories

| Field | Model and initial options | Editing control |
| --- | --- | --- |
| Job title / role | Foundation doctor; Specialty registrar; Doctor (grade unspecified); Other; Unknown | Required searchable select; Other requires a label |
| Training grade | FY1, FY2, CT1, CT2, CT3, ST1–ST8, other recognised grade, Unknown; optional Not applicable only when confirmed | Separate select; never infer a precise year from a range or `ST3+` band |
| Specialty | Emergency medicine, Intensive care medicine, Anaesthetics, Haematology, Thoracic medicine, Upper GI surgery, Urology, Other, Unknown | Searchable select; evidence may come from department or job title |
| Programme | ACCS; other confirmed programme; Unknown | Optional separate select |
| Engagement type | Substantive/regular employment; Staff bank; Agency locum; Direct locum; Other; Unknown | Select; separate from role and from salary availability |
| Location | A hospital/site reference, linked to an organisation where confirmed | Searchable select; Unknown is explicit |
| Department | Employer-specific unit, retaining an optional payroll code and display name | Select constrained by the payroll employer, plus reviewed aliases |
| Payscale descriptor | Employer/contract-specific pay-scale record, retaining the exact printed descriptor | Searchable select constrained by employer/contract; Unknown and Not applicable remain distinct |

The existing `wage.employment_type=ad_hoc` remains useful for salary validation but is too broad for engagement reporting. Bank, agency and direct locum should all support missing annual salary without being conflated in the new categorisation.

## Concrete mappings from this database

- `Foundation Doctor Year 1` and `Foundation Year 1` → Foundation doctor / FY1. `Foundation Doctor Year 2` → Foundation doctor / FY2.
- `Specialty Registrar`, `ST - Emergency Medicine`, `Specialty Registrar HST` and `Higher Trainee (...)` → Specialty registrar. Store the printed title separately; obtain grade from explicit evidence on that slip, not a default across the whole employment.
- `ACCS - Emergency Medicine`, `ACCS - Intensive Care Medicine` and `ACCS - Anaesthetics` → programme ACCS, with the corresponding specialty. Confirm grade from the payscale when it is explicit.
- `Bank - Specialty Registrar (ST4)` → Specialty registrar / ST4 / Staff bank. Keep `ST3+ Doctor Bank` as the pay band when printed.
- `Locum Doctor` → Doctor / grade unspecified, with the locum arrangement confirmed separately. Neither that title nor `389 Bank Doctor` alone should automatically resolve every engagement distinction.
- `Holt Agency Drs - AdHoc - Locum Independent Contractor` → Doctor / grade unspecified / Agency locum; preserve the agency wording. `Ad Hoc` is a pay arrangement descriptor, not a training grade.
- `Medical & Dental - Temporary Staffing` → Doctor / grade unspecified; temporary staffing does not by itself prove agency or direct-bank arrangements.
- `R4` → extraction review. Re-extract the title and neighbouring cells; do not create an `R4` role alias.
- Hospital choices: University Hospital Aintree, Royal Preston Hospital, Royal Bolton Hospital, Huddersfield Royal Infirmary, Bradford Royal Infirmary, Bassetlaw Hospital and Leeds General Infirmary. Keep `Default Employee Home Address` as unknown site.
- Clearly truncated department aliases can have reviewed display names, for example `Clinical Haemato` → Clinical haematology and `Emergency Medici` → Emergency medicine. `Lancashire Teach`, `NW Lancashire Te`, `D-Recharge a/c -` and `Medical Staff -` remain employer/staffing units; they do not independently establish a clinical specialty.
- Keep `20334 Med Staff` and `20047-Locum Doct` as employer-scoped units with payroll codes 20334 and 20047. Do not use the code as a globally unique department ID.
- The observed pay-scale choices are Foundation Doctor Year 1/2; Specialty Registrar CT1/CT2/CT3; Specialty Registrar ST4/SpR4 and ST5/SpR5; ST3+ Doctor Bank; 389 Bank Doctor; Ad Hoc Medical Grades; Ad Hoc; and unresolved blank values. Keep separate employer/contract records even where the display label matches.

## Storage and review rules

Preserve four source strings (`job_title`, `location`, `department`, `payscale_descriptor`) with PDF/version provenance. Store categorisation separately, with IDs, evidence, confirmation status and history. A correction to extracted wording is a versioned source correction; a change to a canonical label is a category change. Renaming a category must not change the source PDF values.

Use reference tables for sites, departments, roles, grades and pay scales, and scoped alias tables. Aliases should include employer/contract context where needed. A proposed new category is created through a deliberate “Add category” action with duplicate checks, rather than by typing into each payslip field. Check allowed IDs and parent relationships on the server, including through the advanced JSON editor.

On import, retain the original fields, apply only confirmed exact aliases, and show the source wording beside the proposed category. Unknown wording goes to classification review. Keep classification review distinct from financial validation: a reconciled payslip with a known pay date must still contribute to the correct tax year while its specialty is unresolved. Never guess a category solely to make a mandatory dropdown pass.

Apply employment defaults within an effective date range and allow per-slip exceptions for rotations or promotions. A bulk alias change should preview affected slips and require deliberate confirmation, retaining its history.

## Implementation order

1. Re-extract the malformed legacy job columns, compare against source PDFs and preview the changes. Do not promote merged strings into categories.
2. Add source-preserving reference tables and seed the observed choices above. Set uncertain values to Unknown; do not backfill guesses.
3. Replace category text inputs with searchable selects and implement a consistent category editor and classification-review queue.
4. Preview and confirm aliases; add filters and export both source and categorised values.
5. Before tax forecasting, reconcile by payroll employer/PAYE reference, assignment and tax year. Location, department, role or a renamed category must never change tax-year membership, join distinct payrolls, or reset/double-count YTD totals. Continue using the printed pay date for year grouping.
