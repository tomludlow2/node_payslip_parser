const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = require('./database'); // Import the PostgreSQL connection pool

// Define fields to export from the database table
const fields_to_export = ['id', 'filename', 'pay_date', 'username', 'total_payments', 'total_deductions', 'demographics->>tax_paid'];

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

    // Query to fetch all payslips for the user
    const query = `
      SELECT ${fields_to_export.join(', ')}
      FROM payslips
      WHERE username = $1
    `;

    const result = await client.query(query, [username]);

    // Convert result rows to CSV format
    const csvData = convertToCsv(result.rows);

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
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${dd}_${mm}_${yyyy}_${hh}_${ss}`;
}

function convertToCsv(rows) {
  const header = fields_to_export.join(',');
  const csvRows = rows.map(row => fields_to_export.map(field => {
    if (field.includes('->')) {
      const [jsonbField, nestedField] = field.split('->>');
      return row[jsonbField] ? row[jsonbField][nestedField] : '';
    }
    return row[field];
  }).join(','));
  return `${header}\n${csvRows.join('\n')}`;
}

// Export the function for use in other modules or command line
module.exports = exportToCsv;

// Usage example: node export_to_csv.js tomludlow
if (!module.parent) {
  if (process.argv.length < 3) {
    console.error('Please provide a username as an argument');
    process.exit(1);
  }
  
  const username = process.argv[2];
  exportToCsv(username);
}
