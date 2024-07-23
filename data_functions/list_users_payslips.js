//list_users_payslips
const { Pool } = require('pg');
const pool = require('../database'); // Import the PostgreSQL connection pool

async function list_users_payslips(username) {
  const client = await pool.connect();
  console.log(`Connecting to the pool and requesting the payslips for ${username}`);

  try {
    // SQL query to fetch required fields from payslips table, including job_title and department from job JSONB field
    const query = `
      SELECT filename, pay_date, 
             (job->>'job_title') AS job_title,
             (job->>'department') AS department,
             id as payslip_id 
      FROM payslips
      WHERE username = $1
      ORDER BY pay_date ASC; -- Order by pay_date ascending (oldest first)
    `;

    const result = await client.query(query, [username]);

    // Return the data in a structured format
    return {
      success: true,
      data: result.rows,
      message: `Total Rows: ${result.rowCount}`
    };
  } catch (error) {
    // Return error in a structured format
    return {
      success: false,
      error: error.message
    };
  } finally {
    // Release the client back to the pool
    client.release();
  }
}

// Export the function as a module
module.exports = {list_users_payslips}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0'); // January is 0!
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
