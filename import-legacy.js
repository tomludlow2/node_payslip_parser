require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const pool = require("./database");
const { Imports } = require("./lib/imports");
const { validate, fingerprint } = require("./lib/validation");
(async () => {
  try {
    const owner = (
      await pool.query("SELECT * FROM users WHERE id=$1", [
        process.env.OWNER_ID,
      ])
    ).rows[0];
    if (!owner) throw new Error("Configure an existing OWNER_ID");
    if (path.basename(owner.username) !== owner.username)
      throw new Error("Invalid legacy owner directory");
    const imports = new Imports(pool);
    const rows = (
      await pool.query(
        "SELECT * FROM payslips WHERE username=$1 AND content_hash IS NULL",
        [owner.username],
      )
    ).rows;
    for (const row of rows) {
      const result = validate({
        ...row,
        pay_date: new Date(row.pay_date).toISOString().slice(0, 10),
      });
      if (!result.errors.length)
        await pool.query("UPDATE payslips SET content_hash=$2 WHERE id=$1", [
          row.id,
          fingerprint(result.data),
        ]);
    }
    const dir = path.join(__dirname, "payslips", owner.username, "uploaded");
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    for (const name of names.filter((n) => /\.pdf$/i.test(n))) {
      const stat = await fs.lstat(path.join(dir, name));
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      await imports.ingest(owner, {
        kind: "manual",
        key: name,
        filename: name,
        buffer: await fs.readFile(path.join(dir, name)),
      });
    }
    console.log("Legacy indexing complete. Original files were retained.");
  } catch (e) {
    console.error("Legacy indexing failed:", e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
