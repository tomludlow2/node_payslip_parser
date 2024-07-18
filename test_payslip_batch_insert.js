//Test batch insertion
const send_to_postgres = require('./payslip_insert.js');
const fs = require("fs");

const username = "tomludlow";
const test_files = [
  "converted_payslips/2018-10.json",
  "converted_payslips/2018-11.json",
  "converted_payslips/2019-07.json",
  "converted_payslips/2019-10.json",
  "converted_payslips/2020-04.json",
  "converted_payslips/2020-09.json",
  "converted_payslips/2020-11.json",
  "converted_payslips/2021-01.json",
  "converted_payslips/2021-06.json",
  "converted_payslips/2022-05.json",
  "converted_payslips/2021-12.json"
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
