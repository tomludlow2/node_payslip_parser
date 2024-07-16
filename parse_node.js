const fs = require('fs');
const pdf = require('pdf-parse');

// Path to the PDF file
const pdfPath = 'payslips/2020-05.pdf';

// Read the PDF file into a buffer
let dataBuffer = fs.readFileSync(pdfPath);

// Parse the PDF file
pdf(dataBuffer).then(function(data) {
    // data.text holds the extracted text content
    console.log(data.text);
    //console.log(extractAssignmentInfo(data.text));
}).catch(function(error) {
    console.error('Error parsing PDF:', error);
});

// Function to extract assignment number and employee name from text
function extractAssignmentInfo(text) {
    // Split the text into lines
    const lines = text.split('\n').map(line => line.trim());

    let assignmentNumber, employeeName;

    // Define a function to check if a line matches the expected format
    function lineMatchesFormat(line) {
        // Customize this condition based on your specific expected format
        return /[0-9]{7,}\t([a-zA-Z]|\.| ){0,}\t([a-zA-Z]|\.| ){0,}\tDEPARTMENT/.test(line);
    }

    // Find the index of the line that matches the expected format
    const index = lines.findIndex(lineMatchesFormat);

    if (index !== -1 && index + 1 < lines.length) {
        // Extract assignment number and employee name from the matched line
        const matchedLine = lines[index];
        const nextLine = lines[index + 1];

        // Extract assignment number
        const assignmentMatch = matchedLine.match(/^\d+/);
        assignmentNumber = assignmentMatch ? parseInt(assignmentMatch[0], 10) : undefined;

        // Extract employee name
        const employeeNameMatch = nextLine.match(/^[A-Z]+\. [A-Z]+/);
        employeeName = employeeNameMatch ? employeeNameMatch[0] : undefined;
    }

    return { assignmentNumber, employeeName };
}
