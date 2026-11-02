require("dotenv").config();
const pool = require("./database");
const { Imports } = require("./lib/imports");
const { Nextcloud, sync } = require("./lib/nextcloud");
(async () => {
  try {
    if (
      !process.env.OWNER_ID ||
      !process.env.NEXTCLOUD_URL ||
      !process.env.NEXTCLOUD_USERNAME ||
      !process.env.NEXTCLOUD_APP_PASSWORD ||
      !process.env.NEXTCLOUD_FOLDER
    )
      throw new Error(
        "Configure owner and Nextcloud settings before running the worker",
      );
    const owner = (
      await pool.query("SELECT * FROM users WHERE id=$1", [
        process.env.OWNER_ID,
      ])
    ).rows[0];
    if (!owner) throw new Error("Owner does not exist");
    await sync(
      pool,
      new Imports(pool),
      owner,
      new Nextcloud({
        url: process.env.NEXTCLOUD_URL,
        username: process.env.NEXTCLOUD_USERNAME,
        password: process.env.NEXTCLOUD_APP_PASSWORD,
        folder: process.env.NEXTCLOUD_FOLDER,
      }),
    );
    console.log("Sync finished");
  } catch (e) {
    console.error(
      "Sync failed; check configuration and the import status screen.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
