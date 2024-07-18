const fs = require('fs');
const PDFParser = require('pdf-parse');

// Function to read a PDF file and return its text content
async function readPDF(file) {
  return new Promise((resolve, reject) => {
    let dataBuffer = fs.readFileSync(file);
    PDFParser(dataBuffer).then((data) => {
      resolve(data.text);
    }).catch((err) => {
      reject(err);
    });
  });
}

async function process_loaded_payslip(pdfText, filename) {
  let sections = splitSections(pdfText);
  //Section 1 contains demographics and tax
  let section_1_lines = parse_section_1(sections.section1);
  let demographics = parse_demographic_line(section_1_lines.arr_2[0]);
  let job = parse_job_line(section_1_lines.arr_2[1]);
  let wage = parse_wage_line(section_1_lines.arr_2[2]);
  let tax = parse_tax_line(section_1_lines.arr_2[3]);
  //Section 2 contains pay and deductions
  let pay_deductions = split_pay_deductions(sections.section2);
  let deduction_lines = pay_deductions.deductions
  let pay_lines = parse_pay_lines(pay_deductions.pay_lines);
  //Section 3 contains gross pay / year to date 
  let balances = parse_section_3(sections.section3);

  

  // Extract properties for year_to_date
  let {
    'TAXABLEPAY': taxable_pay,
    'TAXPAID': tax_paid,
    'PENSIONCONTS': pension_contributions,
    'GROSSPAY': gross_pay,
    'NIPAY': ni_pay,
    'OTHERNIPAY': other_ni_pay,
    'NICONTS': ni_contributions,
    'OTHERNICONTS': other_ni_contributions
  } = balances;

  let year_to_date = {
    taxable_pay: taxable_pay,
    tax_paid: tax_paid,
    pension_contributions: pension_contributions,
    gross_pay: gross_pay,
    ni_pay: ni_pay,
    other_ni_pay: other_ni_pay,
    ni_contributions: ni_contributions,
    other_ni_contributions: other_ni_contributions
  };

  // Extract properties for this_period_summary
  let {
    'PENSIONABLE PAY': pensionable_pay,
    'TAX PERIOD': tax_period,
    'PERIOD END DATE': period_end_date,
    'TAXABLE PAY': period_taxable_pay,
    'NON-TAXABLE PAY': non_taxable_pay,
    'TOTAL PAYMENTS': total_payments,
    'TOTAL DEDUCTIONS': total_deductions,
    'PENSIONABLEPAY': period_pensionable_pay,
    'NET PAY': net_pay,
    'FREQUENCY': frequency,
    'PAY DATE': pay_date
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
    net_pay: net_pay
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
    net_pay: net_pay
  };

}

// Function to split text into three sections based on precise criteria
function splitSections(pdfText) {
  const lines = pdfText.split('\n');

  let section1 = [];
  let section2 = [];
  let section3 = [];

  let section1EndIndex = -1;
  let section3StartIndex = -1;

  // Find the end of section 1
  for (let i = 0; i < lines.length; i++) {
    section1.push(lines[i]);
    if (lines[i].includes('DESCRIPTIONWKD/EARNEDPAID/DUERATEAMOUNTDESCRIPTIONAMOUNTBALANCE C/F')) {
      section1EndIndex = i;
      break;
    }
  }

  // Find the start of section 3
  let foundSection3 = false;
  for (let i = section1EndIndex + 1; i < lines.length; i++) {
    if (!foundSection3 && lines[i].includes('YearToDateBalances(ThisEmploymentOnly)ThisPeriodSummary')) {
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

  // Join sections into strings
  section1 = section1.slice(0, section1EndIndex + 1).join('\n');
  section2 = section2.join('\n');
  section3 = section3.join('\n');

  return {
    section1,
    section2,
    section3
  };
}

function split_pay_deductions(section2) {
  // Split section 2 into lines and trim whitespace
  const lines = section2.split('\n').map(line => line.trim());

  // Remove trailing blank lines from the end
  let lastIndex = lines.length - 1;
  while (lastIndex >= 0 && lines[lastIndex].trim() === '') {
    lastIndex--;
  }

  // Initialize variables
  let deductionLines = [];
  let count = 0;
  let numericLinesCount = 0;

  // Count numeric lines from the end
  for (let i = lastIndex; i >= 0; i--) {
    const line = lines[i];
    if (line.match(/^[-+]?\d+(\.\d+)?\s*R?$/)) {
      numericLinesCount++;
    } else if (numericLinesCount > 0 && !line.match(/^[-+]?\d+(\.\d+)?\s*R?$/)) {
      count++;
      if (count === numericLinesCount) {
        break; // Stop at the end of numeric lines
      }
    }
  }

  // Extract deduction lines with their descriptions
  const deductionAmounts = lines.slice(lastIndex - numericLinesCount + 1, lastIndex + 1);
  const deductionDescriptions = lines.slice(lastIndex - numericLinesCount - count + 1, lastIndex - numericLinesCount + 1);

  // Pair descriptions with amounts
  const deductions = {};
  for (let i = 0; i < deductionAmounts.length; i++) {
    // Clean up description line by removing leading and trailing quotes and any extra whitespace
    let cleanedDescription = deductionDescriptions[i].replace(/^'(\s*)|(\s*)'$/g, '').trim();
    
    // Check if the description includes "PAYE" and rename key if necessary
    if (cleanedDescription.includes("PAYE")) {
      cleanedDescription = "PAYE";
    }

    deductions[cleanedDescription] = deductionAmounts[i];
  }

  // Remaining lines are pay lines
  let pay_lines = lines.slice(0, lastIndex - numericLinesCount - count + 1);

  return {
    deductions,
    pay_lines
  };
}


function parse_pay_lines(pay_lines) {
  const payLinesArray = [];
  const n = pay_lines.length / 5; // Number of unique objects

  // Create objects for each set of n lines
  for (let i = 0; i < n; i++) {
    const payLine = {
      Description: pay_lines[i] ? pay_lines[i].trim() : '', // Description is always present
      Worked: pay_lines[i + n] ? pay_lines[i + n].trim() : '',
      Paid: pay_lines[i + 2 * n] ? pay_lines[i + 2 * n].trim() : '',
      Rate: pay_lines[i + 3 * n] ? pay_lines[i + 3 * n].trim() : '',
      Amount: pay_lines[i + 4 * n] ? pay_lines[i + 4 * n].trim() : ''
    };

    // Add the pay line object to the array
    payLinesArray.push(payLine);
  }

  return payLinesArray;
}


function parse_section_3(section3) {
  const keys = [
    'GROSSPAY', 'TAXABLEPAY', 'PENSIONABLE PAY', 'TAXABLE PAY', 'NILETTER', 'TAXPAID', 'TAX PERIOD',
    'NON-TAXABLE PAY', 'NIPAY', 'OTHERNIPAY', 'PREVIOUSTAXABLEPAY', 'FREQUENCY', 'TOTAL PAYMENTS', 
    'NICONTS', 'OTHERNICONTS', 'PREVIOUSTAXPAID', 'PERIOD END DATE', 'TOTAL DEDUCTIONS', 'PENSIONABLEPAY', 
    'PENSIONCONTS', 'PAY DATE', 'NET PAY', 'SDREFNUMBER', 'EMPLOYEENO.', 'PAY METHOD', 'MESSAGES FROM EMPLOYER'
  ];
  const data = section3.split("\n");
  console.log(data);

  let result = {};
  let failsafe = {};
  let unprocessedItems = [];


  for (let i = 0; i < data.length; i++) {
    let key = data[i];
    if (key === 'SDREFNUMBEREMPLOYEENO.') {
      result['SDREFNUMBER'] = 'empty';
      if (i + 1 < data.length) {
        result['EMPLOYEENO.'] = data[i + 1];
        i++;
      } else {
        result['EMPLOYEENO.'] = 0;
      }
    } else if (key === 'MESSAGES FROM EMPLOYER') {
      failsafe[key] = data[i + 1] || '';
      i++; // Skip the message value
    } else if (keys.includes(key)) {
      // Check if the next element is also a key
      if (i + 1 < data.length && keys.includes(data[i + 1])) {
        result[key] = 0; // Substitute missing value with 0
      } else {
        result[key] = data[i + 1] || 0; // Assign the next element as value or 0 if undefined
        i++; // Skip the value
      }
    } else {
      unprocessedItems.push(key);
    }
    result["MESSAGES FROM EMPLOYER"]
  }

  // Process unprocessed items and include in failsafe
  for (let i = 0; i < unprocessedItems.length; i++) {
    let key = unprocessedItems[i];
    if (i + 1 < unprocessedItems.length && !keys.includes(unprocessedItems[i + 1])) {
      failsafe[key] = unprocessedItems[i + 1];
      i++;
    } else {
      failsafe[key] = 0;
    }
  }
  
  console.log("Unprocessed items have been grouped as a failsafe", failsafe);

  return result;
}

function parse_section_1(section1) {
  // Split section1 into lines
  const lines = section1.split("\n");

  // Remove blank lines
  const nonEmptyLines = lines.filter(line => line.trim() !== '');

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
  const rest = parts.slice(1).join('').trim(); // Join remaining parts and trim whitespace

  // Extract name and location
  let name = '';
  let location = '';

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
  const regex = /^(\d+\.\d{2})(\d{2} [A-Z]{3} \d{4})?(\d{2})(\d+\.\d{2})$/;

  const match = line.trim().match(regex);
  if (!match) {
    return null; // Return null if the line doesn't match the expected format
  }

  const salary = parseFloat(match[1]);
  const inc_date = match[2] ? match[2].trim() : '';
  const standard_hours = parseInt(match[3], 10);
  const part_time_salary = parseFloat(match[4]);

  // Validate part_time_salary should be less than or equal to salary
  if (part_time_salary > salary) {
    return null;
  }

  return {
    salary,
    inc_date,
    standard_hours,
    part_time_salary
  };
}

// Function to parse a tax line into tax_office, tax_reference, tax_code, and ni_number
function parse_tax_line(line) {
  const regex = /^(.+?)(\d{3}\/[A-Z]{0,2}\d{1,5})(.*)?([A-Z]{2}\d{6}[A-Z])$/;

  const match = line.trim().match(regex);
  if (!match) {
    return null; // Return null if the line doesn't match the expected format
  }

  const tax_office = match[1].trim();
  const tax_reference = match[2];
  let tax_code = '';
  if (match[3]) {
    tax_code = match[3].trim();
  }
  const ni_number = match[4];

  return {
    tax_office,
    tax_reference,
    tax_code,
    ni_number
  };
}


// Function to parse a job line into department, job_title, and payscale_descriptor
function parse_job_line(line) {
  const regex = /([a-z0-9])(?=[A-Z])/g;
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
      payscale_descriptor: parts[2].trim()
    };
  } else if (parts.length > 3) {
    // Combine any extra parts into the last part (payscale_descriptor)
    return {
      department: parts[0].trim(),
      job_title: parts[1].trim(),
      payscale_descriptor: parts.slice(2).join('').trim()
    };
  } else {
    return {
      department: parts[0]?.trim() || '',
      job_title: parts[1]?.trim() || '',
      payscale_descriptor: parts[2]?.trim() || ''
    };
  }
}

module.exports = {
  readPDF,
  splitSections,
  split_pay_deductions,
  parse_pay_lines,
  parse_section_3,
  parse_section_1,
  parse_demographic_line,
  parse_wage_line,
  parse_tax_line,
  parse_job_line,
  process_loaded_payslip
};
