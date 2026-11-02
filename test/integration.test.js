require("../lib/pg-types");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { Imports } = require("../lib/imports");
const parser = require("../split_sections");
const { payslip } = require("./fixtures");
const enabled = !!process.env.TEST_PG_SOCKET;
let pool, imports, root;
const owner = { id: 1, username: "sample" };
let current = payslip();
const original = { read: parser.readPDF, parse: parser.process_loaded_payslip };
before(async () => {
  if (!enabled) return;
  assert.ok(
    process.env.TEST_PG_SOCKET.startsWith(
      path.join(os.tmpdir(), "pay-postgres-"),
    ),
    "Integration tests require the disposable test/run-postgres.sh cluster",
  );
  pool = new Pool({
    host: process.env.TEST_PG_SOCKET,
    port: Number(process.env.TEST_PG_PORT || 55439),
    user: os.userInfo().username,
    database: "postgres",
  });
  await pool.query(
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE TABLE users(id serial PRIMARY KEY,username text,email text,password text,provider text,provider_id text); CREATE TABLE payslips(id serial PRIMARY KEY,username text,filename text,demographics jsonb,job jsonb,wage jsonb,tax jsonb,deduction_lines jsonb,pay_lines jsonb,this_period_summary jsonb,year_to_date jsonb,total_payments numeric(12,2),total_deductions numeric(12,2),pay_date date,net_pay numeric(12,2),file_hash text UNIQUE)",
  );
  await pool.query(
    await fs.readFile(
      path.join(__dirname, "../migrations/001_imports.sql"),
      "utf8",
    ),
  );
  await pool.query(
    await fs.readFile(
      path.join(__dirname, "../migrations/001_imports.sql"),
      "utf8",
    ),
  );
  await pool.query(
    "INSERT INTO users(id,username,password) VALUES(1,'sample',$1),(2,'other',$1)",
    [await bcrypt.hash("test-password", 4)],
  );
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pay-objects-"));
  imports = new Imports(pool, root);
  parser.readPDF = async () => "fixture";
  parser.process_loaded_payslip = async () => structuredClone(current);
});
after(async () => {
  parser.readPDF = original.read;
  parser.process_loaded_payslip = original.parse;
  if (pool) await pool.end();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
const run = (name, fn) => test(name, { skip: !enabled }, fn);
const ingest = (key, content, etag) =>
  imports.ingest(owner, {
    kind: "nextcloud",
    key,
    filename: key,
    etag,
    buffer: Buffer.from("%PDF-1.4 " + content),
  });
run(
  "transactional imports deduplicate renames, replace versions, preserve identity and rollback failures",
  async () => {
    const first = await ingest("first.pdf", "one", "one");
    assert.equal(first.status, "saved");
    const renamed = await ingest("renamed.pdf", "one", "one");
    assert.equal(renamed.status, "duplicate");
    assert.equal(
      (await pool.query("SELECT count(*) FROM payslips")).rows[0].count,
      "1",
    );
    current = payslip({
      net_pay: "2900.00",
      total_deductions: "1100.00",
      deduction_lines: { PAYE: "700.00", Pension: "400.00" },
      this_period_summary: {
        total_payments: "4000.00",
        total_deductions: "1100.00",
        net_pay: "2900.00",
      },
    });
    assert.equal((await ingest("first.pdf", "two", "two")).status, "saved");
    assert.equal(
      (await pool.query("SELECT count(*) FROM payslip_versions")).rows[0].count,
      "2",
    );
    assert.equal(
      (await pool.query("SELECT net_pay FROM payslips")).rows[0].net_pay,
      "2900.00",
    );
    current = payslip({
      demographics: { name: "OTHER", assignment_no: "999" },
    });
    const changed = await ingest("first.pdf", "three", "three");
    assert.equal(changed.status, "review");
    assert.equal(
      (await pool.query("SELECT net_pay FROM payslips")).rows[0].net_pay,
      "2900.00",
    );
    await pool.query(
      "CREATE FUNCTION reject_save() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fixture rejection'; END $$ LANGUAGE plpgsql; CREATE TRIGGER reject_save BEFORE UPDATE ON payslips FOR EACH ROW EXECUTE FUNCTION reject_save()",
    );
    current = payslip();
    await assert.rejects(
      ingest("first.pdf", "four", "four"),
      /fixture rejection/,
    );
    assert.equal(
      (await pool.query("SELECT count(*) FROM payslip_versions")).rows[0].count,
      "2",
    );
    await pool.query("DROP TRIGGER reject_save ON payslips");
    const pending = (
      await pool.query("SELECT id FROM import_attempts WHERE etag='four'")
    ).rows[0];
    assert.equal((await imports.process(owner, pending.id)).status, "saved");
    await assert.rejects(
      imports.process({ id: 2, username: "other" }, changed.id),
      /not found/,
    );
    await assert.rejects(imports.store(Buffer.from("not pdf")));
    assert.throws(() => imports.file("../../.env"));
  },
);
run(
  "concurrent identical imports save once; invalid drafts remain reviewable",
  async () => {
    current = payslip({ pay_date: "2026-09-24" });
    const result = await Promise.all([
      ingest("parallel-a.pdf", "parallel", "parallel"),
      ingest("parallel-b.pdf", "parallel", "parallel"),
    ]);
    assert.deepEqual(result.map((r) => r.status).sort(), [
      "duplicate",
      "saved",
    ]);
    current = payslip({ pay_lines: [] });
    const r = await ingest("invalid.pdf", "invalid", "invalid");
    assert.equal(r.status, "review");
    assert.ok(r.errors.some((e) => e.field === "pay_lines"));
  },
);
run("HTTP sessions, owner access, CSRF, filters and exports", async () => {
  const { createApp } = require("../server");
  const app = createApp(pool, {
    OWNER_ID: "1",
    SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
    STORAGE_ROOT: root,
    TEMP_ROOT: root,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  let cookie = "";
  async function request(route, options = {}) {
    const r = await fetch(base + route, {
      redirect: "manual",
      ...options,
      headers: { Cookie: cookie, ...options.headers },
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return r;
  }
  try {
    let r = await request("/api/payslips");
    assert.equal(r.status, 401);
    r = await request("/login");
    const html = await r.text();
    const csrf = html.match(/name="_csrf" value="([^"]+)"/)[1];
    r = await request("/login", {
      method: "POST",
      body: new URLSearchParams({
        username: "sample",
        password: "test-password",
      }),
    });
    assert.equal(r.status, 403);
    r = await request("/login", {
      method: "POST",
      body: new URLSearchParams({
        _csrf: csrf,
        username: "other",
        password: "test-password",
      }),
    });
    assert.equal(r.status, 302);
    assert.match(r.headers.get("location"), /failed/);
    r = await request("/login", {
      method: "POST",
      body: new URLSearchParams({
        _csrf: csrf,
        username: "sample",
        password: "test-password",
      }),
    });
    assert.equal(r.headers.get("location"), "/dashboard");
    for (const url of [
      "/dashboard",
      "/payslip_table",
      "/imports",
      "/upload",
      "/view_payslip?payslip_id=1",
    ]) {
      r = await request(url);
      assert.equal(r.status, 200, url);
      assert.ok((await r.text()).includes("paybook"));
    }
    const all = await (await request("/api/payslips?year=all")).json();
    assert.ok(all.length);
    assert.ok(all.every((p) => p.categories));
    const unknown = await (
      await request("/api/payslips?year=all&grade=Unknown")
    ).json();
    assert.ok(unknown.every((p) => p.categories.grade === null));
    const fy1 = await (
      await request("/api/payslips?year=all&grade=FY1")
    ).json();
    assert.ok(fy1.every((p) => p.categories.grade === "FY1"));
    assert.equal((await request("/api/payslips?grade=CT3")).status, 400);
    assert.equal(
      (await request("/api/payslips?location=arbitrary")).status,
      400,
    );
    const filteredExport = await (
      await request("/api/payslips/export/json?year=all&grade=FY1")
    ).json();
    assert.deepEqual(filteredExport, fy1);
    const uploadForm = new FormData();
    uploadForm.set(
      "uploadedFile",
      new Blob(["%PDF-1.4 test"], { type: "application/pdf" }),
      "no-token.pdf",
    );
    assert.equal(
      (await request("/upload", { method: "POST", body: uploadForm })).status,
      403,
    );
    assert.equal((await request("/register")).status, 404);
    assert.equal(
      (await request("/payslips/sample/processed/first.pdf")).status,
      404,
    );
    assert.equal(
      (await request("/api/payslips?yearType=tax&year=bad")).status,
      400,
    );
    assert.equal(
      (await request("/api/payslips/export/json?yearType=tax&year=2026"))
        .status,
      200,
    );
    r = await request("/api/payslips/export/excel?yearType=tax&year=2026");
    assert.equal(r.status, 200);
    assert.equal(
      Buffer.from(await r.arrayBuffer())
        .subarray(0, 2)
        .toString(),
      "PK",
    );
    assert.ok(
      (await pool.query("SELECT count(*) FROM app_sessions")).rows[0].count > 0,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

run(
  "sync recovers queued work, skips unchanged failures, preserves remote deletions and serializes scans",
  async () => {
    const { sync } = require("../lib/nextcloud");
    let downloads = 0;
    current = payslip({ pay_date: "2026-08-24" });
    let items = [{ href: "/sync/a.pdf", filename: "a.pdf", etag: "sync-one" }];
    const client = {
      files: async () => items,
      download: async () => {
        downloads++;
        return Buffer.from("%PDF-1.4 sync " + items[0].etag);
      },
    };
    assert.equal((await sync(pool, imports, owner, client)).success, true);
    const before = (await pool.query("SELECT count(*) FROM payslips")).rows[0]
      .count;
    await sync(pool, imports, owner, client);
    assert.equal(downloads, 1);
    current = payslip({ pay_lines: [] });
    items[0].etag = "sync-invalid";
    await sync(pool, imports, owner, client);
    await sync(pool, imports, owner, client);
    assert.equal(downloads, 2);
    current = payslip({ pay_date: "2026-08-24" });
    items[0].etag = "sync-one";
    await sync(pool, imports, owner, client);
    assert.equal(downloads, 3);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM import_attempts WHERE etag='sync-one'",
        )
      ).rows[0].count,
      "2",
    );
    items = [];
    await sync(pool, imports, owner, client);
    assert.equal(
      (await pool.query("SELECT count(*) FROM payslips")).rows[0].count,
      before,
    );
    current = payslip({ pay_date: "2026-06-24" });
    const object = await imports.store(Buffer.from("%PDF-1.4 queued recovery"));
    const source = (
      await pool.query(
        "INSERT INTO import_sources(owner_id,kind,source_key,filename) VALUES(1,'manual','queued.pdf','queued.pdf') RETURNING id",
      )
    ).rows[0];
    const queued = (
      await pool.query(
        "INSERT INTO import_attempts(source_id,etag,storage_name,raw_hash) VALUES($1,'queued',$2,$3) RETURNING id",
        [source.id, object.storage, object.hash],
      )
    ).rows[0];
    await sync(pool, imports, owner, client);
    assert.equal(
      (
        await pool.query("SELECT status FROM import_attempts WHERE id=$1", [
          queued.id,
        ])
      ).rows[0].status,
      "saved",
    );
    const lock = await pool.connect();
    await lock.query("SELECT pg_advisory_lock(78512342)");
    try {
      assert.equal((await sync(pool, imports, owner, client)).busy, true);
    } finally {
      await lock.query("SELECT pg_advisory_unlock(78512342)");
      lock.release();
    }
    items = [
      { href: "/sync/failure.pdf", filename: "failure.pdf", etag: "failing" },
    ];
    client.download = async () => {
      downloads++;
      throw new Error("timeout");
    };
    await sync(pool, imports, owner, client);
    const failed = (
      await pool.query("SELECT * FROM import_attempts WHERE etag='failing'")
    ).rows[0];
    assert.equal(failed.status, "failed");
    assert.ok(failed.next_retry);
    const n = downloads;
    await sync(pool, imports, owner, client);
    assert.equal(downloads, n);
    await assert.rejects(
      sync(pool, imports, owner, {
        files: async () => {
          throw new Error("401");
        },
      }),
    );
    assert.ok(
      (await pool.query("SELECT error FROM sync_state WHERE id=1")).rows[0]
        .error,
    );
  },
);
run(
  "saved tax repair preserves versions, money and dates and is repeatable",
  async () => {
    const { repairSavedTax } = require("../lib/repair-tax");
    const isolatedOwner = { id: 99, username: "tax-repair" };
    await pool.query("INSERT INTO users(id,username) VALUES(99,'tax-repair')");
    current = payslip({
      tax: {
        ni_number: "AA123456A",
        tax_reference: "567/S50050",
        tax_code: "T CUMUL",
      },
    });
    const a = await imports.ingest(isolatedOwner, {
      kind: "upload",
      key: "tax",
      filename: "tax.pdf",
      buffer: Buffer.from("%PDF-1.4 tax-repair"),
    });
    const before = (
      await pool.query("SELECT * FROM payslips WHERE username='tax-repair'")
    ).rows[0];
    current.tax.tax_reference = "567/S5005";
    current.tax.tax_code = "0T CUMUL";
    const repaired = await repairSavedTax(pool, imports, isolatedOwner);
    assert.deepEqual(repaired, [before.id]);
    const after = (
      await pool.query("SELECT * FROM payslips WHERE id=$1", [before.id])
    ).rows[0];
    for (const key of [
      "pay_date",
      "net_pay",
      "total_payments",
      "total_deductions",
    ])
      assert.equal(after[key], before[key]);
    assert.equal(after.tax.tax_code, "0T CUMUL");
    const versions = (
      await pool.query(
        "SELECT data FROM payslip_versions WHERE payslip_id=$1 ORDER BY id",
        [before.id],
      )
    ).rows;
    assert.equal(versions.at(-2).data.tax.tax_code, "T CUMUL");
    assert.equal(versions.at(-1).data.tax.tax_code, "0T CUMUL");
    assert.deepEqual(await repairSavedTax(pool, imports, isolatedOwner), []);
    assert.equal(
      (
        await pool.query("SELECT draft FROM import_attempts WHERE id=$1", [
          a.id,
        ])
      ).rows[0].draft.tax.tax_code,
      "0T CUMUL",
    );
  },
);
