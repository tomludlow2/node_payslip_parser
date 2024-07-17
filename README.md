# php_nhs_payslip_parser

This is moving to a node-base approach and as such is volatile currently. 

*First Git Upload, uses the smalot/pdfparser but using subrepo was too complex so just included the file in the directory structure
Use this to import your NHS Payslips into associative arrays (and then do what you want with them)

## SETUP
```npm install parse-pdf```

## Node usage
```
const fs = require('fs');
const {
  readPDF,
  process_loaded_payslip
} = require('./split_sections');


// Example usage: Replace with your actual PDF file paths
const pdfFiles = [
  'payslips/2018-11.pdf',
  'payslips/2019-02.pdf',
  'payslips/2020-05.pdf',
  'payslips/2022-03.pdf',
  'payslips/2023-06.pdf',
  'payslips/2023-08.pdf',
  // Add more PDF paths as needed
];

console.log("Testing Splitting of NHS Payslip");

// Function to process and split multiple PDFs into sections
async function processPDFs(pdfFiles) {
  for (let i = 0; i < pdfFiles.length; i++) {
    try {      
      console.log("\n\n\tINFO: Attempting ", pdfFiles[i]);
      const pdfText = await readPDF(pdfFiles[i]);
      console.log(process_loaded_payslip(pdfText, pdfFiles[i]));

    } catch (err) {
      console.error(`Error processing PDF ${i + 1}:`, err);
    }
  }
}

// Call the function to process PDFs
processPDFs(pdfFiles);
```





## OLD
## Then
In parse_payslip.php
- change the inlcude to the alt_autoload.php-dist file from wherever you cloned the smalot repo
- add whichever payslips you want to parse to /payslips
- To test:
- - Uncomment line #288 //echo print_r(parse_payslip('payslips/2019-09.pdf', 1));
- - Change the pdf file to one that is in your payslips folder
- run the script

Other files are all to do with inserting them automatically into a database
- Create a database - sql file included for this
- Run:  mv conn_sample.php conn.php
- Run: nano conn.php
- change the login details to your server's login details

## Then:
Run: php run_all.php
This will open all your pdf files in the directory
It will push them all to the server

## Then to get the info from the server:
- php get_payslips.php
- This is an example file that shows you how you might extract various bits from the server
