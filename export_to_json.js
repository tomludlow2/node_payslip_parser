//Exports from postgres to json
const fs = require('fs');
const path = require('path');
const pool = require('./database'); // Import the PostgreSQL connection pool

async function exportToJson(username) {
  const exportDirectory = path.join(__dirname, 'exports', username);
  let client; // Declare client variable in outer scope

  try {
    // Create directory if it doesn't exist
    fs.mkdirSync(exportDirectory, { recursive: true });

    // Connect to PostgreSQL
    client = await pool.connect();

    // Query to fetch all payslips for the user
    const query = `
      SELECT username, pay_date, file_hash, payslip_data
      FROM (
        SELECT username, pay_date, LEFT(md5(filename), 4) as file_hash, to_jsonb(p) as payslip_data
        FROM payslips p
        WHERE username = $1
      ) as payslips_json
    `;

    const result = await client.query(query, [username]);

    // Export each row to JSON file
    result.rows.forEach((row, index) => {
      const { username, pay_date, file_hash, payslip_data } = row;
      const formattedDate = formatDate(pay_date); // Format pay_date as dd_mm_yyyy
      const filename = `${username}_${formattedDate}_${file_hash}.json`;
      const filePath = path.join(exportDirectory, filename);
      fs.writeFileSync(filePath, JSON.stringify(payslip_data, null, 2));
      console.log(`Exported row ${index + 1} to ${filename}`);
    });

    console.log(`Export completed for ${result.rowCount} payslips`);
  } catch (error) {
    console.error('Error exporting to JSON:', error.message);
    throw error; // Rethrow the error to propagate it upwards if needed
  } finally {
    // Release the client back to the pool
    if (client) {
      client.release();
    }
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0'); // January is 0!
  const yyyy = date.getFullYear();
  return `${dd}_${mm}_${yyyy}`;
}

// Export the function if not called from command line
if (!module.parent) {
  // Usage example: node export_to_json.js tomludlow
  if (process.argv.length < 3) {
    console.error('Please provide a username as an argument');
    process.exit(1);
  }

  const username = process.argv[2];
  exportToJson(username);
} else {
  // Export the function for use in other modules
  module.exports = exportToJson;
}
