const {
  readPDF,
  splitSections,
  split_pay_deductions,
  parse_pay_lines,
  parse_section_3,
  parse_section_1,
  parse_demographic_line,
  parse_wage_line,
  parse_tax_line,
  parse_job_line,
  process_loaded_payslip
} = require('./split_sections');

const {savePayslipAsJson} = require('./json_functions');
// Example usage: Replace with your actual PDF file paths
const pdfFiles = [
  'payslips/tommludgmailcom/processed/2023-07.pdf'/*,
  'payslips/tommludgmailcom/processed/2023-07.pdf'*/
  // Add more PDF paths as needed
];

console.log("Testing Splitting of NHS Payslip");


// Function to process and split multiple PDFs into sections
async function processPDFs(pdfFiles) {
  for (let i = 0; i < pdfFiles.length; i++) {
    try {
      const pdfText = await readPDF(pdfFiles[i]);
      console.log(`\nSplitting sections for PDF ${i + 1}:`);
      const sections = splitSections(pdfText);
      console.log("\n\tRAW DATA FOLLOWS\n");
      console.log(pdfText);

      // Parse section 1
      console.log(`\nParsing section 1 for PDF ${i + 1}:`);
      const section_1_lines = parse_section_1(sections.section1);
      //console.log(section_1_lines);

      // Output demographic lines
      console.log("\nOutputting Demographic Lines");
      //console.log(parse_demographic_line(section_1_lines.arr_2[0]));

      // Output wage lines
      console.log("\nOutputting Wage Lines");
      //console.log(parse_wage_line(section_1_lines.arr_2[2]));

      // Output tax lines
      console.log("\nOutputting Tax Lines");
      //console.log(parse_tax_line(section_1_lines.arr_2[3]));

      // Output job line
      console.log("\nOutputting Job Line");
      //console.log(parse_job_line(section_1_lines.arr_2[1]));

      // Parse section 2 into pay and deductions
      console.log("\nSplitting section 2 into pay and deductions:");
      const payDeductions = split_pay_deductions(sections.section2);
      console.log(payDeductions.deductions);

      // Parse section 3
      console.log("\nParsing section 3 next:");
      const sec3 = parse_section_3(sections.section3);
      console.log(sec3);

      // Parse pay lines
      console.log("\nParsing pay lines next:");
      const pay_lines = parse_pay_lines(payDeductions.pay_lines, parseFloat(parseFloat(sec3['TOTAL PAYMENTS']).toFixed(2)));
      console.log(pay_lines);
      
      
      
      /*
      console.log("\n\n\tINFO: Attempting ", pdfFiles[i]);
      const pdfText = await readPDF(pdfFiles[i]);
      const payslip_data = process_loaded_payslip(pdfText, pdfFiles[i])
      console.log(payslip_data);
      savePayslipAsJson(payslip_data);*/



    } catch (err) {
      console.error(`Error processing PDF ${i + 1}:`, err);
    }
  }
}

// Call the function to process PDFs
processPDFs(pdfFiles);
