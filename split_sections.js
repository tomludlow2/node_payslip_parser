const fs = require("fs");
const PDFParser = require("pdf-parse");

// Function to read a PDF file and return its text content
async function readPDF(file) {
  return new Promise((resolve, reject) => {
    let dataBuffer = fs.readFileSync(file);
    // Give PDF.js an isolated typed array; pooled Node Buffers can expose unrelated bytes.
    PDFParser(Uint8Array.from(dataBuffer), { pagerender: renderPage })
      .then((data) => {
        resolve(data.text);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

// Rebuild the ESR payment table from PDF coordinates. Text-stream order loses
// empty cells and joins a one-row table to its first deduction.
async function renderPage(page) {
  const { items } = await page.getTextContent();
  let text = "",
    lastY;
  for (const item of items) {
    const y = item.transform[5];
    text += (lastY === undefined || lastY === y ? "" : "\n") + item.str;
    lastY = y;
  }
  // Retain column boundaries in header values too: tax references can end in
  // digits and codes can start with 0 (e.g. 567/S5005 followed by 0T).
  const fields = (label, nextLabel, bounds) => {
    const h = items.find((i) => i.str === label);
    const next = items.find((i) => i.str === nextLabel);
    if (
      !h ||
      !next ||
      Math.abs(
        h.transform[4] -
          {
            "JOB TITLE": 236.295,
            "SAL/WAGE": 179.952,
            "TAX OFFICE NAME": 190.807,
          }[label],
      ) > 2
    )
      return;
    const cells = Array.from({ length: bounds.length + 1 }, () => []);
    for (const i of items)
      if (
        i.transform[5] < h.transform[5] - 2 &&
        i.transform[5] > next.transform[5] + 2
      )
        cells[bounds.filter((x) => i.transform[4] >= x).length].push(i);
    const values = cells.map((c) =>
      c
        .sort(
          (a, b) =>
            b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
        )
        .map((i) => i.str.trim())
        .join(" ")
        .trim(),
    );
    const headerLine = {
      "JOB TITLE": "DEPARTMENTJOB TITLEPAYSCALE DESCRIPTION",
      "SAL/WAGE": "SAL/WAGEINC. DATESTANDARD HRS.PT SAL/WAGE",
      "TAX OFFICE NAME": "TAX OFFICE NAMETAX OFFICE REFTAX CODENI NUMBER",
    }[label];
    const start = text.indexOf(headerLine);
    if (start < 0) return;
    const valueStart = start + headerLine.length;
    const nextStart = text.indexOf(
      nextLabel === "PAY" ? "PAYANDALLOWANCES" : "SAL/WAGEINC.",
      valueStart,
    );
    const stop =
      label === "SAL/WAGE"
        ? text.indexOf("TAX OFFICE NAMETAX OFFICE REF", valueStart)
        : nextStart;
    if (stop < 0) return;
    text =
      text.slice(0, valueStart) +
      "\n" +
      values.join("|") +
      "\n" +
      text.slice(stop);
  };
  fields("JOB TITLE", "SAL/WAGE", [145, 355]);
  fields("SAL/WAGE", "TAX OFFICE NAME", [250, 355, 460]);
  fields("TAX OFFICE NAME", "PAY", [300, 380, 470]);
  const header = items.find((i) => i.str === "WKD/EARNED");
  const start = text.indexOf(
    "DESCRIPTIONWKD/EARNEDPAID/DUERATEAMOUNTDESCRIPTIONAMOUNTBALANCE C/F",
  );
  const end = text.indexOf(
    "YearToDateBalances(ThisEmploymentOnly)ThisPeriodSummary",
  );
  if (
    !header ||
    start < 0 ||
    end < 0 ||
    Math.abs(header.transform[4] - 155.205) > 2
  )
    return text;
  const footer = items.find(
    (i) => i.str === "Year" && i.transform[5] < header.transform[5],
  );
  if (!footer) return text;
  const rows = [];
  for (const item of items) {
    const [x, y] = item.transform.slice(4);
    if (y >= header.transform[5] - 2 || y <= footer.transform[5] + 2) continue;
    let row = rows.find((r) => Math.abs(r.y - y) < 1);
    if (!row)
      rows.push((row = { y, cells: Array.from({ length: 8 }, () => []) }));
    const col = [150, 200, 245, 295, 342, 450, 505].filter(
      (b) => x >= b,
    ).length;
    row.cells[col].push(item);
  }
  rows.sort((a, b) => b.y - a.y);
  const cell = (r, c) =>
    r.cells[c]
      .sort((a, b) => a.transform[4] - b.transform[4])
      .map((i) => i.str)
      .join("")
      .trim();
  const pay = rows.filter((r) => cell(r, 0));
  const deductions = rows.filter((r) => cell(r, 5));
  const lines = [];
  for (let c = 0; c < 5; c++)
    for (const r of pay) lines.push(cell(r, c) || "' '");
  for (const r of deductions) lines.push(cell(r, 5));
  for (const r of deductions) lines.push(cell(r, 6));
  // Preserve otherwise unrecognised cells so reconciliation fails visibly.
  if (
    rows.some(
      (r) =>
        cell(r, 7) ||
        (!cell(r, 0) &&
          [1, 2, 3, 4].some(
            (c) => cell(r, c) && !/^\'\s*\'$/.test(cell(r, c)),
          )) ||
        (!cell(r, 5) && cell(r, 6)),
    )
  )
    return text;
  const marker =
    "DESCRIPTIONWKD/EARNEDPAID/DUERATEAMOUNTDESCRIPTIONAMOUNTBALANCE C/F";
  return (
    text.slice(0, start + marker.length) +
    "\n" +
    lines.join("\n") +
    "\n" +
    text.slice(end)
  );
}

async function process_loaded_payslip(pdfText, filename) {
  let sections = splitSections(pdfText);
  //Section 1 contains demographics and tax
  let section_1_lines = parse_section_1(sections.section1);
  let demographics = parse_demographic_line(section_1_lines.arr_2[0]);
  let job = parse_job_line(section_1_lines.arr_2[1]);
  let wage = parse_wage_line(section_1_lines.arr_2[2]);
  const taxHeader = sections.section1.indexOf(
    "TAX OFFICE NAMETAX OFFICE REFTAX CODENI NUMBER",
  );
  const taxText =
    taxHeader >= 0
      ? sections.section1
          .slice(taxHeader)
          .split("\n")
          .slice(1)
          .join(" ")
          .split("PAYANDALLOWANCES")[0]
          .trim()
      : section_1_lines.arr_2[3];
  let tax = parse_tax_line(taxText) || {};
  const adHoc = /\b(locum|bank|ad[ -]?hoc|temporary staffing)\b/i.test(
    [filename, section_1_lines.arr_2[1]].join(" "),
  );
  if (adHoc && (!wage || wage.salary == null || Number(wage.salary) === 0)) {
    wage = { ...(wage || {}), salary: null, employment_type: "ad_hoc" };
  }
  //Section 2 contains pay and deductions
  let pay_deductions = split_pay_deductions(sections.section2);
  let deduction_lines = pay_deductions.deductions;
  let pay_lines = parse_pay_lines(pay_deductions.pay_lines);
  //Section 3 contains gross pay / year to date
  let balances = parse_section_3(sections.section3);

  // Extract properties for year_to_date
  let {
    TAXABLEPAY: taxable_pay,
    TAXPAID: tax_paid,
    PENSIONCONTS: pension_contributions,
    GROSSPAY: gross_pay,
    NIPAY: ni_pay,
    OTHERNIPAY: other_ni_pay,
    NICONTS: ni_contributions,
    OTHERNICONTS: other_ni_contributions,
  } = balances;

  let year_to_date = {
    taxable_pay: taxable_pay,
    tax_paid: tax_paid,
    pension_contributions: pension_contributions,
    gross_pay: gross_pay,
    ni_pay: ni_pay,
    other_ni_pay: other_ni_pay,
    ni_contributions: ni_contributions,
    other_ni_contributions: other_ni_contributions,
  };

  // Extract properties for this_period_summary
  let {
    "PENSIONABLE PAY": pensionable_pay,
    "TAX PERIOD": tax_period,
    "PERIOD END DATE": period_end_date,
    "TAXABLE PAY": period_taxable_pay,
    "NON-TAXABLE PAY": non_taxable_pay,
    "TOTAL PAYMENTS": total_payments,
    "TOTAL DEDUCTIONS": total_deductions,
    PENSIONABLEPAY: period_pensionable_pay,
    "NET PAY": net_pay,
    FREQUENCY: frequency,
    "PAY DATE": pay_date,
  } = balances;

  tax.ni_letter = balances["NILETTER"];

  let this_period_summary = {
    pensionable_pay: pensionable_pay,
    tax_period: tax_period,
    period_end_date: period_end_date,
    period_taxable_pay: period_taxable_pay,
    non_taxable_pay: non_taxable_pay,
    total_payments: total_payments,
    total_deductions: total_deductions,
    period_pensionable_pay: period_pensionable_pay,
    frequency: frequency,
    net_pay: net_pay,
  };

  return {
    filename: filename,
    demographics: demographics,
    job: job,
    wage: wage,
    tax: tax,
    deduction_lines: deduction_lines,
    pay_lines: pay_lines,
    this_period_summary: this_period_summary,
    year_to_date: year_to_date,
    total_payments: total_payments,
    total_deductions: total_deductions,
    pay_date: pay_date,
    net_pay: net_pay,
  };
}

// Function to split text into three sections based on precise criteria
function splitSections(pdfText) {
  const lines = pdfText.split("\n");

  let section1 = [];
  let section2 = [];
  let section3 = [];

  let section1EndIndex = -1;
  let section3StartIndex = -1;

  // Find the end of section 1
  for (let i = 0; i < lines.length; i++) {
    section1.push(lines[i]);
    if (
      lines[i].includes(
        "DESCRIPTIONWKD/EARNEDPAID/DUERATEAMOUNTDESCRIPTIONAMOUNTBALANCE C/F",
      )
    ) {
      section1EndIndex = i;
      break;
    }
  }

  // Find the start of section 3
  let foundSection3 = false;
  for (let i = section1EndIndex + 1; i < lines.length; i++) {
    if (
      !foundSection3 &&
      lines[i].includes(
        "YearToDateBalances(ThisEmploymentOnly)ThisPeriodSummary",
      )
    ) {
      section3StartIndex = i;
      foundSection3 = true;
      continue; // Skip the line that contains the marker
    }

    if (!foundSection3) {
      section2.push(lines[i]);
    } else {
      section3.push(lines[i]);
    }
  }

  if (section1EndIndex < 0 || section3StartIndex < 0)
    throw new Error("Missing required payslip section");

  // Join sections into strings
  section1 = section1.slice(0, section1EndIndex + 1).join("\n");
  section2 = section2.join("\n");
  section3 = section3.join("\n");

  return {
    section1,
    section2,
    section3,
  };
}

function split_pay_deductions(section2) {
  // Split section 2 into lines and trim whitespace
  const lines = section2.split("\n").map((line) => line.trim());

  // Remove trailing blank lines from the end
  let lastIndex = lines.length - 1;
  while (lastIndex >= 0 && lines[lastIndex].trim() === "") {
    lastIndex--;
  }

  const amountPattern = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?\s*R?$/i;
  let numericLinesCount = 0;
  for (let i = lastIndex; i >= 0 && amountPattern.test(lines[i]); i--)
    numericLinesCount++;
  const descStart = lastIndex - 2 * numericLinesCount + 1;
  if (descStart < 0)
    throw new Error("Unsupported deduction layout; manual review required");
  const deductions = {};
  for (let i = 0; i < numericLinesCount; i++) {
    let description = lines[descStart + i]
      .replace(/^'(\s*)|(\s*)'$/g, "")
      .trim();
    if (description.includes("PAYE")) description = "PAYE";
    if (!description || Object.hasOwn(deductions, description))
      throw new Error("Missing or duplicate deduction description");
    deductions[description] = deductionAmount(
      lines[lastIndex - numericLinesCount + 1 + i],
    );
  }
  const pay_lines = lines.slice(0, descStart).filter((line) => line !== "");

  return {
    deductions,
    pay_lines,
  };
}

function deductionAmount(value) {
  const raw = String(value).trim();
  return /R$/i.test(raw)
    ? "-" + raw.replace(/R$/i, "").trim().replace(/^[+-]/, "")
    : raw;
}

function parse_pay_lines(pay_lines, total_pay = 0) {
  const payLinesArray = [];

  if (pay_lines.length % 5 === 0) {
    const n = pay_lines.length / 5; // Number of unique objects

    // Create objects for each set of n lines
    for (let i = 0; i < n; i++) {
      const payLine = {
        Description: pay_lines[i] ? pay_lines[i].trim() : "", // Description is always present
        Worked: pay_lines[i + n] ? pay_lines[i + n].trim() : "",
        Paid: pay_lines[i + 2 * n] ? pay_lines[i + 2 * n].trim() : "",
        Rate: pay_lines[i + 3 * n] ? pay_lines[i + 3 * n].trim() : "",
        Amount: pay_lines[i + 4 * n] ? pay_lines[i + 4 * n].trim() : "",
      };

      // Add the pay line object to the array
      payLinesArray.push(payLine);
    }
  } else {
    throw new Error("Unsupported pay-line layout; manual review required");
  }

  return payLinesArray;
}

function parse_section_3(section3) {
  const keys = [
    "GROSSPAY",
    "TAXABLEPAY",
    "PENSIONABLE PAY",
    "TAXABLE PAY",
    "NILETTER",
    "TAXPAID",
    "TAX PERIOD",
    "NON-TAXABLE PAY",
    "NIPAY",
    "OTHERNIPAY",
    "PREVIOUSTAXABLEPAY",
    "FREQUENCY",
    "TOTAL PAYMENTS",
    "NICONTS",
    "OTHERNICONTS",
    "PREVIOUSTAXPAID",
    "PERIOD END DATE",
    "TOTAL DEDUCTIONS",
    "PENSIONABLEPAY",
    "PENSIONCONTS",
    "PAY DATE",
    "NET PAY",
    "SDREFNUMBER",
    "EMPLOYEENO.",
    "PAY METHOD",
    "MESSAGES FROM EMPLOYER",
  ];
  const data = section3.split("\n");

  let result = {};
  let failsafe = {};
  let unprocessedItems = [];

  for (let i = 0; i < data.length; i++) {
    let key = data[i];
    if (key === "SDREFNUMBEREMPLOYEENO.") {
      result["SDREFNUMBER"] = "empty";
      if (i + 1 < data.length) {
        result["EMPLOYEENO."] = data[i + 1];
        i++;
      } else {
        result["EMPLOYEENO."] = 0;
      }
    } else if (key === "MESSAGES FROM EMPLOYER") {
      failsafe[key] = data[i + 1] || "";
      i++; // Skip the message value
    } else if (keys.includes(key)) {
      // Check if the next element is also a key
      if (i + 1 < data.length && keys.includes(data[i + 1])) {
        result[key] = null; // Missing values must fail validation
      } else {
        result[key] = data[i + 1] || null; // Preserve missing values for validation
        i++; // Skip the value
      }
    } else {
      unprocessedItems.push(key);
    }
    result["MESSAGES FROM EMPLOYER"];
  }

  // Process unprocessed items and include in failsafe
  for (let i = 0; i < unprocessedItems.length; i++) {
    let key = unprocessedItems[i];
    if (
      i + 1 < unprocessedItems.length &&
      !keys.includes(unprocessedItems[i + 1])
    ) {
      failsafe[key] = unprocessedItems[i + 1];
      i++;
    } else {
      failsafe[key] = 0;
    }
  }

  return result;
}

function parse_section_1(section1) {
  // Header values can wrap across several PDF lines (job and tax code).
  const groups = section1.match(
    /(?:ASSIGNMENT NUMBER[^\n]*|DEPARTMENT[^\n]*|SAL(?:\/WAGE|ARY)[^\n]*|TAX OFFICE[^\n]*)\n[\s\S]*?(?=\n(?:DEPARTMENT|SAL\/WAGE|SALARY|TAX OFFICE|PAYANDALLOWANCES|DESCRIPTION)|$)/g,
  );
  if (groups?.length === 4)
    return {
      arr_1: groups.map((g) => g.split("\n")[0]),
      arr_2: groups.map((g) => g.split("\n").slice(1).join(" ").trim()),
    };
  const lines = section1.split("\n");

  // Remove blank lines
  const nonEmptyLines = lines.filter((line) => line.trim() !== "");

  // Split into alternate lines in arr_1 and arr_2
  const arr_1 = [];
  const arr_2 = [];
  for (let i = 0; i < nonEmptyLines.length; i++) {
    if (i % 2 === 0) {
      arr_1.push(nonEmptyLines[i]);
    } else {
      arr_2.push(nonEmptyLines[i]);
    }
  }

  return { arr_1, arr_2 };
}

// Function to parse a demographic line into assignment number, name, and location
function parse_demographic_line(line) {
  const parts = line.trim().split(/(?<=\d)(?=[A-Za-z])/); // Split on transition from digits to letters

  if (parts.length < 2) {
    return null; // Return null if the line doesn't match the expected format
  }

  const assignment_no = parts[0].trim();
  const rest = parts.slice(1).join("").trim(); // Join remaining parts and trim whitespace

  // Extract name and location
  let name = "";
  let location = "";

  // Regex to match name and location
  const regex = /^([A-Z.\- ]+)([A-Z].+)/; // Match name (capitalized, may include dots or hyphens) and location
  const match = rest.match(regex);

  if (match) {
    name = match[1].trim();
    location = match[2].trim();
  }

  return { assignment_no, name, location };
}

// Function to parse a wage line into salary, inc_date, standard_hours, and part_time_salary
function parse_wage_line(line) {
  if (line.includes("|")) {
    const [salary, inc_date, standard_hours, part_time_salary] =
      line.split("|");
    return {
      salary: salary || null,
      inc_date,
      standard_hours: standard_hours || null,
      part_time_salary: part_time_salary || null,
    };
  }
  const regex =
    /^(\d+\.\d{2})(\d{2} [A-Z]{3} \d{4})?(\d{1,2}(?:\.\d)?)(\d+\.\d{2})$/;

  const match = line.trim().match(regex);
  if (!match) {
    return null; // Return null if the line doesn't match the expected format
  }

  const salary = parseFloat(match[1]);
  const inc_date = match[2] ? match[2].trim() : "";
  const standard_hours = parseFloat(match[3]);
  const part_time_salary = parseFloat(match[4]);

  // Validate part_time_salary should be less than or equal to salary
  if (part_time_salary > salary) {
    return null;
  }

  return {
    salary,
    inc_date,
    standard_hours,
    part_time_salary,
  };
}

// Function to parse a tax line into tax_office, tax_reference, tax_code, and ni_number
function parse_tax_line(line) {
  if (line?.includes("|")) {
    const [tax_office, tax_reference, tax_code, ni_number] = line
      .trim()
      .split("|")
      .map((s) => s.trim());
    return { tax_office, tax_reference, tax_code, ni_number };
  }
  const regex = /^(.+?)(\d{3}\/[A-Z]{0,2}\d{1,5})(.*)?([A-Z]{2}\d{6}[A-Z])$/;

  const match = line.trim().replace(/\s+/g, " ").match(regex);
  if (!match) {
    return null; // Return null if the line doesn't match the expected format
  }

  const tax_office = match[1].trim();
  const tax_reference = match[2];
  let tax_code = "";
  if (match[3]) {
    tax_code = match[3].trim();
  }
  const ni_number = match[4];

  return {
    tax_office,
    tax_reference,
    tax_code,
    ni_number,
  };
}

// Function to parse a job line into department, job_title, and payscale_descriptor
function parse_job_line(line) {
  if (line.includes("|")) {
    const [department, job_title, payscale_descriptor] = line.split("|");
    return { department, job_title, payscale_descriptor };
  }
  const regex = /([a-z0-9])(?=[A-Z])/g;
  const locum = line.match(
    /^(.*?)\s+(.*Locum\s+Independent Contractor)(Ad Hoc)$/i,
  );
  if (locum)
    return {
      department: locum[1],
      job_title: locum[2],
      payscale_descriptor: locum[3],
    };
  const bank = line.match(/^(.*?\bBank)\s+(Bank\s*-.*?)((?:ST\d|Ad Hoc).*)$/i);
  if (bank)
    return {
      department: bank[1],
      job_title: bank[2],
      payscale_descriptor: bank[3],
    };
  const parts = [];
  let lastIndex = 0;

  let match;
  while ((match = regex.exec(line)) !== null) {
    parts.push(line.slice(lastIndex, match.index + 1));
    lastIndex = match.index + 1;
  }
  parts.push(line.slice(lastIndex)); // Add the remaining part

  // We expect three parts: department, job_title, payscale_descriptor
  if (parts.length === 3) {
    return {
      department: parts[0].trim(),
      job_title: parts[1].trim(),
      payscale_descriptor: parts[2].trim(),
    };
  } else if (parts.length > 3) {
    // Combine any extra parts into the last part (payscale_descriptor)
    return {
      department: parts[0].trim(),
      job_title: parts[1].trim(),
      payscale_descriptor: parts.slice(2).join("").trim(),
    };
  } else {
    return {
      department: parts[0]?.trim() || "",
      job_title: parts[1]?.trim() || "",
      payscale_descriptor: parts[2]?.trim() || "",
    };
  }
}

module.exports = {
  readPDF,
  renderPage,
  deductionAmount,
  splitSections,
  split_pay_deductions,
  parse_pay_lines,
  parse_section_3,
  parse_section_1,
  parse_demographic_line,
  parse_wage_line,
  parse_tax_line,
  parse_job_line,
  process_loaded_payslip,
};
