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
  const lines = section3.split("\n");
  const section3Data = {};

  // Regular expression patterns for specific value formats
  const numberPattern = /^\d+(\.\d{1,2})?$/;
  const capitalLetterPattern = /^[A-Z]$/;
  const datePattern = /^\s*\d{1,2}\s(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s\d{4}\s*$/; // Updated date pattern

  for (let i = 0; i < lines.length; i += 2) {
    let key = lines[i].trim();
    let value = lines[i + 1] ? lines[i + 1].trim() : '';

    // Handle keys with quotes if present
    if (key.startsWith("'") && key.endsWith("'")) {
      key = key.substring(1, key.length - 1);
    }

    // Stop parsing at "MESSAGES FROM EMPLOYER"
    if (key.startsWith("MESSAGES FROM EMPLOYER")) {
      break;
    }

    // Handle multi-line values
    if (value === '' && key.endsWith(':')) {
      let j = i + 2;
      let combinedValue = lines[i + 1] ? lines[i + 1].trim() : '';
      while (j < lines.length && !lines[j].match(/^\w+:/)) {
        combinedValue += ' ' + lines[j].trim();
        j++;
      }
      value = combinedValue.trim();
      i = j - 2; // Move i to the last processed line
    }

    // Validate and format specific key-value pairs
    switch (key) {
      case 'NILETTER':
        if (value.match(capitalLetterPattern)) {
          section3Data[key] = value;
        } else {
          section3Data[key] = '';
        }
        break;
      case 'FREQUENCY':
        if (/^[A-Za-z]+$/.test(value)) {
          section3Data[key] = value;
        } else {
          section3Data[key] = '';
        }
        break;
      case 'PERIOD END DATE':
      case 'PAY DATE':
        if (value.match(datePattern)) {
          section3Data[key] = value.trim(); // Ensure trimmed
        } else {
          section3Data[key] = '';
          // Check the next line for the date format
          if (lines[i + 1] && lines[i + 1].trim().match(datePattern)) {
            section3Data[key] = lines[i + 1].trim();
            i++; // Move i to skip the next line
          }
        }
        break;
      case 'SDREFNUMBER':
      case 'EMPLOYEENO.':
        if (/^\d+$/.test(value)) {
          section3Data[key] = value;
        } else {
          section3Data[key] = '';
        }
        break;
      case 'PAY METHOD':
        if (/^[A-Za-z]+$/.test(value)) {
          section3Data[key] = value;
        } else {
          section3Data[key] = '';
        }
        break;
      default:
        if (value.match(numberPattern)) {
          section3Data[key] = parseFloat(value).toFixed(2);
        } else {
          // Default to '0.00' for numeric keys if the value is not a valid number
          section3Data[key] = '0.00';
          // Adjust index to process the next key-value pair correctly
          if (lines[i + 1] && !lines[i + 1].match(/^\w+:/)) {
            i++;
          }
        }
        break;
    }
  }

  return section3Data;
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
  parse_job_line
};
