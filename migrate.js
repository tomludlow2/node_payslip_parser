const fs = require("fs");
const pool = require("./database");
(async () => {
  try {
    await pool.query(
      fs.readFileSync(
        require("path").join(__dirname, "migrations/001_imports.sql"),
        "utf8",
      ),
    );
    console.log("Migration complete");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
