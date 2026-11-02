const { chromium } = require("playwright");
const { Pool } = require("pg");
const os = require("os");
const fs = require("fs/promises");
const { createApp } = require("../server");
(async () => {
  if (
    !process.env.TEST_PG_SOCKET?.startsWith(
      require("path").join(os.tmpdir(), "pay-postgres-"),
    )
  )
    throw new Error("Use the disposable test/run-postgres.sh cluster");
  const pool = new Pool({
    host: process.env.TEST_PG_SOCKET,
    port: 55439,
    user: os.userInfo().username,
    database: "postgres",
  });
  const storage = await fs.mkdtemp(
    require("path").join(os.tmpdir(), "pay-browser-objects-"),
  );
  const server = createApp(pool, {
    STORAGE_ROOT: storage,
    TEMP_ROOT: storage,
    OWNER_ID: "1",
    SESSION_SECRET: "browser-secret-long-enough-for-testing",
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://127.0.0.1:" + server.address().port;
  await fs.mkdir("/tmp/pay-browser", { recursive: true });
  try {
    await page.goto(base + "/login");
    await page.getByLabel("Username", { exact: true }).fill("sample");
    await page.getByLabel("Password", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");
    await page.screenshot({
      path: "/tmp/pay-browser/overview-desktop.png",
      fullPage: true,
    });
    await page.getByRole("link", { name: "Payslip library" }).click();
    await page.locator("#search").fill("does-not-exist");
    if (!(await page.locator(".search-empty").isVisible()))
      throw new Error("Search empty state missing");
    await page.locator("#search").fill("");
    await page.screenshot({
      path: "/tmp/pay-browser/library-desktop.png",
      fullPage: true,
    });
    await page.getByRole("link", { name: "Imports & sync" }).click();
    await page.screenshot({
      path: "/tmp/pay-browser/imports-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Upload a payslip", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "/tmp/pay-browser/upload-mobile.png",
      fullPage: true,
    });
    await page.locator("#file-input").setInputFiles({
      name: "bad.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("bad"),
    });
    if (!(await page.locator("#upload-submit").isDisabled()))
      throw new Error("Invalid upload allowed");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    if (await page.locator("#file-input").inputValue())
      throw new Error("Clear failed");
    const text = (
      await fs.readFile(
        require("path").join(__dirname, "fixtures/nhs-esr.txt"),
        "utf8",
      )
    )
      .replace("24 OCT 2026", "24 JUL 2026")
      .replace("NET PAY\n2800.00", "NET PAY\n2700.00");
    await page.locator("#file-input").setInputFiles({
      name: "browser.pdf",
      mimeType: "application/pdf",
      buffer: require("./pdf-fixture").pdf(text),
    });
    await page.getByRole("button", { name: "Upload & process" }).click();
    await page.waitForURL(/\/imports\/\d+$/);
    await page.waitForLoadState();
    if (!(await page.locator("#review-form").count()))
      throw new Error(
        "Upload did not produce a review draft: " +
          (await page.locator(".notice").allTextContents()),
      );
    await page.screenshot({
      path: "/tmp/pay-browser/review-mobile.png",
      fullPage: true,
    });
    const net = page.getByLabel("Net Pay", { exact: true });
    await net.first().fill("2800.00");
    if ((await net.nth(1).inputValue()) !== "2800.00")
      throw new Error("Summary field synchronization failed");
    await Promise.all([
      page.waitForNavigation(),
      page.getByRole("button", { name: "Validate & save" }).click(),
    ]);
    if (!(await page.locator(".badge.saved").isVisible()))
      throw new Error(
        "Reviewed upload was not saved: " +
          (await page.locator(".notice").allTextContents()).join(" "),
      );
    const document = await page.request.get(page.url() + "/document");
    if (
      !document.ok() ||
      !(await document.body()).subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      throw new Error("Original PDF unavailable");
    await page.goto(base + "/dashboard");
    await page.screenshot({
      path: "/tmp/pay-browser/overview-mobile.png",
      fullPage: true,
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    ) {
      console.log(
        await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
            .map((e) => ({
              tag: e.tagName,
              cls: e.className,
              width: e.getBoundingClientRect().width,
            }))
            .slice(0, 20),
        ),
      );
      throw new Error("Mobile horizontal overflow");
    }
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "Browser smoke passed: desktop/mobile overview, library search, imports, upload validation, clear, real PDF extraction, review editing/save, document access, no page errors. Screenshots: /tmp/pay-browser",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await pool.end();
    await fs.rm(storage, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
