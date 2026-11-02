const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const GRADES = [
  "FY1",
  "FY2",
  "CT1",
  "CT2",
  "ST3",
  "ST4",
  "ST5",
  "ST6",
  "Locum",
];
const LOCATIONS = [
  "Aintree NHSFT",
  "Lancashire Teaching Hospitals NHSFT",
  "Royal Bolton NHSFT",
  "Harrogate and District NHSFT",
  "Fairfield Hospital",
  "Doncaster and Bassetlaw NHSFT",
  "Calderdale and Huddersfield NHSFT",
  "Bradford Teaching Hospitals NHSFT",
  "Leeds Teaching Hospitals NHSFT",
  "Mid Yorks NHSFT",
];
const LOCUM_TYPES = ["Agency Locum", "Bank Locum"];
const file = path.join(__dirname, "../private/category-overrides.json");
function sourceKey(p) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        p.demographics?.location || "",
        p.job?.job_title || "",
        p.job?.department || "",
        p.job?.payscale_descriptor || "",
        p.wage?.employment_type || "",
      ]),
    )
    .digest("hex");
}
function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}
function tidy(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bClinical Haemato\b/gi, "Clinical Haematology")
    .replace(/\bThoracic Medicin\b/gi, "Thoracic Medicine")
    .replace(/\bEmergency Medici\b/gi, "Emergency Medicine")
    .replace(/\bTemporary Staffi\b/gi, "Temporary Staffing")
    .replace(/\bMed Staff\b/gi, "Medical Staff")
    .replace(/\bLocum Doct\b/gi, "Locum Doctor")
    .replace(/\bUpper Gi\b/g, "Upper GI");
}
function categorise(p, overrides = {}) {
  const raw = [
    p.job?.job_title,
    p.job?.department,
    p.job?.payscale_descriptor,
  ].join(" ");
  const isLocum =
    p.wage?.employment_type === "ad_hoc" ||
    /\b(bank|locum|ad[ -]?hoc|temporary staffing|Temporary Staffi)\b/i.test(
      raw,
    );
  let grade = null;
  if (isLocum) grade = "Locum";
  else {
    const grades = [
      ...new Set(
        [...raw.matchAll(/\b(?:CT\s*[123]|ST\s*[3-6]|FY\s*[12])\b/gi)].map(
          (m) => m[0].replace(/\s/g, "").toUpperCase(),
        ),
      ),
    ];
    if (/Foundation (?:Doctor )?Year 1/i.test(raw)) grades.push("FY1");
    if (/Foundation (?:Doctor )?Year 2/i.test(raw)) grades.push("FY2");
    const unique = [...new Set(grades)];
    if (unique.length === 1 && GRADES.includes(unique[0])) grade = unique[0];
  }
  let locum_type = null;
  if (isLocum && /\bagency\b/i.test(raw)) locum_type = "Agency Locum";
  else if (isLocum && /\bbank\b/i.test(raw)) locum_type = "Bank Locum";
  const site = String(p.demographics?.location || "");
  const sites = [
    [/Aintree/i, LOCATIONS[0]],
    [/Royal Preston|Lancashire Teach/i, LOCATIONS[1]],
    [/Royal Bolton/i, LOCATIONS[2]],
    [/Harrogate/i, LOCATIONS[3]],
    [/Fairfield/i, LOCATIONS[4]],
    [/Bassetlaw|Doncaster/i, LOCATIONS[5]],
    [/Huddersfield|Calderdale/i, LOCATIONS[6]],
    [/Bradford/i, LOCATIONS[7]],
    [/Leeds General|Leeds Teaching/i, LOCATIONS[8]],
    [/Mid York|Pinderfields|Dewsbury|Pontefract/i, LOCATIONS[9]],
  ];
  const location = sites.find(([re]) => re.test(site))?.[1] || null;
  const result = {
    grade,
    location,
    locum_type,
    job_title: tidy(p.job?.job_title),
    department: tidy(p.job?.department),
    payscale_descriptor: tidy(p.job?.payscale_descriptor),
  };
  const override = overrides[sourceKey(p)];
  if (override)
    for (const field of Object.keys(result))
      if (override[field]) result[field] = override[field];
  for (const field of ["job_title", "department", "payscale_descriptor"])
    result[field] = tidy(result[field]);
  result.needs_review =
    !result.grade ||
    !result.location ||
    (result.grade === "Locum" && !result.locum_type) ||
    !result.payscale_descriptor ||
    /^R4$/.test(result.job_title) ||
    /Foundation Doctor|Higher Trainee|Specialty Registrar/.test(
      result.department,
    );
  return result;
}
function validateOverride(row) {
  if (!GRADES.includes(row.grade)) throw new Error("Invalid grade");
  if (!LOCATIONS.includes(row.location)) throw new Error("Invalid location");
  if (row.locum_type && !LOCUM_TYPES.includes(row.locum_type))
    throw new Error("Invalid locum type");
  if (row.locum_type && row.grade !== "Locum")
    throw new Error("Locum type requires Locum grade");
  if (row.grade === "Locum" && !row.locum_type)
    throw new Error("Choose Agency Locum or Bank Locum");
}
module.exports = {
  GRADES,
  LOCATIONS,
  LOCUM_TYPES,
  sourceKey,
  loadOverrides,
  categorise,
  tidy,
  validateOverride,
  file,
};
