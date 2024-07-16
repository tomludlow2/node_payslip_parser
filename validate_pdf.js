const fs = require('fs');
const PDFParser = require('pdf-parse');

console.log("Validating PDFs");
//Comment
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

// Function to perform tests on a PDF text
async function performTests(pdfText) {
  try {
    // Test 1: Consistency in Employee Information
    //const test1 = /EMPLOYEE NAME[\s\S]*?EMPLOYEENO\.[\s\S]*?PAY DATE/g.test(pdfText);
    const test1 = /ASSIGNMENT NUMBER\s*EMPLOYEE NAME[\s\S]*?DEPARTMENT\s*JOB TITLE[\s\S]*?PAYSCALE DESCRIPTION/g.test(pdfText);
    
    // Test 2: Verification of Pay and Deductions Sections
    const test2 = /PAYANDALLOWANCES[\s\S]*?DEDUCTIONS/g.test(pdfText);
    
    // Test 3: Validation of Tax and NI Details
    const test3 = /TAX OFFICE NAME[\s\S]*?TAX OFFICE REF[\s\S]*?NI NUMBER/g.test(pdfText);
    
    // Test 4: Summary Accuracy of Gross Pay and Deductions
    const test4 = /GROSSPAY[\s\S]*?NET PAY[\s\S]*?MESSAGES FROM EMPLOYER/g.test(pdfText);
    
    // Test 5: Footer Information Consistency
    const test5 = /SDREFNUMBER[\s\S]*?PAY METHOD[\s\S]*?MESSAGES FROM EMPLOYER/g.test(pdfText);
    
    // Log the results of the tests
    console.log(`Test 1 (Employee Information Consistency): ${test1}`);
    console.log(`Test 2 (Pay and Deductions Sections): ${test2}`);
    console.log(`Test 3 (Tax and NI Details): ${test3}`);
    console.log(`Test 4 (Summary Accuracy): ${test4}`);
    console.log(`Test 5 (Footer Information Consistency): ${test5}`);
    
    // Return true if all tests pass
    return test1 && test2 && test3 && test4 && test5;

  } catch (err) {
    console.error('Error performing tests:', err);
    return false;
  }
}

// Example usage: Replace with your actual PDF file paths
const pdfFiles = [
  'payslips/2018-11.pdf',
  'payslips/2019-02.pdf',
  'payslips/2020-05.pdf',
  'payslips/2022-03.pdf',
  'payslips/2023-06.pdf',
  // Add more PDF paths as needed
];

// Function to validate multiple PDFs
async function validatePDFs(pdfFiles) {
  for (let i = 0; i < pdfFiles.length; i++) {
    try {
      const pdfText = await readPDF(pdfFiles[i]);
      console.log(`\nPerforming tests for PDF ${i + 1}:`);
      const testsPassed = await performTests(pdfText);
      
      if (testsPassed) {
        console.log(`PDF ${i + 1} passed all tests.`);
      } else {
        console.log(`PDF ${i + 1} did not pass all tests.`);
      }
      
    } catch (err) {
      console.error(`Error processing PDF ${i + 1}:`, err);
    }
  }
}

// Call the function to validate PDFs
validatePDFs(pdfFiles);
