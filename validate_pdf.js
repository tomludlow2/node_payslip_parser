// Function to perform tests on a PDF text
async function performTests(pdfText) {
  try {
    // Test 1: Consistency in Employee Information
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

// Function to validate PDF text based on tests
async function validate_pdf(pdfText) {
  const testsPassed = await performTests(pdfText);
  
  if (testsPassed) {
    console.log(`PDF passed all tests.`);
    return true;
  } else {
    console.log(`PDF did not pass all tests.`);
    return false;
  }
}

module.exports = { validate_pdf };
