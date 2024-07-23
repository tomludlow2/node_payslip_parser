const { Pool } = require('pg');
const pool = require('../database'); // Import the PostgreSQL connection pool

async function load_single_payslip(username, payslipId) {
  const client = await pool.connect();
  try {
    // Query to fetch payslip details based on username and payslip_id
    const query = `
      SELECT *
      FROM payslips
      WHERE id = $1 AND username = $2;
    `;

    const result = await client.query(query, [payslipId, username]);

    if (result.rowCount === 0) {
      throw new Error('Payslip not found');
    }
    console.log("Information: Results query: \n\nRESULT STARTS\n");
    console.log(result.rows[0]);
    console.log("\nRESULT ENDS\n")
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching payslip:', error.message);
    throw error; // Propagate the error to be handled by the route handler
  } finally {
    client.release();
  }
}

module.exports = { load_single_payslip };
