require("./lib/pg-types");
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const passportModule = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs/promises");
const fileUpload = require("express-fileupload");
const PgStore = require("./lib/session-store");
const { Imports, MAX_BYTES } = require("./lib/imports");
const { yearRange } = require("./lib/validation");
const categories = require("./lib/categories");
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
function createApp(pool, config = process.env) {
  const ownerId = Number(config.OWNER_ID);
  if (!Number.isSafeInteger(ownerId) || ownerId < 1)
    throw new Error("OWNER_ID must identify an existing owner");
  if (!config.SESSION_SECRET || config.SESSION_SECRET.length < 32)
    throw new Error("SESSION_SECRET must have at least 32 characters");
  const app = express(),
    passport = new passportModule.Passport(),
    imports = new Imports(pool, config.STORAGE_ROOT);
  const production = config.NODE_ENV === "production";
  const google = Boolean(
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET,
  );
  const nextcloud = Boolean(
    config.NEXTCLOUD_URL &&
    config.NEXTCLOUD_USERNAME &&
    config.NEXTCLOUD_APP_PASSWORD &&
    config.NEXTCLOUD_FOLDER,
  );
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY || false);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use((req, res, next) => {
    Object.assign(res.locals, {
      csrf: "",
      user: null,
      google: false,
      nextcloud: false,
      current: req.path,
      notice: null,
    });
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    });
    if (!req.path.startsWith("/assets/")) res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/assets", express.static(path.join(__dirname, "public")));
  app.use(express.urlencoded({ extended: false, limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));
  app.use(
    session({
      store: new PgStore(pool),
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        maxAge: 86400000,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const u = (
          await pool.query("SELECT * FROM users WHERE id=$1 AND username=$2", [
            ownerId,
            username,
          ])
        ).rows[0];
        if (!u?.password || !(await bcrypt.compare(password, u.password)))
          return done(null, false);
        done(null, u);
      } catch (e) {
        done(e);
      }
    }),
  );
  if (google)
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET,
          callbackURL:
            config.GOOGLE_CALLBACK_URL ||
            "https://pay.tomoutlaw.co.uk/auth/google/callback",
          state: true,
        },
        async (token, refresh, profile, done) => {
          try {
            const u = (
              await pool.query(
                "SELECT * FROM users WHERE id=$1 AND provider='google' AND provider_id=$2",
                [ownerId, profile.id],
              )
            ).rows[0];
            done(null, u || false);
          } catch (e) {
            done(e);
          }
        },
      ),
    );
  passport.serializeUser((u, done) => done(null, u.id));
  passport.deserializeUser(async (id, done) => {
    try {
      if (Number(id) !== ownerId) return done(null, false);
      done(
        null,
        (await pool.query("SELECT * FROM users WHERE id=$1", [ownerId]))
          .rows[0] || false,
      );
    } catch (e) {
      done(e);
    }
  });
  app.use((req, res, next) => {
    req.session.csrf ||= crypto.randomBytes(32).toString("hex");
    res.locals.csrf = req.session.csrf;
    res.locals.user = req.user;
    res.locals.google = google;
    res.locals.nextcloud = nextcloud;
    res.locals.current = req.path;
    res.locals.notice = req.session.notice;
    delete req.session.notice;
    res.locals.gbp = (n) =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format(Number(n || 0));
    res.locals.date = (d) =>
      d ? new Date(d).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "—";
    next();
  });
  const csrf = (req, res, next) => {
    const token = req.get("x-csrf-token") || req.body?._csrf;
    if (
      typeof token !== "string" ||
      Buffer.byteLength(token) !== Buffer.byteLength(req.session.csrf) ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))
    )
      return res
        .status(403)
        .send("Invalid form token. Reload the page and try again.");
    next();
  };
  app.use((req, res, next) =>
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    (req.method === "POST" && req.path === "/upload")
      ? next()
      : csrf(req, res, next),
  );
  const auth = (req, res, next) =>
    req.isAuthenticated() && Number(req.user.id) === ownerId
      ? next()
      : req.path.startsWith("/api/")
        ? res.status(401).json({ error: "Sign in required" })
        : res.redirect("/login");
  const rates = new Map();
  app.post(
    "/login",
    (req, res, next) => {
      const key = req.ip,
        now = Date.now();
      for (const [k, v] of rates) if (v.until < now) rates.delete(k);
      const item = rates.get(key) || { count: 0, until: now + 900000 };
      item.count++;
      rates.set(key, item);
      if (item.count > 10)
        return res
          .status(429)
          .send("Too many sign-in attempts. Try again in 15 minutes.");
      next();
    },
    passport.authenticate("local", { failureRedirect: "/login?failed=1" }),
    (req, res) => res.redirect("/dashboard"),
  );
  app.get("/login", (req, res) =>
    res.render("signin", { title: "Welcome back", failed: !!req.query.failed }),
  );
  app.get("/", (req, res) =>
    res.redirect(req.isAuthenticated() ? "/dashboard" : "/login"),
  );
  app.post("/logout", auth, (req, res, next) =>
    req.logout((e) => {
      if (e) return next(e);
      req.session.destroy((e) => (e ? next(e) : res.redirect("/login")));
    }),
  );
  if (google) {
    app.get(
      "/auth/google",
      passport.authenticate("google", { scope: ["profile", "email"] }),
    );
    app.get(
      "/auth/google/callback",
      passport.authenticate("google", { failureRedirect: "/login?failed=1" }),
      (req, res) => res.redirect("/dashboard"),
    );
  }
  for (const route of [
    "/register",
    "/view_users",
    "/update_user_category",
    "/delete_user",
    "/change_password",
  ])
    app.all(route, (req, res) => res.sendStatus(404));
  async function rows(req) {
    const type = req.query.yearType || "tax";
    const now = new Date();
    const defaultYear =
      now.getUTCFullYear() - (now.toISOString().slice(5, 10) < "04-06" ? 1 : 0);
    const year = req.query.year || defaultYear;
    let range;
    try {
      if (!["tax", "academic"].includes(type))
        throw new Error("Invalid year type");
      range = year === "all" ? null : yearRange(type, year);
    } catch (e) {
      e.status = 400;
      throw e;
    }
    const grade = req.query.grade || "";
    const location = req.query.location || "";
    const locumType = req.query.locumType || "";
    for (const [value, choices] of [
      [grade, categories.GRADES],
      [location, categories.LOCATIONS],
      [locumType, categories.LOCUM_TYPES],
    ]) {
      if (value && value !== "Unknown" && !choices.includes(value)) {
        const e = new Error("Invalid category filter");
        e.status = 400;
        throw e;
      }
    }
    const overrides = categories.loadOverrides();
    const data = (
      await pool.query(
        "SELECT * FROM payslips WHERE username=$1" +
          (range ? " AND pay_date >= $2 AND pay_date < $3" : "") +
          " ORDER BY pay_date DESC,id DESC",
        [req.user.username, ...(range || [])],
      )
    ).rows
      .map((p) => ({ ...p, categories: categories.categorise(p, overrides) }))
      .filter(
        (p) =>
          (!grade || (p.categories.grade || "Unknown") === grade) &&
          (!location || (p.categories.location || "Unknown") === location) &&
          (!locumType ||
            (locumType === "Unknown"
              ? p.categories.grade === "Locum" && !p.categories.locum_type
              : p.categories.locum_type === locumType)),
      );
    return {
      data,
      type,
      year,
      grade,
      location,
      locumType,
      gradeOptions: categories.GRADES,
      locationOptions: categories.LOCATIONS,
      locumOptions: categories.LOCUM_TYPES,
    };
  }
  app.get(
    "/dashboard",
    auth,
    wrap(async (req, res) => {
      const list = await rows(req);
      const latest = (
        await pool.query(
          "SELECT * FROM payslips WHERE username=$1 ORDER BY pay_date DESC,id DESC LIMIT 1",
          [req.user.username],
        )
      ).rows[0];
      const count = (
        await pool.query(
          "SELECT count(*) FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE s.owner_id=$1 AND a.status IN ('review','failed')",
          [ownerId],
        )
      ).rows[0].count;
      const state = (await pool.query("SELECT * FROM sync_state WHERE id=1"))
        .rows[0];
      res.render("home", {
        title: "Your pay, clearly.",
        ...list,
        latest,
        count,
        state,
      });
    }),
  );
  app.get(
    "/payslip_table",
    auth,
    wrap(async (req, res) =>
      res.render("library", { title: "Payslip library", ...(await rows(req)) }),
    ),
  );
  app.get(
    "/api/payslips",
    auth,
    wrap(async (req, res) => res.json((await rows(req)).data)),
  );
  app.get(
    "/api/payslips/export/:format",
    auth,
    wrap(async (req, res) => {
      const data = (await rows(req)).data;
      if (req.params.format === "json")
        return res.attachment("payslips.json").json(data);
      if (req.params.format !== "excel") return res.sendStatus(404);
      const Excel = require("exceljs");
      const workbook = new Excel.Workbook();
      const sheet = workbook.addWorksheet("Payslips");
      sheet.columns = [
        "pay_date",
        "total_payments",
        "total_deductions",
        "net_pay",
        "grade",
        "location",
        "locum_type",
        "department",
        "job_title",
        "payscale_descriptor",
      ].map((k) => ({ header: k.replace(/_/g, " "), key: k, width: 22 }));
      data.forEach((p) =>
        sheet.addRow({
          ...p,
          ...p.categories,
          pay_date: new Date(p.pay_date).toISOString().slice(0, 10),
          total_payments: Number(p.total_payments),
          total_deductions: Number(p.total_deductions),
          net_pay: Number(p.net_pay),
        }),
      );
      res
        .attachment("payslips.xlsx")
        .send(Buffer.from(await workbook.xlsx.writeBuffer()));
    }),
  );
  app.get("/upload", auth, (req, res) =>
    res.render("intake", { title: "Import payslips" }),
  );
  app.post(
    "/upload",
    auth,
    fileUpload({
      limits: { fileSize: MAX_BYTES, files: 1 },
      abortOnLimit: true,
      useTempFiles: true,
      tempFileDir: config.TEMP_ROOT || path.join(__dirname, "tempFileDir"),
      safeFileNames: true,
      preserveExtension: 4,
    }),
    (req, res, next) => {
      // Multipart form tokens become available only after bounded upload parsing.
      const files = Object.values(req.files || {}).flat();
      res.on("finish", () => {
        for (const file of files)
          if (file.tempFilePath) fs.unlink(file.tempFilePath).catch(() => {});
      });
      csrf(req, res, next);
    },
    wrap(async (req, res) => {
      const file = req.files?.uploadedFile;
      if (!file || Array.isArray(file)) {
        res.status(400);
        return res.render("error", {
          title: "Choose one PDF",
          message: "Select one PDF of at most 20 MB.",
        });
      }
      try {
        const buffer = await fs.readFile(file.tempFilePath);
        const result = await imports.ingest(req.user, {
          kind: "manual",
          key: file.name,
          filename: file.name,
          buffer,
        });
        req.session.notice =
          result.status === "review"
            ? "This payslip needs your review."
            : "Payslip imported successfully.";
        res.redirect("/imports/" + result.id);
      } finally {
        await fs.unlink(file.tempFilePath).catch(() => {});
      }
    }),
  );
  app.get(
    "/imports",
    auth,
    wrap(async (req, res) => {
      const data = (
        await pool.query(
          "SELECT a.*,s.filename,s.kind FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE s.owner_id=$1 ORDER BY a.created_at DESC LIMIT 200",
          [ownerId],
        )
      ).rows;
      const state = (await pool.query("SELECT * FROM sync_state WHERE id=1"))
        .rows[0];
      res.render("imports", { title: "Imports & sync", data, state });
    }),
  );
  async function attempt(req) {
    const a = (
      await pool.query(
        "SELECT a.*,s.filename,s.payslip_id FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE a.id=$1 AND s.owner_id=$2",
        [req.params.id, ownerId],
      )
    ).rows[0];
    if (!a) {
      const e = new Error("Import not found");
      e.status = 404;
      throw e;
    }
    return a;
  }
  app.get(
    "/imports/:id",
    auth,
    wrap(async (req, res) => {
      const a = await attempt(req);
      const previous = a.payslip_id
        ? (
            await pool.query(
              "SELECT * FROM payslips WHERE id=$1 AND username=$2",
              [a.payslip_id, req.user.username],
            )
          ).rows[0]
        : null;
      const candidates =
        !previous && a.draft?.pay_date
          ? (
              await pool.query(
                "SELECT * FROM payslips WHERE username=$1 AND pay_date=$2 AND demographics->>'assignment_no'=$3",
                [
                  req.user.username,
                  a.draft.pay_date,
                  String(a.draft.demographics?.assignment_no),
                ],
              )
            ).rows
          : [];
      // A failed extraction still has a validated manual-entry path.
      if (!a.draft && a.storage_name && a.status === "review")
        a.draft = {
          filename: a.filename,
          demographics: { name: "", assignment_no: "", location: "" },
          job: { job_title: "", department: "" },
          wage: { salary: null, employment_type: "salaried" },
          tax: { ni_number: "", tax_code: "", tax_reference: "" },
          pay_lines: [
            { Description: "", Worked: "", Paid: "", Rate: "", Amount: "" },
          ],
          deduction_lines: { PAYE: "", NI: "", Pension: "" },
          year_to_date: { gross_pay: "", taxable_pay: "", tax_paid: "" },
          this_period_summary: {
            period_taxable_pay: "",
            frequency: "",
            tax_period: "",
            total_payments: "",
            total_deductions: "",
            net_pay: "",
          },
          pay_date: "",
          total_payments: "",
          total_deductions: "",
          net_pay: "",
        };
      res.render("review", {
        title: "Review import",
        a,
        previous: previous || candidates[0],
      });
    }),
  );
  app.post(
    "/imports/:id/review",
    auth,
    wrap(async (req, res) => {
      await attempt(req);
      let draft;
      try {
        draft = JSON.parse(req.body.draft);
      } catch {
        const e = new Error("The edited data is not valid JSON");
        e.status = 400;
        throw e;
      }
      await imports.process(
        req.user,
        req.params.id,
        draft,
        req.body.confirm === "yes",
      );
      res.redirect("/imports/" + req.params.id);
    }),
  );
  app.post(
    "/imports/:id/retry",
    auth,
    wrap(async (req, res) => {
      const a = await attempt(req);
      if (["saved", "duplicate"].includes(a.status))
        return res.redirect("/imports/" + a.id);
      if (a.storage_name) await imports.process(req.user, a.id);
      else {
        await pool.query(
          "UPDATE import_attempts SET status='failed',next_retry=now() WHERE id=$1",
          [a.id],
        );
        await pool.query("UPDATE sync_state SET requested=true WHERE id=1");
      }
      res.redirect("/imports/" + a.id);
    }),
  );
  app.get(
    "/api/imports",
    auth,
    wrap(async (req, res) =>
      res.json(
        (
          await pool.query(
            "SELECT a.id,a.status,a.errors,a.updated_at,s.filename FROM import_attempts a JOIN import_sources s ON s.id=a.source_id WHERE s.owner_id=$1 ORDER BY a.created_at DESC LIMIT 200",
            [ownerId],
          )
        ).rows,
      ),
    ),
  );
  let syncRunning = false;
  app.post(
    "/api/imports/sync",
    auth,
    wrap(async (req, res) => {
      if (!nextcloud)
        return res.status(409).json({ error: "Nextcloud is not configured" });
      await pool.query("UPDATE sync_state SET requested=true WHERE id=1");
      if (!syncRunning) {
        syncRunning = true;
        const { Nextcloud, sync } = require("./lib/nextcloud");
        Promise.resolve()
          .then(() =>
            sync(
              pool,
              imports,
              req.user,
              new Nextcloud({
                url: config.NEXTCLOUD_URL,
                username: config.NEXTCLOUD_USERNAME,
                password: config.NEXTCLOUD_APP_PASSWORD,
                folder: config.NEXTCLOUD_FOLDER,
              }),
            ),
          )
          .catch(() => {})
          .finally(() => {
            syncRunning = false;
          });
      }
      res.status(202).json({ status: "queued" });
    }),
  );
  app.get(
    "/imports/:id/document",
    auth,
    wrap(async (req, res) => {
      const a = await attempt(req);
      if (!a.storage_name) return res.sendStatus(404);
      res.type("pdf").sendFile(imports.file(a.storage_name));
    }),
  );
  app.get(
    "/view_payslip",
    auth,
    wrap(async (req, res) => {
      const p = (
        await pool.query("SELECT * FROM payslips WHERE id=$1 AND username=$2", [
          req.query.payslip_id,
          req.user.username,
        ])
      ).rows[0];
      if (!p) return res.sendStatus(404);
      const versions = (
        await pool.query(
          "SELECT * FROM payslip_versions WHERE payslip_id=$1 ORDER BY created_at DESC,id DESC",
          [p.id],
        )
      ).rows;
      res.render("detail", {
        title: "Payslip detail",
        p: {
          ...p,
          categories: categories.categorise(p, categories.loadOverrides()),
        },
        versions,
      });
    }),
  );
  app.get(
    "/documents/:id",
    auth,
    wrap(async (req, res) => {
      const p = (
        await pool.query("SELECT * FROM payslips WHERE id=$1 AND username=$2", [
          req.params.id,
          req.user.username,
        ])
      ).rows[0];
      if (!p) return res.sendStatus(404);
      if (p.raw_hash)
        return res.type("pdf").sendFile(imports.file(p.raw_hash + ".pdf"));
      if (
        path.basename(p.filename) !== p.filename ||
        path.basename(req.user.username) !== req.user.username
      )
        return res.sendStatus(404);
      res
        .type("pdf")
        .sendFile(
          path.join(
            __dirname,
            "payslips",
            req.user.username,
            "processed",
            p.filename,
          ),
        );
    }),
  );
  app.get(
    "/versions/:id/document",
    auth,
    wrap(async (req, res) => {
      const v = (
        await pool.query(
          "SELECT v.* FROM payslip_versions v JOIN payslips p ON p.id=v.payslip_id WHERE v.id=$1 AND p.username=$2",
          [req.params.id, req.user.username],
        )
      ).rows[0];
      if (!v?.storage_name) return res.sendStatus(404);
      res.type("pdf").sendFile(imports.file(v.storage_name));
    }),
  );
  app.get("/view_pending_payslips", auth, (req, res) =>
    res.redirect("/imports"),
  );
  app.use((req, res) =>
    res.status(404).render("error", {
      title: "Page not found",
      message:
        "This page is no longer available. Use the navigation to continue.",
    }),
  );
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    if (req.path.startsWith("/api/"))
      return res.status(status).json({
        error: status < 500 ? err.message : "Request failed. Please retry.",
      });
    res.status(status).render("error", {
      title: status < 500 ? "Check your request" : "Something went wrong",
      message:
        status < 500
          ? err.message
          : "The request could not be completed. Your saved payslips are unchanged. Please retry.",
    });
  });
  return app;
}
if (require.main === module) {
  const pool = require("./database");
  const app = createApp(pool);
  app.listen(
    Number(process.env.PORT || 52535),
    process.env.HOST || "127.0.0.1",
    () => console.log("Payslip app listening"),
  );
}
module.exports = { createApp };
