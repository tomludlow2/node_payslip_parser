# node_payslip_parser

This uses node, and node package parse-pdf to open PDF files generated from the NHS ESR hub to convert payslips into a format that can be:
- Saved into a database
- Exported into an excel file
- TBA: Added to google drive / google shee


## SETUP
```npm install parse-pdf```

## Node usage - simple process array
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

## Test Split Sections
For more granular understanding of how the content is acquired, within each `try` block above, you can add

```js
    const pdfText = await readPDF(pdfFiles[i]);
    console.log(`\nSplitting sections for PDF ${i + 1}:`);
    const sections = splitSections(pdfText);

    // Parse section 1
    console.log(`\nParsing section 1 for PDF ${i + 1}:`);
    const section_1_lines = parse_section_1(sections.section1);
    console.log(section_1_lines);

    // Output demographic lines
    console.log("\nOutputting Demographic Lines");
    console.log(parse_demographic_line(section_1_lines.arr_2[0]));

    // Output wage lines
    console.log("\nOutputting Wage Lines");
    console.log(parse_wage_line(section_1_lines.arr_2[2]));

    // Output tax lines
    console.log("\nOutputting Tax Lines");
    console.log(parse_tax_line(section_1_lines.arr_2[3]));

    // Output job line
    console.log("\nOutputting Job Line");
    console.log(parse_job_line(section_1_lines.arr_2[1]));

    // Parse section 2 into pay and deductions
    console.log("\nSplitting section 2 into pay and deductions:");
    const payDeductions = split_pay_deductions(sections.section2);
    console.log(payDeductions.deductions);

    // Parse pay lines
    console.log("\nParsing pay lines next:");
    const pay_lines = parse_pay_lines(payDeductions.pay_lines);
    console.log(pay_lines);
    
    // Parse section 3
    console.log("\nParsing section 3 next:");
    const sec3 = parse_section_3(sections.section3);
    console.log(sec3);
```
This will run through the files and output the relevant bits before showing what has been acquired

## Save as JSON
`json_functions.js` contains the relevant functions. Usage:

```js
const {  readPDF,  process_loaded_payslip } = require('./split_sections');
const {savePayslipAsJson} = require('./json_functions');
const pdfFile = "payslips/2018-11.pdf";

const pdfText = await readPDF(pdfFile);
const payslip_data = process_loaded_payslip(pdfText);

savePayslipAsJson(payslip_data);

//Note that destination directory is stored in json_functions.js

````

## Validation
You can check if a payslips is valid with `validate_pdf.js`
See an example in `test_validation.js` which validates all files in the payslips directory.
A single test would be:
```js
const { readPDF } = require('./split_sections');
const { validate_pdf } = require('./validate_pdf');
const pdfFile = "payslips/2018-11.pdf";
const pdfText = await readPDF(path.join(pdfFile));
await validate_pdf(pdfText);

```` 

## Database Insertion
See `DBSETUP.md` for how to setup and structure the postgres database
`database.js` is the postgres database connection tool, it uses environment variables to store the login information

`payslip_insert`:
- The `send_to_postgres` function handles inserting or updating payslip data in a PostgreSQL database. It uses a connection pool (pool) to manage database connections efficiently. The function takes parameters for username, payslipData, and an optional override flag.
- When called, it connects to the database, constructs an INSERT query for the payslips table, and handles conflicts using the file_hash field. If override is true, it updates existing records; otherwise, it avoids duplicates.
- Data from payslipData is converted to JSONB format where needed, and a SHA-256 hash of payslipData ensures data integrity. The function logs successful insertions or updates and errors out if something goes wrong. Finally, it releases the database connection back to the pool.


Important:  `file_hash` is used as a unique field to ensure that the same payslip is added only once. If you pass `true` as parameter 3 in `send_to_postgres` the new one will override the old row. - This is useful for error handling, if there is an error in parsing the data, then you can just edit the json files. 

Example usage:
```js
const send_to_postgres = require('./payslip_insert.js');
const username = "your_username";

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
```
The above version opens the json file to send, but you could just send the output from the parse file

`test_payslip_batch_insert.js` contains a similar script but uses a batch array to insert into the database

## View Database Entries
`npm install cli-table3` to view this nicely
`view_table_basic.js` demonstrates how to output from the table to the command line
The following sql demonstrates how to read the json within json:
```sql
      SELECT id, filename, pay_date, username, total_payments, total_deductions,
             (year_to_date->>'tax_paid')::numeric AS tax_paid
      FROM payslips
      ORDER BY pay_date ASC; -- Order by pay_date ascending (oldest first)
```


## Export to json
`export_to_json.js` can be run from the command line with the argument username to export all rows to separate json files in `exports/username/username_dd_mm_yyyy_hash.json`.
It also exports a function to be used in other scripts, that can be called. 


## Export to csv
`export_to_csv.js` accepts a username as a parameter at cli and outputs the file into a csv in the same directory as the json exports. 