//Test batch insertion
const send_to_postgres = require('./payslip_insert.js');
const fs = require("fs");

const username = "tomludlow";
const test_files = [
  "converted_payslips/2018-08.json",
  "converted_payslips/2018-12.json",
  "converted_payslips/2019-06.json",
  "converted_payslips/2019-11.json",
  "converted_payslips/2020-03.json",
  "converted_payslips/2020-08-AUH.json",
  "converted_payslips/2020-12.json",
  "converted_payslips/2021-03.json",
  "converted_payslips/2021-08.json"
  // Add more files as needed
];

async function insertPayslipBatch() {
  try {
    for (let testfile of test_files) {
      const payslipJsonString = fs.readFileSync(testfile, 'utf8');
      const payslipJson = JSON.parse(payslipJsonString);

      console.log(`Attempting to insert data from file: ${testfile}`);
      console.log(payslipJson);

      // Insert payslip data
      await send_to_postgres(username, payslipJson, true);
      console.log(`Payslip data from file ${testfile} inserted successfully`);
    }

    console.log("Batch insertion completed successfully");
  } catch (error) {
    console.error('Error inserting payslip data:', error.message);
  }
}

// Execute the batch insertion function
insertPayslipBatch();
