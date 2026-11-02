const fs = require("fs/promises");
const path = require("path");
const Excel = require("exceljs");
const c = require("../lib/categories");
const fields = [
  "key",
  "payslip_ids",
  "first_paid",
  "last_paid",
  "source_job_title",
  "source_location",
  "source_department",
  "source_payscale",
  "grade",
  "location",
  "locum_type",
  "job_title",
  "department",
  "payscale_descriptor",
  "reason",
  "confirmed",
];
async function writeOverrides(overrides) {
  const temporary = c.file + "." + require("crypto").randomUUID() + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(overrides, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await fs.rename(temporary, c.file);
}
async function exportMappings() {
  const pool = require("../database");
  const parser = require("../split_sections");
  let rows, imports;
  try {
    rows = (
      await pool.query(
        "SELECT * FROM payslips WHERE username=(SELECT username FROM users WHERE id=$1) ORDER BY pay_date,id",
        [process.env.OWNER_ID],
      )
    ).rows;
    imports = (
      await pool.query(
        "SELECT a.*,s.filename FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE s.owner_id=$1 AND a.status='review' ORDER BY a.id",
        [process.env.OWNER_ID],
      )
    ).rows;
  } finally {
    await pool.end();
  }
  const parse = async (storage, filename) => {
    try {
      const text = await parser.readPDF(
        path.join(__dirname, "../payslips/objects", storage),
      );
      try {
        return {
          text,
          draft: await parser.process_loaded_payslip(text, filename),
        };
      } catch (e) {
        return { text, failure: e.message };
      }
    } catch (e) {
      return { text: "", failure: e.message };
    }
  };
  const corpus = [];
  for (const a of imports)
    corpus.push({ id: a.id, ...(await parse(a.storage_name, a.filename)) });
  const overrides = c.loadOverrides(),
    groups = new Map();
  for (const p of rows) {
    const key = c.sourceKey(p);
    const parsed = p.raw_hash
      ? (await parse(p.raw_hash + ".pdf", p.filename)).draft
      : null;
    // Use intact PDF columns to propose corrections for malformed legacy values.
    const display = parsed ? { ...p, job: parsed.job } : p;
    const classified = { ...c.categorise(display), ...overrides[key] };
    const original = c.categorise(p);
    const sourceRepair = [
      "job_title",
      "department",
      "payscale_descriptor",
    ].some((field) => p.job?.[field] !== display.job?.[field]);
    if (sourceRepair) {
      // Display-only source corrections; original database/PDF evidence is retained.
      overrides[key] = {
        job_title: c.tidy(display.job.job_title),
        department: c.tidy(display.job.department),
        payscale_descriptor: c.tidy(display.job.payscale_descriptor),
        ...overrides[key],
      };
    }
    if (!groups.has(key))
      groups.set(key, {
        key,
        payslip_ids: [],
        first_paid: p.pay_date,
        last_paid: p.pay_date,
        source_job_title: p.job?.job_title,
        source_location: p.demographics?.location,
        source_department: p.job?.department,
        source_payscale: p.job?.payscale_descriptor,
        ...classified,
        reason: "",
        confirmed: "",
      });
    const g = groups.get(key);
    g.payslip_ids.push(p.id);
    g.last_paid = p.pay_date;
    const reasons = [];
    if (!classified.grade)
      reasons.push(
        /CT\s*3/i.test(JSON.stringify(display.job))
          ? "Printed CT3: should this map to ST3?"
          : "Grade not explicit or conflicting",
      );
    if (!classified.location)
      reasons.push("Payroll location is a placeholder; confirm organisation");
    if (classified.grade === "Locum" && !classified.locum_type)
      reasons.push("Confirm Agency Locum or Bank Locum");
    if (!classified.payscale_descriptor)
      reasons.push("Payscale descriptor missing");
    g.reason = reasons.join("; ");
    // When extraction is corrected, use the intact columns for categorisation too.
    if (sourceRepair && classified.grade && !original.grade)
      overrides[key].grade = classified.grade;
  }
  await fs.mkdir(path.dirname(c.file), { recursive: true, mode: 0o700 });
  await writeOverrides(overrides);
  const book = new Excel.Workbook();
  const data = [...groups.values()].map((g) => ({
    ...g,
    payslip_ids: g.payslip_ids.join(", "),
  }));
  for (const [name, items] of [
    ["Needs your input", data.filter((g) => g.reason)],
    ["All saved mappings", data],
  ]) {
    const sheet = book.addWorksheet(name);
    sheet.columns = fields.map((key) => ({
      header: key,
      key,
      width: [
        "reason",
        "source_job_title",
        "source_department",
        "payscale_descriptor",
      ].includes(key)
        ? 48
        : 25,
    }));
    items.forEach((g) => sheet.addRow(g));
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: "P1" };
    for (let row = 2; row <= sheet.rowCount; row++)
      for (const [col, values] of [
        [9, c.GRADES],
        [10, c.LOCATIONS],
        [11, c.LOCUM_TYPES],
      ])
        sheet.getCell(row, col).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [
            { 9: "GradeOptions", 10: "LocationOptions", 11: "LocumOptions" }[
              col
            ],
          ],
        };
  }
  const pending = book.addWorksheet("Pending import mappings");
  pending.columns = [
    "import_id",
    "filename",
    "grade",
    "location",
    "locum_type",
    "reason",
  ].map((key) => ({ header: key, key, width: key === "filename" ? 55 : 30 }));
  for (const a of imports.filter((a) => a.status === "review")) {
    const entry = corpus.find((x) => x.id === a.id);
    if (entry?.draft && !entry.failure && !entry.errors?.length) continue; // Already recovered.
    if (!entry?.failure) continue; // Existing ESR financial issues classify on retry.
    const name = a.filename;
    pending.addRow({
      import_id: a.id,
      filename: name,
      grade: "Locum",
      location: /Harrogate/i.test(name)
        ? c.LOCATIONS[3]
        : /Fairfield/i.test(name)
          ? c.LOCATIONS[4]
          : "",
      locum_type: /LAK Locum|agency/i.test(entry.text)
        ? "Agency Locum"
        : /\bBank\b/i.test(entry.text)
          ? "Bank Locum"
          : "",
      reason:
        "Financial import still pending; confirm these suggestions for later import",
    });
  }
  const lists = book.addWorksheet("Lists", { state: "hidden" });
  [c.GRADES, c.LOCATIONS, c.LOCUM_TYPES].forEach((values, i) =>
    values.forEach((v, j) => {
      lists.getCell(j + 1, i + 1).value = v;
    }),
  );
  for (const [i, name, values] of [
    [0, "GradeOptions", c.GRADES],
    [1, "LocationOptions", c.LOCATIONS],
    [2, "LocumOptions", c.LOCUM_TYPES],
  ]) {
    const col = String.fromCharCode(65 + i);
    book.definedNames.add(`Lists!$${col}$1:$${col}$${values.length}`, name);
  }
  const dir = path.join(__dirname, "../private/mapping-review");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "employment-mappings.xlsx");
  await book.xlsx.writeFile(file);
  await fs.chmod(file, 0o600);
  await book.csv.writeFile(path.join(dir, "uncertain-mappings.csv"), {
    sheetName: "Needs your input",
  });
  await fs.chmod(path.join(dir, "uncertain-mappings.csv"), 0o600);
  console.log(
    JSON.stringify({
      file,
      groups: data.length,
      uncertainGroups: data.filter((g) => g.reason).length,
      pendingImports: pending.rowCount - 1,
      displayCorrections: Object.keys(overrides).length,
    }),
  );
}
async function applyMappings(file, apply) {
  const book = new Excel.Workbook();
  await book.xlsx.readFile(file);
  const sheet = book.getWorksheet("Needs your input");
  if (!sheet) throw new Error("Missing Needs your input worksheet");
  const overrides = c.loadOverrides();
  let count = 0;
  sheet.eachRow((row, i) => {
    if (
      i === 1 ||
      String(row.getCell(16).value || "")
        .trim()
        .toLowerCase() !== "yes"
    )
      return;
    const key = String(row.getCell(1).value || "");
    if (!/^[a-f0-9]{64}$/.test(key))
      throw new Error("Invalid mapping key on row " + i);
    const entry = Object.fromEntries(
      fields
        .slice(8, 14)
        .map((field, j) => [
          field,
          String(row.getCell(j + 9).value || "").trim(),
        ]),
    );
    c.validateOverride(entry);
    overrides[key] = entry;
    count++;
  });
  if (apply) {
    await fs.copyFile(c.file, c.file + "." + Date.now() + ".bak");
    await writeOverrides(overrides);
  }
  console.log(JSON.stringify({ confirmedMappings: count, applied: apply }));
}
const input = process.argv.indexOf("--input");
(input >= 0
  ? applyMappings(process.argv[input + 1], process.argv.includes("--apply"))
  : exportMappings()
).catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
