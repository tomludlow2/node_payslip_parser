// Dry-run by default. --apply retries only review imports for configured owner.
// Ignored documents and replacement confirmations remain protected.
// --repair-saved-tax additionally repairs column extraction with version history.
const fs = require("fs/promises");
const path = require("path");
const pool = require("../database");
const parser = require("../split_sections");
const { validate } = require("../lib/validation");
const { Imports } = require("../lib/imports");
async function main() {
  const owner = (
    await pool.query("SELECT id,username FROM users WHERE id=$1", [
      process.env.OWNER_ID,
    ])
  ).rows[0];
  if (!owner) throw new Error("Configured owner not found");
  const imports = new Imports(pool);
  const attempts = (
    await pool.query(
      "SELECT a.*,s.filename FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE s.owner_id=$1 AND a.status='review' ORDER BY a.id",
      [owner.id],
    )
  ).rows;
  const apply = process.argv.includes("--apply");
  if (apply) {
    const dir = path.join(__dirname, "../private/backups");
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const backup = path.join(dir, `parser-review-${Date.now()}.json`);
    const snapshot = {};
    // Back up owner records before reprocessing; immutable PDF objects remain in place.
    for (const table of [
      "import_attempts",
      "import_sources",
      "payslips",
      "payslip_versions",
    ]) {
      const query = {
        import_attempts:
          "SELECT a.* FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE s.owner_id=$1",
        import_sources: "SELECT * FROM import_sources WHERE owner_id=$1",
        payslips: "SELECT * FROM payslips WHERE username=$1",
        payslip_versions:
          "SELECT v.* FROM payslip_versions v JOIN payslips p ON p.id=v.payslip_id WHERE p.username=$1",
      }[table];
      snapshot[table] = (
        await pool.query(query, [
          table.startsWith("import_") ? owner.id : owner.username,
        ])
      ).rows;
    }
    await fs.writeFile(backup, JSON.stringify(snapshot), {
      mode: 0o600,
      flag: "wx",
    });
    console.log("Backup:", backup);
  }
  const results = [];
  for (const a of attempts) {
    if (apply) {
      const result = await imports.process(owner, a.id);
      results.push({ id: a.id, status: result.status, errors: result.errors });
    } else {
      try {
        const data = await parser.process_loaded_payslip(
          await parser.readPDF(imports.file(a.storage_name)),
          a.filename,
        );
        const { errors } = validate(data);
        results.push({
          id: a.id,
          status: errors.length ? "review" : "valid",
          errors,
        });
      } catch (e) {
        results.push({ id: a.id, status: "review", reason: e.message });
      }
    }
  }
  if (apply && process.argv.includes("--repair-saved-tax")) {
    console.log(
      "Saved tax fields repaired:",
      await require("../lib/repair-tax").repairSavedTax(pool, imports, owner),
    );
  }
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(
    JSON.stringify(
      {
        apply,
        counts,
        remaining: results.filter(
          (r) => !["valid", "saved", "duplicate"].includes(r.status),
        ),
      },
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
