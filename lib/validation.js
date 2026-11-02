const crypto = require("crypto");
function pennies(value) {
  const raw = String(value ?? "").trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw))
    throw new Error("Expected a monetary amount");
  const s = raw.replace(/,/g, "");
  const sign = s.startsWith("-") ? -1 : 1;
  const [whole, fraction = ""] = s.replace(/^[+-]/, "").split(".");
  const result = sign * (Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
  if (!Number.isSafeInteger(result) || Math.abs(result) > 999999999999)
    throw new Error("Amount outside supported range");
  return result;
}
function money(value) {
  return (pennies(value) / 100).toFixed(2);
}
function calculatedPennies(paid, rate) {
  function decimal(value) {
    const s = String(value ?? "").trim();
    if (!/^[+-]?\d+(?:\.\d{1,6})?$/.test(s)) return null;
    const places = (s.split(".")[1] || "").length;
    return { n: BigInt(s.replace(".", "")), den: 10n ** BigInt(places) };
  }
  const p = decimal(paid),
    r = decimal(rate);
  if (!p || !r) return null;
  const product = p.n * r.n,
    den = p.den * r.den;
  const result = ((product < 0n ? -product : product) * 100n + den / 2n) / den;
  return Number(product < 0n ? -result : result);
}
function roundingAllowance(paid, rate) {
  // ESR displays hours to 2dp and rates to 4dp; payroll uses more precision.
  // Propagate half a printed unit through the product, plus half a penny.
  const p = Number(paid),
    r = Number(rate);
  const unit = (v, min) =>
    10 ** -Math.max(min, (String(v).split(".")[1] || "").length);
  return Math.max(
    10,
    Math.ceil(
      100 *
        ((Math.abs(r) * unit(paid, 2)) / 2 +
          (Math.abs(p) * unit(rate, 4)) / 2 +
          (unit(paid, 2) * unit(rate, 4)) / 4 +
          0.005),
    ),
  );
}
function taxYear(value) {
  const date = dateOnly(value);
  return Number(date.slice(0, 4)) - (date.slice(5) < "04-06" ? 1 : 0);
}
function dateOnly(value) {
  let s = String(value ?? "").trim();
  const m = s.match(/^(\d{2})[ /-]([A-Za-z]{3}|\d{2})[ /-](\d{4})$/);
  if (m) {
    const month = /^\d+$/.test(m[2])
      ? Number(m[2])
      : [
          "JAN",
          "FEB",
          "MAR",
          "APR",
          "MAY",
          "JUN",
          "JUL",
          "AUG",
          "SEP",
          "OCT",
          "NOV",
          "DEC",
        ].indexOf(m[2].toUpperCase()) + 1;
    s = `${m[3]}-${String(month).padStart(2, "0")}-${m[1]}`;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw new Error("Expected a valid date");
  return s;
}
function validate(input) {
  const data = JSON.parse(JSON.stringify(input || {}));
  const errors = [];
  const error = (field, message) => errors.push({ field, message });
  for (const section of [
    "demographics",
    "job",
    "wage",
    "tax",
    "this_period_summary",
    "year_to_date",
    "deduction_lines",
  ]) {
    if (
      !data[section] ||
      typeof data[section] !== "object" ||
      Array.isArray(data[section])
    )
      error(section, "Missing or invalid section");
  }
  for (const key of ["name", "assignment_no"])
    if (!String(data.demographics?.[key] || "").trim())
      error(`demographics.${key}`, "Required");
  if (!data.job?.job_title) error("job.job_title", "Required");
  if (!data.tax?.ni_number) error("tax.ni_number", "Required");
  // Some historical pay advices print only post-pension YTD pay. Preserve
  // the missing gross balance explicitly rather than inventing one.
  let unreportedYtdGross = false;
  if (
    data.year_to_date?.gross_pay === null &&
    data.this_period_summary?.import_method === "manual_transcription" &&
    data.this_period_summary?.ytd_gross_not_reported === true
  ) {
    try {
      pennies(data.year_to_date.taxable_pay);
      unreportedYtdGross = true;
    } catch {}
  }
  for (const [section, key] of [
    ["year_to_date", "gross_pay"],
    ["year_to_date", "tax_paid"],
  ]) {
    if (key === "gross_pay" && unreportedYtdGross) continue;
    try {
      data[section][key] = money(data[section]?.[key]);
    } catch (e) {
      error(section + "." + key, e.message);
    }
  }
  if (!(data.wage?.employment_type === "ad_hoc" && data.wage.salary == null)) {
    try {
      data.wage.salary = money(data.wage?.salary);
    } catch (e) {
      error("wage.salary", e.message);
    }
  }
  for (const [key, value] of Object.entries(data.year_to_date || {})) {
    if (key === "gross_pay" && unreportedYtdGross) continue;
    if (value == null && !["gross_pay", "tax_paid"].includes(key)) continue;
    try {
      data.year_to_date[key] = money(value);
    } catch (e) {
      error("year_to_date." + key, e.message);
    }
  }
  if (data.this_period_summary?.period_end_date != null) {
    try {
      data.this_period_summary.period_end_date = dateOnly(
        data.this_period_summary.period_end_date,
      );
    } catch (e) {
      error("this_period_summary.period_end_date", e.message);
    }
  }
  try {
    data.pay_date = dateOnly(data.pay_date);
    data.this_period_summary.tax_year = `${taxYear(data.pay_date)}/${String(taxYear(data.pay_date) + 1).slice(-2)}`;
  } catch (e) {
    error("pay_date", e.message);
  }
  for (const key of ["total_payments", "total_deductions", "net_pay"]) {
    try {
      data[key] = money(data[key]);
      if (pennies(data.this_period_summary?.[key]) !== pennies(data[key]))
        error(key, "Summary does not match");
      data.this_period_summary[key] = data[key];
    } catch (e) {
      error(key, e.message);
    }
  }
  if (
    !Array.isArray(data.pay_lines) ||
    (!data.pay_lines.length && data.total_payments !== "0.00")
  )
    error("pay_lines", "No pay lines extracted");
  else {
    let sum = 0;
    data.pay_lines.forEach((line, i) => {
      try {
        if (!line.Description) throw new Error("Missing description");
        line.Amount = money(line.Amount);
        sum += pennies(line.Amount);
        if (!Number.isSafeInteger(sum))
          error("pay_lines", "Sum exceeds supported range");
        const expected = calculatedPennies(line.Paid, line.Rate);
        const acknowledgement = line.rounding_acknowledgement;
        const acceptedRounding =
          acknowledgement?.approved_by === "owner" &&
          typeof acknowledgement.reason === "string" &&
          acknowledgement.reason.trim() &&
          acknowledgement.description === line.Description &&
          acknowledgement.paid === String(line.Paid) &&
          acknowledgement.rate === String(line.Rate) &&
          acknowledgement.amount === line.Amount;
        if (
          expected !== null &&
          !acceptedRounding &&
          Math.abs(expected - pennies(line.Amount)) >
            roundingAllowance(line.Paid, line.Rate)
        )
          error(
            `pay_lines.${i}.Amount`,
            "Amount is outside the rounding range of the printed paid quantity and rate",
          );
      } catch (e) {
        error(`pay_lines.${i}`, e.message);
      }
    });
    try {
      if (Math.abs(sum - pennies(data.total_payments)) > 1)
        error("pay_lines", "Amounts do not reconcile with total payments");
    } catch {}
  }
  let deductions = 0;
  for (const [key, value] of Object.entries(data.deduction_lines || {})) {
    try {
      data.deduction_lines[key] = money(
        require("../split_sections").deductionAmount(value),
      );
      deductions += pennies(data.deduction_lines[key]);
      if (!Number.isSafeInteger(deductions))
        error("deduction_lines", "Sum exceeds supported range");
    } catch (e) {
      error(`deduction_lines.${key}`, e.message);
    }
  }
  try {
    if (Math.abs(deductions - pennies(data.total_deductions)) > 1)
      error(
        "deduction_lines",
        "Amounts do not reconcile with total deductions",
      );
    if (
      Math.abs(
        pennies(data.total_payments) -
          pennies(data.total_deductions) -
          pennies(data.net_pay),
      ) > 1
    )
      error("net_pay", "Payments minus deductions do not equal net pay");
  } catch {}
  return { data, errors };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .filter(
          (k) =>
            ![
              "filename",
              "file_hash",
              "id",
              "username",
              "raw_hash",
              "content_hash",
              "created_at",
              "updated_at",
            ].includes(k),
        )
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function fingerprint(data) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(data)))
    .digest("hex");
}
function identity(data) {
  return [data.demographics?.assignment_no, data.tax?.ni_number]
    .map((x) =>
      String(x || "")
        .replace(/\s/g, "")
        .toUpperCase(),
    )
    .join("|");
}
function yearRange(type, year) {
  year = Number(year);
  if (!Number.isInteger(year) || year < 1900 || year > 2200)
    throw new Error("Invalid year");
  const start = (y) => {
    let d = new Date(Date.UTC(y, 7, 1));
    d.setUTCDate(1 + ((3 - d.getUTCDay() + 7) % 7));
    return d.toISOString().slice(0, 10);
  };
  if (type === "tax") return [`${year}-04-06`, `${year + 1}-04-06`];
  if (type === "academic") return [start(year), start(year + 1)];
  throw new Error("Invalid year type");
}
module.exports = {
  pennies,
  money,
  dateOnly,
  validate,
  fingerprint,
  identity,
  yearRange,
  taxYear,
};
