//Test Validation

const { readPDF } = require('./split_sections');
const fs = require('fs');
const path = require('path');
const { validate_pdf } = require('./validate_pdf');

const directoryPath = './payslips/tommludgmailcom/processed';

console.log("Testing validation of all pdf files in payslips directory");

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

// Main function to process PDF files
async function processPDFFiles() {
  try {
    const pdfFiles = await listPdfFiles(directoryPath);
    console.log("Generated list of PDF files");

    for (let i = 0; i < pdfFiles.length; i++) {
      try {
        console.log(`\nINFO: Validating File ${pdfFiles[i]}`);
        const pdfText = await readPDF(path.join(directoryPath, pdfFiles[i]));
        await validate_pdf(pdfText);
      } catch (err) {
        console.error(`Error processing PDF ${pdfFiles[i]}:`, err);
      }
    }

  } catch (err) {
    console.error("Error listing PDF files in directory", err);
  }
}

// Execute main function
processPDFFiles();
