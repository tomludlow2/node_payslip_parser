// view_table_basic.js

const { Pool } = require('pg');
const Table = require('cli-table3');
const pool = require('./database'); // Import the PostgreSQL connection pool

async function viewTableBasic() {
  const client = await pool.connect();

  try {
    // Query to fetch required fields from payslips table, including tax_paid from year_to_date JSONB field
    const query = `
      SELECT id, filename, pay_date, username, total_payments, total_deductions,
             (year_to_date->>'tax_paid')::numeric AS tax_paid
      FROM payslips
      ORDER BY pay_date ASC; -- Order by pay_date ascending (oldest first)
    `;

    const result = await client.query(query);

    // Print total rows
    console.log(`Total Rows: ${result.rowCount}`);

    // Create a table instance for formatting
    const table = new Table({
      head: ['ID', 'Filename', 'Pay Date', 'Username', 'Total Payments', 'Total Deductions', 'Tax Paid']
    });

    // Populate the table with fetched rows
    result.rows.forEach(row => {
      table.push([
        row.id,
        row.filename,
        formatDate(row.pay_date), // Format pay_date if necessary
        row.username,
        row.total_payments,
        row.total_deductions,
        row.tax_paid // Include tax_paid in the table
      ]);
    });

    // Print the formatted table
    console.log(table.toString());
  } catch (error) {
    console.error('Error fetching and printing data:', error.message);
  } finally {
    // Release the client back to the pool
    client.release();
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0'); // January is 0!
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// Call the function to view the table
viewTableBasic();
