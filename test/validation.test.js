const { test } = require("node:test");
const assert = require("node:assert/strict");
const { payslip } = require("./fixtures");
const {
  pennies,
  dateOnly,
  validate,
  fingerprint,
  yearRange,
} = require("../lib/validation");
const parser = require("../split_sections");
test("decimal money preserves signed adjustments and rejects malformed values", () => {
  assert.equal(pennies("-1,234.56"), -123456);
  assert.equal(pennies("+0.01"), 1);
  for (const n of ["NaN", "1.234", "", "1e5", "£12", "1,2"])
    assert.throws(() => pennies(n));
});
test("valid payslip reconciles; missing fields and numerical errors require review", () => {
  assert.deepEqual(validate(payslip()).errors, []);
  for (const patch of [
    { pay_lines: [] },
    { wage: null },
    { pay_date: "31/02/2026" },
    { net_pay: "3000.00" },
    { total_payments: "NaN" },
    { deduction_lines: { PAYE: "2.00" } },
    { demographics: { name: "Sample" } },
    { this_period_summary: {} },
  ])
    assert.ok(validate(payslip(patch)).errors.length);
});
test("signed deductions and pay adjustments reconcile", () => {
  const p = payslip();
  p.pay_lines.push({ Description: "Correction", Amount: "-100.00" });
  p.total_payments = p.this_period_summary.total_payments = "3900.00";
  p.deduction_lines.PAYE = "-50.00";
  p.total_deductions = p.this_period_summary.total_deductions = "350.00";
  p.net_pay = p.this_period_summary.net_pay = "3550.00";
  assert.deepEqual(validate(p).errors, []);
});
test("date parsing is strict and tax/academic periods are adjacent", () => {
  assert.equal(dateOnly("24 OCT 2026"), "2026-10-24");
  assert.throws(() => dateOnly("2026-02-30"));
  assert.deepEqual(yearRange("tax", 2026), ["2026-04-06", "2027-04-06"]);
  assert.deepEqual(yearRange("academic", 2026), ["2026-08-05", "2027-08-04"]);
  assert.equal(yearRange("academic", 2026)[1], yearRange("academic", 2027)[0]);
  for (const y of ["bad", 12, "2026junk"])
    assert.throws(() => yearRange("tax", y));
});
test("fingerprint excludes filenames and property ordering", () => {
  const p = payslip();
  assert.equal(
    fingerprint(p),
    fingerprint(
      Object.fromEntries(
        Object.entries({ ...p, filename: "renamed.pdf" }).reverse(),
      ),
    ),
  );
  assert.notEqual(fingerprint(p), fingerprint({ ...p, net_pay: "1.00" }));
});
test("supported column layout extracts pay lines; unsupported layout fails closed", () => {
  assert.deepEqual(
    parser.parse_pay_lines(["Basic pay", "160", "160", "25", "4000.00"]),
    [
      {
        Description: "Basic pay",
        Worked: "160",
        Paid: "160",
        Rate: "25",
        Amount: "4000.00",
      },
    ],
  );
  assert.throws(() => parser.parse_pay_lines(["Unknown", "123"]));
  assert.equal(
    parser.parse_section_3("TOTAL PAYMENTS\nTOTAL DEDUCTIONS\n12.00")[
      "TOTAL PAYMENTS"
    ],
    null,
  );
});

test("full synthetic NHS extraction reconciles, preserving absent optional balances", async () => {
  const text = require("fs").readFileSync(
    require("path").join(__dirname, "fixtures/nhs-esr.txt"),
    "utf8",
  );
  const data = await parser.process_loaded_payslip(text, "synthetic.pdf");
  const result = validate(data);
  assert.deepEqual(result.errors, []);
  assert.equal(result.data.pay_date, "2026-10-24");
  assert.equal(result.data.net_pay, "2800.00");
  assert.equal(result.data.year_to_date.other_ni_contributions, null);
  await assert.rejects(
    parser.process_loaded_payslip(
      text.replace(
        "YearToDateBalances(ThisEmploymentOnly)ThisPeriodSummary",
        "missing section",
      ),
      "bad.pdf",
    ),
  );
});

test("PDF text extraction supports the complete synthetic NHS fixture", async () => {
  const fs = require("fs/promises"),
    os = require("os"),
    path = require("path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pay-pdf-"));
  try {
    const text = await fs.readFile(
      path.join(__dirname, "fixtures/nhs-esr.txt"),
      "utf8",
    );
    const file = path.join(dir, "fixture.pdf");
    await fs.writeFile(file, require("./pdf-fixture").pdf(text));
    const data = await parser.process_loaded_payslip(
      await parser.readPDF(file),
      "fixture.pdf",
    );
    assert.deepEqual(validate(data).errors, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("refund suffixes normalise once and reconcile with signed totals", () => {
  const p = payslip();
  p.deduction_lines.PAYE = "50.00 R";
  p.total_deductions = p.this_period_summary.total_deductions = "350.00";
  p.net_pay = p.this_period_summary.net_pay = "3650.00";
  const result = validate(p);
  assert.deepEqual(result.errors, []);
  assert.equal(result.data.deduction_lines.PAYE, "-50.00");
  assert.equal(parser.deductionAmount("-50.00R"), "-50.00");
});
test("decimal standard hours preserve PT salary; explicit ad-hoc work needs no annual salary", async () => {
  assert.deepEqual(parser.parse_wage_line("67998.0034.558648.28"), {
    salary: 67998,
    inc_date: "",
    standard_hours: 34.5,
    part_time_salary: 58648.28,
  });
  assert.deepEqual(
    validate(payslip({ wage: { salary: null, employment_type: "ad_hoc" } }))
      .errors,
    [],
  );
  assert.ok(
    validate(payslip({ wage: { salary: null, employment_type: "salaried" } }))
      .errors.length,
  );
  const fs = require("fs"),
    path = require("path");
  let text = fs
    .readFileSync(path.join(__dirname, "fixtures/nhs-esr.txt"), "utf8")
    .replace(
      "Emergency medicineDoctorExample scale",
      "CHFT Staff Bank Bank - Specialty Registrar (ST4)ST3+ Doctor Bank",
    )
    .replace("60000.003760000.00", "0")
    .replace(
      "Example123/AB1231257LAA123456A",
      "Example123/AB123\n1257L \nNONCUMAA123456A",
    );
  const p = await parser.process_loaded_payslip(text, "Bank.pdf");
  assert.equal(p.wage.employment_type, "ad_hoc");
  assert.equal(p.tax.ni_number, "AA123456A");
  assert.match(p.job.job_title, /Specialty Registrar/);
  assert.deepEqual(validate(p).errors, []);
});
test("printed precision explains high-rate rounding without accepting arbitrary differences", () => {
  const p = payslip();
  p.pay_lines = [
    {
      Description: "Basic pay",
      Paid: "142.81",
      Rate: "32.6018",
      Amount: "4655.97",
    },
  ];
  p.total_payments = p.this_period_summary.total_payments = "4655.97";
  p.net_pay = p.this_period_summary.net_pay = "3455.97";
  assert.deepEqual(validate(p).errors, []);
  p.pay_lines[0].Amount = "4654.97";
  assert.ok(validate(p).errors.some((e) => e.field === "pay_lines.0.Amount"));
});
test("refund-only slips are valid only with zero payments and reconciled deductions", () => {
  const p = payslip({ pay_lines: [] });
  p.total_payments = p.this_period_summary.total_payments = "0.00";
  p.deduction_lines = { PAYE: "250.60R" };
  p.total_deductions = p.this_period_summary.total_deductions = "-250.60";
  p.net_pay = p.this_period_summary.net_pay = "250.60";
  assert.deepEqual(validate(p).errors, []);
});
test("tax years use pay date across the April boundary, independent of period end", () => {
  const { taxYear } = require("../lib/validation");
  assert.equal(taxYear("2026-04-05"), 2025);
  assert.equal(taxYear("2026-04-06"), 2026);
  for (const [date, year] of [
    ["2026-04-05", "2025/26"],
    ["2026-04-06", "2026/27"],
  ]) {
    const p = payslip({ pay_date: date });
    p.this_period_summary.period_end_date = "2026-03-31";
    assert.equal(validate(p).data.this_period_summary.tax_year, year);
  }
});
test("PDF coordinates preserve blank cells and separate a one-row deduction", async () => {
  const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
  const items = [
    item("DESCRIPTION", 53, 700),
    item("WKD/EARNED", 155.205, 700),
    item("PAID/DUE", 205, 700),
    item("RATE", 254, 700),
    item("AMOUNT", 301, 700),
    item("DESCRIPTION", 373, 700),
    item("AMOUNT", 457, 700),
    item("BALANCE C/F", 508, 700),
    item("BasicPay", 53, 680),
    item("160.00", 170, 680),
    item("160.00", 215, 680),
    item("25.0000", 253, 680),
    item("4000.00", 310, 680),
    item("Allowance", 53, 670),
    item("50.00", 310, 670),
    item("PAYE", 342.25, 680),
    item("50.00R", 470, 680),
    item("Year", 56.7, 420),
    item("ToDateBalances(ThisEmploymentOnly)ThisPeriodSummary", 73, 420),
  ];
  const text = await parser.renderPage({
    getTextContent: async () => ({ items }),
  });
  const sections = parser.splitSections(text);
  const table = parser.split_pay_deductions(sections.section2);
  assert.deepEqual(table.deductions, { PAYE: "-50.00" });
  const pay = parser.parse_pay_lines(table.pay_lines);
  assert.equal(pay.length, 2);
  assert.equal(pay[1].Description, "Allowance");
  assert.equal(pay[1].Rate, "' '");
  assert.equal(pay[1].Amount, "50.00");
});
test("tax columns preserve leading-zero codes instead of consuming them into the reference", () => {
  const tax = parser.parse_tax_line("Example|567/S5005|0T CUMUL|AA123456A");
  assert.equal(tax.tax_reference, "567/S5005");
  assert.equal(tax.tax_code, "0T CUMUL");
});

test("manual historical advices can preserve explicitly unreported YTD gross without inventing balances", () => {
  const p = payslip();
  p.year_to_date.gross_pay = null;
  p.year_to_date.taxable_pay = "24000.00";
  assert.ok(
    validate(p).errors.some((e) => e.field === "year_to_date.gross_pay"),
  );
  p.this_period_summary.import_method = "manual_transcription";
  p.this_period_summary.ytd_gross_not_reported = true;
  const checked = validate(p);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.data.year_to_date.gross_pay, null);
  p.year_to_date.taxable_pay = null;
  assert.ok(validate(p).errors.length);
});
test("owner acknowledgement accepts only the recorded line figures and keeps total validation", () => {
  const p = payslip();
  p.pay_lines[0].Paid = "159.99";
  assert.ok(validate(p).errors.some((e) => e.field === "pay_lines.0.Amount"));
  const line = p.pay_lines[0];
  line.rounding_acknowledgement = {
    approved_by: "owner",
    reason: "Owner accepted printed payroll calculation",
    description: line.Description,
    paid: line.Paid,
    rate: line.Rate,
    amount: line.Amount,
  };
  assert.deepEqual(validate(p).errors, []);
  line.Paid = "159.98";
  assert.ok(validate(p).errors.some((e) => e.field === "pay_lines.0.Amount"));
  line.Paid = "159.99";
  p.total_payments = p.this_period_summary.total_payments = "4001.00";
  assert.ok(validate(p).errors.some((e) => e.field === "pay_lines"));
});
