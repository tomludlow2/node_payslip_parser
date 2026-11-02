const parser = require("../split_sections");
const { validate, dateOnly, fingerprint } = require("./validation");
const { FIELDS } = require("./imports");
async function repairSavedTax(pool, imports, owner) {
  const slips = (
    await pool.query(
      "SELECT * FROM payslips WHERE username=$1 AND raw_hash IS NOT NULL ORDER BY id",
      [owner.username],
    )
  ).rows;
  const repaired = [];
  for (const old of slips) {
    const parsed = await parser.process_loaded_payslip(
      await parser.readPDF(imports.file(old.raw_hash + ".pdf")),
      old.filename,
    );
    const checked = validate(parsed);
    if (
      checked.errors.length ||
      dateOnly(old.pay_date) !== checked.data.pay_date ||
      old.tax?.ni_number !== checked.data.tax.ni_number
    )
      continue;
    const tax = { ...old.tax };
    for (const field of ["tax_office", "tax_reference", "tax_code"])
      tax[field] = checked.data.tax[field];
    if (JSON.stringify(tax) === JSON.stringify(old.tax)) continue;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock($1)", [owner.id]);
      const current = (
        await c.query(
          "SELECT * FROM payslips WHERE id=$1 AND username=$2 FOR UPDATE",
          [old.id, owner.username],
        )
      ).rows[0];
      if (JSON.stringify(current) !== JSON.stringify(old))
        throw new Error("Saved record changed during tax audit; retry");
      const data = { ...old, tax };
      await c.query(
        "INSERT INTO payslip_versions(payslip_id,data,storage_name,raw_hash) VALUES($1,$2,$3,$4)",
        [old.id, old, old.raw_hash + ".pdf", old.raw_hash],
      );
      await c.query("UPDATE payslips SET tax=$2,content_hash=$3 WHERE id=$1", [
        old.id,
        tax,
        fingerprint(Object.fromEntries(FIELDS.map((k) => [k, data[k]]))),
      ]);
      await c.query(
        "INSERT INTO payslip_versions(payslip_id,data,storage_name,raw_hash) VALUES($1,$2,$3,$4)",
        [old.id, data, old.raw_hash + ".pdf", old.raw_hash],
      );
      await c.query(
        "UPDATE import_attempts SET draft=jsonb_set(draft,'{tax}',$2::jsonb),updated_at=now() WHERE raw_hash=$1 AND status='saved' AND source_id IN (SELECT id FROM import_sources WHERE owner_id=$3)",
        [old.raw_hash, JSON.stringify(tax), owner.id],
      );
      await c.query("COMMIT");
      repaired.push(old.id);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  return repaired;
}
module.exports = { repairSavedTax };
