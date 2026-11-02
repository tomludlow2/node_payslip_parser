const { XMLParser, XMLValidator } = require("fast-xml-parser");
const { MAX_BYTES } = require("./imports");
class Nextcloud {
  constructor(config, fetcher = fetch) {
    this.url = new URL(config.url);
    if (this.url.protocol !== "https:")
      throw new Error("Nextcloud requires HTTPS");
    if (
      this.url.username ||
      this.url.password ||
      this.url.search ||
      this.url.hash
    )
      throw new Error(
        "Use a Nextcloud server URL without credentials or query parameters",
      );
    this.fetcher = fetcher;
    this.auth =
      "Basic " +
      Buffer.from(config.username + ":" + config.password).toString("base64");
    const segments = [...config.folder.split("/").filter(Boolean)];
    if (segments.some((s) => s === "." || s === ".."))
      throw new Error("Invalid folder");
    this.root =
      this.url.pathname.replace(/\/$/, "") +
      "/remote.php/dav/files/" +
      [config.username, ...segments].map(encodeURIComponent).join("/") +
      "/";
  }
  async request(href, method = "GET", headers = {}) {
    const url = new URL(href, this.url);
    if (url.origin !== this.url.origin || !url.pathname.startsWith(this.root))
      throw new Error("WebDAV response outside configured folder");
    const response = await this.fetcher(url, {
      method,
      headers: { Authorization: this.auth, ...headers },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const e = new Error(`Nextcloud request failed (${response.status})`);
      e.status = response.status;
      throw e;
    }
    return response;
  }
  async body(response, limit) {
    if (Number(response.headers.get("content-length")) > limit)
      throw new Error("Response exceeds size limit");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new Error("Response exceeds size limit");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  async list(href = this.root) {
    const response = await this.request(href, "PROPFIND", { Depth: "1" });
    const xml = (await this.body(response, 5 * 1024 * 1024)).toString();
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
      throw new Error("Invalid WebDAV XML");
    const doc = new XMLParser({
      removeNSPrefix: true,
      parseTagValue: false,
    }).parse(xml);
    const rows = doc.multistatus?.response;
    if (!rows) throw new Error("Missing WebDAV listing");
    return (Array.isArray(rows) ? rows : [rows])
      .map((row) => {
        const props = Array.isArray(row.propstat)
          ? row.propstat
          : [row.propstat];
        const good = props.find((p) => /\s200\s/.test(p?.status || ""));
        const p = good?.prop;
        if (!p) return null;
        const url = new URL(row.href, this.url);
        if (
          url.origin !== this.url.origin ||
          !url.pathname.startsWith(this.root)
        )
          throw new Error("Listing outside configured folder");
        const decoded = decodeURIComponent(url.pathname);
        if (
          decoded
            .split("/")
            .some((s) => s === ".." || s === "." || s.includes("\\"))
        )
          throw new Error("Invalid remote path");
        return {
          href: url.pathname,
          folder:
            typeof p.resourcetype === "object" &&
            Object.hasOwn(p.resourcetype, "collection"),
          etag: p.getetag,
          size: Number(p.getcontentlength || 0),
          filename: decoded.split("/").filter(Boolean).pop(),
        };
      })
      .filter(Boolean);
  }
  async files() {
    const pending = [this.root],
      seen = new Set(),
      files = [];
    while (pending.length) {
      const dir = pending.shift();
      if (seen.has(dir)) continue;
      seen.add(dir);
      if (seen.size > 10000) throw new Error("Folder scan limit exceeded");
      for (const item of await this.list(dir)) {
        if (item.folder) {
          if (!seen.has(item.href)) pending.push(item.href);
        } else if (/\.pdf$/i.test(item.filename)) files.push(item);
      }
    }
    return files;
  }
  async download(item) {
    if (!item.etag) throw new Error("Missing ETag");
    if (item.size > MAX_BYTES) throw new Error("PDF exceeds 20 MB");
    const response = await this.request(item.href, "GET", {
      "If-Match": item.etag,
    });
    const bytes = await this.body(response, MAX_BYTES);
    if (response.headers.get("etag") !== item.etag)
      throw new Error("PDF changed during download");
    const after = await this.request(item.href, "HEAD");
    if (after.headers.get("etag") !== item.etag)
      throw new Error("PDF changed during download");
    return bytes;
  }
}
async function sync(pool, imports, owner, client) {
  const lock = await pool.connect();
  let locked = false;
  try {
    locked = (
      await lock.query("SELECT pg_try_advisory_lock(78512342) AS locked")
    ).rows[0].locked;
    if (!locked) return { busy: true };
    await pool.query(
      "UPDATE sync_state SET requested=false,last_started=now(),error=NULL WHERE id=1",
    );
    // Recover interrupted/manual imports as well as failed parses.
    const pending = await pool.query(
      "SELECT a.id FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE s.owner_id=$1 AND a.storage_name IS NOT NULL AND (a.status='queued' OR (a.status='failed' AND a.next_retry<=now()))",
      [owner.id],
    );
    for (const a of pending.rows) {
      try {
        await imports.process(owner, a.id);
      } catch {
        await pool.query(
          "UPDATE import_attempts SET status='failed',tries=tries+1,next_retry=now()+interval '1 hour',errors=$2 WHERE id=$1",
          [
            a.id,
            JSON.stringify([
              {
                field: "storage",
                message: "Processing failed; retry scheduled",
              },
            ]),
          ],
        );
      }
    }
    for (const item of await client.files()) {
      const prior = (
        await pool.query(
          "SELECT a.* FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE s.owner_id=$1 AND s.kind='nextcloud' AND s.source_key=$2 ORDER BY a.id DESC LIMIT 1",
          [owner.id, item.href],
        )
      ).rows[0];
      if (
        prior &&
        prior.etag === item.etag &&
        (["saved", "duplicate", "review", "ignored"].includes(prior.status) ||
          (prior.next_retry && new Date(prior.next_retry) > new Date()))
      )
        continue;
      try {
        await imports.ingest(owner, {
          kind: "nextcloud",
          key: item.href,
          filename: item.filename,
          etag: item.etag,
          buffer: await client.download(item),
        });
      } catch (e) {
        const s = (
          await pool.query(
            "INSERT INTO import_sources(owner_id,kind,source_key,filename) VALUES($1,'nextcloud',$2,$3) ON CONFLICT(owner_id,kind,source_key) DO UPDATE SET filename=$3 RETURNING id",
            [owner.id, item.href, item.filename],
          )
        ).rows[0];
        const permanent = /20 MB|size limit|A PDF/.test(e.message);
        const errorDetails = JSON.stringify([
          {
            field: "nextcloud",
            message: permanent
              ? "PDF exceeds size limit or is not a supported PDF"
              : "Download or processing failed; retry scheduled",
          },
        ]);
        const latest = (
          await pool.query(
            "SELECT * FROM import_attempts WHERE source_id=$1 ORDER BY id DESC LIMIT 1",
            [s.id],
          )
        ).rows[0];
        if (latest?.etag === item.etag) {
          await pool.query(
            "UPDATE import_attempts SET status=$2,errors=$3,tries=tries+1,next_retry=now()+LEAST(interval '24 hours',interval '5 minutes'*power(2,LEAST(tries,8))),updated_at=now() WHERE id=$1",
            [latest.id, permanent ? "review" : "failed", errorDetails],
          );
        } else {
          await pool.query(
            "INSERT INTO import_attempts(source_id,etag,status,errors,tries,next_retry) VALUES($1,$2,$3,$4,1,now()+interval '5 minutes')",
            [s.id, item.etag, permanent ? "review" : "failed", errorDetails],
          );
        }
      }
    }
    await pool.query(
      "UPDATE sync_state SET last_completed=now(),error=NULL WHERE id=1",
    );
    return { success: true };
  } catch (e) {
    await pool.query(
      "UPDATE sync_state SET error='Nextcloud sync failed. Check connectivity, folder and app password.' WHERE id=1",
    );
    throw e;
  } finally {
    if (locked) await lock.query("SELECT pg_advisory_unlock(78512342)");
    lock.release();
  }
}
module.exports = { Nextcloud, sync };
