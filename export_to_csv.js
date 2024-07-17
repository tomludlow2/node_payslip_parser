const fs = require('fs');
const path = require('path');
const pool = require('./database'); // Import the PostgreSQL connection pool
const { parse } = require('json2csv');

// Define fields to export from the database table
const fields_to_export = [
  'id', 'filename', 'pay_date', 'username', 'total_payments', 'total_deductions',
  "(year_to_date->>'tax_paid')::numeric AS tax_paid" // Extract tax_paid from year_to_date JSONB
];

async function exportToCsv(username) {
  const exportDirectory = path.join(__dirname, 'exports', username);
  const currentDate = new Date();
  const formattedDateTime = formatDate(currentDate);
  const filename = `${username}_${formattedDateTime}.csv`;
  const filePath = path.join(exportDirectory, filename);

  let client; // Declare client variable in outer scope

  try {
    // Create directory if it doesn't exist
    fs.mkdirSync(exportDirectory, { recursive: true });

    // Connect to PostgreSQL
    client = await pool.connect();

    // Construct the SQL query dynamically
    const query = `
      SELECT ${fields_to_export.join(', ')}
      FROM payslips
      WHERE username = $1
      ORDER BY pay_date ASC
    `;

    const result = await client.query(query, [username]);
    console.log( result );

    // Convert result rows to CSV format
    // Convert rows to CSV format
    const csvData = parse(result.rows);

    // Write CSV data to file
    fs.writeFileSync(filePath, csvData);

    // Write CSV data to file
    fs.writeFileSync(filePath, csvData);

    console.log(`Exported data for ${username} to ${filePath}`);
  } catch (error) {
    console.error('Error exporting to CSV:', error.message);
    throw error; // Rethrow the error to propagate it upwards if needed
  } finally {
    // Release the client back to the pool
    if (client) {
      client.release();
    }
  }
}

function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0'); // January is 0!
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${dd}_${mm}_${yyyy}_${hh}_${min}_${ss}`;
}

function convertToCsv(rows, fields) {
  // Ensure proper CSV formatting based on fields_to_export
  const header = fields.map(field => {
    // Handle aliasing and CSV quoting if necessary
    return typeof field === 'string' ? `"${field.replace(/"/g, '""')}"` : field;
  }).join(',');

  const rowsCsv = rows.map(row => fields.map(field => {
    const value = row[field];
    return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(',')).join('\n');

  return `${header}\n${rowsCsv}`;
}

// Usage example: node export_to_csv.js tomludlow
if (process.argv.length < 3) {
  console.error('Please provide a username as an argument');
  process.exit(1);
}

const username = process.argv[2];
exportToCsv(username);
