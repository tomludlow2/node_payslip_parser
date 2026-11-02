const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const parser = require("../split_sections");
const { validate, fingerprint, identity } = require("./validation");
const MAX_BYTES = 20 * 1024 * 1024;
const FIELDS = [
  "filename",
  "demographics",
  "job",
  "wage",
  "tax",
  "deduction_lines",
  "pay_lines",
  "this_period_summary",
  "year_to_date",
  "total_payments",
  "total_deductions",
  "pay_date",
  "net_pay",
];
class Imports {
  constructor(pool, root = path.join(__dirname, "../payslips/objects")) {
    this.pool = pool;
    this.root = root;
  }
  async store(buffer) {
    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length > MAX_BYTES ||
      buffer.subarray(0, 5).toString() !== "%PDF-"
    )
      throw new Error("A PDF of at most 20 MB is required");
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.root, crypto.randomUUID() + ".tmp");
    try {
      await fs.writeFile(temporary, buffer, { flag: "wx", mode: 0o600 });
      try {
        await fs.link(temporary, path.join(this.root, hash + ".pdf"));
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
    return { hash, storage: hash + ".pdf" };
  }
  file(name) {
    if (!/^[a-f0-9]{64}\.pdf$/.test(name || ""))
      throw new Error("Invalid document");
    return path.join(this.root, name);
  }
  async ingest(owner, { kind, key, filename, etag, buffer }) {
    const object = await this.store(buffer);
    const c = await this.pool.connect();
    let attempt;
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock($1)", [owner.id]);
      const s = await c.query(
        "INSERT INTO import_sources(owner_id,kind,source_key,filename) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,kind,source_key) DO UPDATE SET filename=$4 RETURNING *",
        [owner.id, kind, key, filename],
      );
      const revision = etag || object.hash;
      const previous = (
        await c.query(
          "SELECT * FROM import_attempts WHERE source_id=$1 ORDER BY id DESC LIMIT 1",
          [s.rows[0].id],
        )
      ).rows[0];
      if (previous?.etag === revision) {
        attempt = (
          await c.query(
            "UPDATE import_attempts SET storage_name=$2,raw_hash=$3 WHERE id=$1 RETURNING *",
            [previous.id, object.storage, object.hash],
          )
        ).rows[0];
      } else {
        attempt = (
          await c.query(
            "INSERT INTO import_attempts(source_id,etag,storage_name,raw_hash) VALUES($1,$2,$3,$4) RETURNING *",
            [s.rows[0].id, revision, object.storage, object.hash],
          )
        ).rows[0];
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    if (["saved", "duplicate"].includes(attempt.status)) return attempt;
    return this.process(owner, attempt.id);
  }
  async process(owner, id, edited, confirm = false) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock($1)", [owner.id]);
      const r = await c.query(
        "SELECT a.*,s.payslip_id,s.filename FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE a.id=$1 AND s.owner_id=$2 FOR UPDATE OF a,s",
        [id, owner.id],
      );
      const a = r.rows[0];
      if (!a) throw new Error("Import not found");
      if (["saved", "duplicate"].includes(a.status)) {
        await c.query("COMMIT");
        return a;
      }
      if (!a.storage_name)
        throw new Error("Download not available; run sync again");
      let draft = edited;
      let errors = [];
      if (!draft) {
        try {
          const text = await parser.readPDF(this.file(a.storage_name));
          draft = await parser.process_loaded_payslip(text, a.filename);
        } catch (e) {
          errors = [
            {
              field: "pdf",
              message:
                e.message === "Missing required payslip section"
                  ? "This PDF uses an unsupported or scanned layout. Enter the details from the original document, or upload an original ESR PDF."
                  : "Could not extract the NHS table reliably. Enter the details from the original document or retry after parser support is updated.",
            },
          ];
        }
      }
      let data;
      if (draft) {
        const checked = validate(draft);
        data = Object.fromEntries(FIELDS.map((k) => [k, checked.data[k]]));
        data.filename = a.filename;
        errors = checked.errors;
      }
      if (!errors.length) {
        let existing;
        if (a.payslip_id)
          existing = (
            await c.query(
              "SELECT * FROM payslips WHERE id=$1 AND username=$2 FOR UPDATE",
              [a.payslip_id, owner.username],
            )
          ).rows[0];
        const hash = fingerprint(data);
        const matches = (
          await c.query(
            "SELECT * FROM payslips WHERE username=$1 AND (raw_hash=$2 OR content_hash=$3)",
            [owner.username, a.raw_hash, hash],
          )
        ).rows;
        if (!existing && matches.length === 1) {
          await c.query(
            "UPDATE import_sources SET payslip_id=$1,etag=$2 WHERE id=$3",
            [matches[0].id, a.etag, a.source_id],
          );
          await c.query(
            "UPDATE import_attempts SET status='duplicate',draft=$2,errors='[]',updated_at=now() WHERE id=$1",
            [id, data],
          );
          await c.query("COMMIT");
          return { ...a, status: "duplicate" };
        }
        if (!existing && matches.length > 1)
          errors.push({
            field: "duplicate",
            message:
              "Multiple saved records match this content. Resolve the existing duplicates before saving.",
          });
        if (!existing) {
          const candidates = (
            await c.query(
              "SELECT * FROM payslips WHERE username=$1 AND pay_date=$2 AND demographics->>'assignment_no'=$3",
              [
                owner.username,
                data.pay_date,
                String(data.demographics.assignment_no),
              ],
            )
          ).rows;
          if (candidates.length === 1 && confirm) existing = candidates[0];
          else if (candidates.length)
            errors.push({
              field: "replacement",
              message:
                "An existing payslip has this assignment and pay date. Compare it and confirm replacement.",
            });
        }
        if (
          existing &&
          (identity(existing) !== identity(data) ||
            String(
              existing.pay_date instanceof Date
                ? existing.pay_date.toISOString().slice(0, 10)
                : existing.pay_date,
            ) !== data.pay_date) &&
          !confirm
        )
          errors.push({
            field: "identity",
            message:
              "Assignment, NI number or pay date changed. Confirm replacement after checking the PDF.",
          });
        const newer = (
          await c.query(
            "SELECT 1 FROM payslip_versions v JOIN import_attempts newer ON newer.id=v.attempt_id WHERE v.payslip_id=$1 AND newer.id>$2 LIMIT 1",
            [existing?.id || null, id],
          )
        ).rows.length;
        if (newer && !confirm)
          errors.push({
            field: "replacement",
            message:
              "A newer import is already saved. Confirm explicitly to restore this older attempt.",
          });
        if (!errors.length) {
          if (existing) {
            // Snapshot legacy/current data before the first replacement; immutable objects never move.
            const previous = (
              await c.query(
                "SELECT id FROM payslip_versions WHERE payslip_id=$1 LIMIT 1",
                [existing.id],
              )
            ).rows;
            if (!previous.length) {
              let legacy = null;
              if (
                !existing.raw_hash &&
                path.basename(existing.filename) === existing.filename &&
                path.basename(owner.username) === owner.username
              ) {
                try {
                  const b = await fs.readFile(
                    path.join(
                      __dirname,
                      "../payslips",
                      owner.username,
                      "processed",
                      existing.filename,
                    ),
                  );
                  legacy = await this.store(b);
                } catch (e) {
                  if (e.code !== "ENOENT") throw e;
                }
              }
              await c.query(
                "INSERT INTO payslip_versions(payslip_id,data,storage_name,raw_hash) VALUES($1,$2,$3,$4)",
                [
                  existing.id,
                  existing,
                  existing.raw_hash
                    ? existing.raw_hash + ".pdf"
                    : legacy?.storage,
                  existing.raw_hash || legacy?.hash,
                ],
              );
            }
            await c.query(
              `UPDATE payslips SET ${FIELDS.map((k, i) => `${k}=$${i + 2}`).join(",")},raw_hash=$${FIELDS.length + 2},content_hash=$${FIELDS.length + 3} WHERE id=$1`,
              [
                existing.id,
                ...FIELDS.map((k) =>
                  [
                    "demographics",
                    "job",
                    "wage",
                    "tax",
                    "deduction_lines",
                    "pay_lines",
                    "this_period_summary",
                    "year_to_date",
                  ].includes(k)
                    ? JSON.stringify(data[k])
                    : data[k],
                ),
                a.raw_hash,
                hash,
              ],
            );
          } else {
            const row = await c.query(
              `INSERT INTO payslips(username,${FIELDS.join(",")},file_hash,raw_hash,content_hash) VALUES(${Array.from({ length: FIELDS.length + 4 }, (_, i) => "$" + (i + 1)).join(",")}) RETURNING id`,
              [
                owner.username,
                ...FIELDS.map((k) =>
                  typeof data[k] === "object"
                    ? JSON.stringify(data[k])
                    : data[k],
                ),
                crypto.randomBytes(32).toString("hex"),
                a.raw_hash,
                hash,
              ],
            );
            existing = row.rows[0];
          }
          await c.query(
            "INSERT INTO payslip_versions(payslip_id,attempt_id,data,storage_name,raw_hash) VALUES($1,$2,$3,$4,$5)",
            [existing.id, id, data, a.storage_name, a.raw_hash],
          );
          await c.query(
            "UPDATE import_sources SET payslip_id=$1,etag=$2 WHERE id=$3",
            [existing.id, a.etag, a.source_id],
          );
          await c.query(
            "UPDATE import_attempts SET status='saved',draft=$2,errors='[]',next_retry=NULL,updated_at=now() WHERE id=$1",
            [id, data],
          );
          await c.query("COMMIT");
          return { ...a, status: "saved" };
        }
      }
      await c.query(
        "UPDATE import_attempts SET status='review',draft=$2,errors=$3,next_retry=NULL,updated_at=now() WHERE id=$1",
        [id, data || null, JSON.stringify(errors)],
      );
      await c.query("COMMIT");
      return { ...a, status: "review", errors };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}
module.exports = { Imports, MAX_BYTES, FIELDS };
