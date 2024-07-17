const path = require('path');
const fs = require('fs');
function savePayslipAsJson(payslipData) {
  // Extract the original filename and directory
  const originalFilename = payslipData.filename;
  const originalDirectory = path.dirname(originalFilename);
  const baseFilename = path.basename(originalFilename, '.pdf');

  // Define the new directory and filename
  const newDirectory = path.join(originalDirectory, '../converted_payslips');
  const newFilename = `${baseFilename}.json`;

  // Ensure the new directory exists
  if (!fs.existsSync(newDirectory)) {
    fs.mkdirSync(newDirectory, { recursive: true });
  }

  // Define the full path for the new JSON file
  const newFilePath = path.join(newDirectory, newFilename);

  // Write the payslip data to the new JSON file
  fs.writeFileSync(newFilePath, JSON.stringify(payslipData, null, 2));

  console.log(`Payslip data saved to ${newFilePath}`);
}

module.exports = {
  savePayslipAsJson
};
