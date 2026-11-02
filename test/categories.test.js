const { test } = require("node:test");
const assert = require("node:assert/strict");
const c = require("../lib/categories");
const slip = (job, location = "Royal Preston Hospital") => ({
  job,
  demographics: { location },
});
test("requested grades map from explicit evidence; CT3 remains unresolved", () => {
  assert.equal(
    c.categorise(slip({ job_title: "Foundation Doctor Year 1" })).grade,
    "FY1",
  );
  assert.equal(
    c.categorise(
      slip({
        job_title: "ACCS - Anaesthetics",
        payscale_descriptor: "Specialty Registrar CT 2",
      }),
    ).grade,
    "CT2",
  );
  assert.equal(
    c.categorise(slip({ job_title: "Specialty Registrar CT 3" })).grade,
    null,
  );
  assert.equal(
    c.categorise(slip({ job_title: "Specialty Registrar ST4/SpR4" })).grade,
    "ST4",
  );
  assert.equal(
    c.categorise(slip({ job_title: "ST4", payscale_descriptor: "ST5" })).grade,
    null,
  );
});
test("locum grade and agency/bank subtype stay distinct from printed training grade", () => {
  assert.equal(
    c.categorise(slip({ job_title: "Bank - Specialty Registrar (ST4)" })).grade,
    "Locum",
  );
  assert.equal(
    c.categorise(slip({ job_title: "Bank - Specialty Registrar (ST4)" }))
      .locum_type,
    "Bank Locum",
  );
  assert.equal(
    c.categorise(
      slip({
        job_title: "Holt Agency Drs - AdHoc - Locum Independent Contractor",
      }),
    ).locum_type,
    "Agency Locum",
  );
  assert.equal(
    c.categorise(slip({ job_title: "Locum Doctor" })).locum_type,
    null,
  );
});
test("sites map to the requested organisation labels without guessing placeholders", () => {
  assert.equal(
    c.categorise(slip({}, "Bassetlaw Hospital")).location,
    "Doncaster and Bassetlaw NHSFT",
  );
  assert.equal(
    c.categorise(slip({}, "Default Employee Home Address")).location,
    null,
  );
  assert.equal(
    c.categorise(slip({}, "Fairfield Hospital")).location,
    "Fairfield Hospital",
  );
});
test("display corrections and confirmed overrides retain original source fields", () => {
  const p = slip({
    job_title: "Foundation Doctor Year 1",
    department: "Clinical Haemato",
  });
  assert.equal(c.categorise(p).department, "Clinical Haematology");
  const key = c.sourceKey(p);
  const result = c.categorise(p, {
    [key]: {
      grade: "Locum",
      locum_type: "Bank Locum",
      location: "Aintree NHSFT",
    },
  });
  assert.equal(result.grade, "Locum");
  assert.equal(p.job.department, "Clinical Haemato");
  assert.throws(() =>
    c.validateOverride({ grade: "CT3", location: c.LOCATIONS[0] }),
  );
  assert.throws(() =>
    c.validateOverride({
      grade: "FY1",
      location: c.LOCATIONS[0],
      locum_type: "Agency Locum",
    }),
  );
});
