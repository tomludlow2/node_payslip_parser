const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Nextcloud } = require("../lib/nextcloud");
const config = {
  url: "https://cloud.example",
  username: "sample",
  password: "secret",
  folder: "Payslips",
};
const root = "/remote.php/dav/files/sample/Payslips/";
const xml = (items) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${items.map((i) => `<d:response><d:href>${root}${i.name}</d:href><d:propstat><d:prop><d:resourcetype>${i.dir ? "<d:collection/>" : ""}</d:resourcetype><d:getetag>&quot;one&quot;</d:getetag><d:getcontentlength>12</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join("")}</d:multistatus>`;
test("recursive WebDAV listings parse namespaces and ignore non-PDFs", async () => {
  const urls = [];
  const nc = new Nextcloud(config, async (url, options) => {
    urls.push(url.pathname);
    assert.equal(options.headers.Depth, "1");
    assert.match(options.headers.Authorization, /^Basic /);
    return new Response(
      xml(
        url.pathname.endsWith("/nested/")
          ? [{ name: "nested/b.pdf" }]
          : [
              { name: "", dir: true },
              { name: "nested/", dir: true },
              { name: "a.pdf" },
              { name: "notes.txt" },
            ],
      ),
    );
  });
  const files = await nc.files();
  assert.equal(files.length, 2);
  assert.equal(urls.length, 2);
  assert.equal(files[0].etag, '"one"');
});
test("XML entity declarations and paths outside root are rejected", async () => {
  for (const body of [
    '<!DOCTYPE test [<!ENTITY x SYSTEM "file:///etc/passwd">]><d/>',
    xml([{ name: "../bad.pdf" }]),
  ])
    await assert.rejects(
      new Nextcloud(config, async () => new Response(body)).files(),
    );
  assert.throws(
    () => new Nextcloud({ ...config, url: "http://cloud.example" }),
  );
  assert.throws(() => new Nextcloud({ ...config, folder: "../private" }));
});
test("authentication, changing ETags and bounded downloads fail safely", async () => {
  const item = { href: root + "a.pdf", etag: '"one"', size: 12 };
  await assert.rejects(
    new Nextcloud(
      config,
      async () => new Response("", { status: 401 }),
    ).files(),
    /401/,
  );
  await assert.rejects(
    new Nextcloud(
      config,
      async () => new Response("pdf", { headers: { etag: '"two"' } }),
    ).download(item),
    /changed/,
  );
  await assert.rejects(
    new Nextcloud(
      config,
      async () =>
        new Response("pdf", {
          headers: {
            etag: '"one"',
            "content-length": String(30 * 1024 * 1024),
          },
        }),
    ).download(item),
    /size limit/,
  );
  await assert.rejects(
    new Nextcloud(config, async () => {
      throw new Error("timeout");
    }).files(),
    /timeout/,
  );
});
test("stable PDF verifies ETag again after download", async () => {
  const methods = [];
  const nc = new Nextcloud(config, async (url, o) => {
    methods.push(o.method);
    return new Response(o.method === "HEAD" ? null : "%PDF-fixture", {
      headers: { etag: '"one"' },
    });
  });
  assert.equal(
    (
      await nc.download({ href: root + "a.pdf", etag: '"one"', size: 12 })
    ).toString(),
    "%PDF-fixture",
  );
  assert.deepEqual(methods, ["GET", "HEAD"]);
});
