//Tests processing all files in payslip


const {
  readPDF,
  process_loaded_payslip
} = require('./split_sections');

const fs = require('fs');
const path = require('path');
const directoryPath = './payslips';
const {savePayslipAsJson} = require('./json_functions');

console.log("Testing import of all pdf files in payslips directory");

// Function to list all PDF files in the directory
function listPdfFiles(directoryPath) {
  return new Promise((resolve, reject) => {
    fs.readdir(directoryPath, (err, files) => {
      if (err) {
        reject(err);
        return;
      }

      // Filter PDF files
      const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

      resolve(pdfFiles);
    });
  });
}


//Now list them, and run the script for each
listPdfFiles(directoryPath)
	.then(pdfFiles => {
		console.log("Generated list of PDF files");
		processPDFs(pdfFiles);
	})	
	.catch(err => {
		console.log("Error listing PDF files in directory", err);
	})

async function processPDFs(pdfFiles) {
  for (let i = 0; i < pdfFiles.length; i++) {
    try {  
      console.log("\n\n\tINFO: Processing Files ", pdfFiles[i]);
      const pdfText = await readPDF(directoryPath + "/" + pdfFiles[i]);
      const payslip_data = process_loaded_payslip(pdfText, pdfFiles[i])
      //console.log(payslip_data);
      savePayslipAsJson(payslip_data);
    } catch (err) {
      console.error(`Error processing PDF ${i + 1}:`, err);
    }
  }
}