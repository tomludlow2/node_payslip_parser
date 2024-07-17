const send_to_postgres = require('./payslip_insert.js');
const username = "tomludlow";

const fs = require("fs");

const testfile = "converted_payslips/2019-11.json";

try {
  const payslipJsonString = fs.readFileSync(testfile, 'utf8');
  payslipJson = JSON.parse(payslipJsonString);

  console.log("Attempting to insert the following data");
  console.log(payslipJson);

  // Insert payslip data
	send_to_postgres(username, payslipJson, true)
	  .then(() => console.log('Payslip data inserted successfully'))
	  .catch(err => console.error('Error inserting payslip data:', err.message));
} catch (error) {
  console.error('Error reading or parsing JSON file:', error.message);
  return;
}