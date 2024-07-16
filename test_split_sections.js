const { readPDF, splitSections, split_pay_deductions, parse_pay_lines, parse_section_3, parse_section_1,parse_demographic_line, parse_wage_line, parse_tax_line, parse_job_line} = require('./split_sections');

// Example usage: Replace with your actual PDF file paths
const pdfFiles = [
  //'payslips/2018-11.pdf',
  //'payslips/2019-02.pdf',
  //'payslips/2020-05.pdf',
  //'payslips/2022-03.pdf',
  //'payslips/2023-06.pdf',
  'payslips/2023-08.pdf',
  // Add more PDF paths as needed
];

console.log("Testing Splitting of NHS Payslip")
// Function to process and split multiple PDFs into sections
async function processPDFs(pdfFiles) {
  for (let i = 0; i < pdfFiles.length; i++) {
    try {
      const pdfText = await readPDF(pdfFiles[i]);
      console.log(`\nSplitting sections for PDF ${i + 1}:`);
      const sections = splitSections(pdfText);

      //console.log(`\nSection 1 for PDF ${i + 1}:`);
      //console.log(sections.section1);
      //console.log(`\nParsing section 1 for PDF ${i + 1}:`);
      const section_1_lines = parse_section_1(sections.section1);
      //console.log(section_1_lines);
      console.log("\nOutputting Demogrpahic Lines");
      console.log(parse_demographic_line(section_1_lines.arr_2[0]));
      console.log("\nOutputting Wage Lines");
      console.log(parse_wage_line(section_1_lines.arr_2[2]));
      console.log("\nOutputting Tax Lines");
      console.log(parse_tax_line(section_1_lines.arr_2[3]));
      console.log("\nOutputting Job Line");
      console.log(parse_job_line(section_1_lines.arr_2[1]));


      //console.log(`\nSection 2 for PDF ${i + 1}:`);
      //console.log(sections.section2);
      //console.log(`\nSection 3 for PDF ${i + 1}:`);
      //console.log(sections.section3);

      console.log("\nSplitting section 2 into pay and deductions:");
      const payDeductions = split_pay_deductions(sections.section2);
      console.log(payDeductions.deductions);

      console.log("\nParsing pay lines next:");
      const pay_lines = parse_pay_lines(payDeductions.pay_lines);
      console.log(pay_lines);

      console.log("\nParsing section 3 next:");
      const sec3 = parse_section_3(sections.section3);
      console.log(sec3);

    } catch (err) {
      console.error(`Error processing PDF ${i + 1}:`, err);
    }
  }
}

// Call the function to process PDFs
processPDFs(pdfFiles);
