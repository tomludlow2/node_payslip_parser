const fs = require('fs');
const pool = require('./database'); // Import the PostgreSQL connection pool

// Function to insert payslip data into PostgreSQL
async function send_to_postgres(username, payslipData) {
  let client;
  try {
    client = await pool.connect();

    // Construct the INSERT query
    const query = `
      INSERT INTO payslips (
        username, filename, demographics, job, wage, tax, deduction_lines, pay_lines, balances
      ) VALUES (
        $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb
      )
    `;

    // Extract data from payslipData
    const { filename, demographics, job, wage, tax, deduction_lines, pay_lines, balances } = payslipData;

    console.log('Inserting payslip data:', payslipData); // Log payslipData to verify format

    // Execute the query with parameters
    const result = await client.query(query, [
      username,
      filename,
      JSON.stringify(demographics),
      JSON.stringify(job),
      JSON.stringify(wage),
      JSON.stringify(tax),
      JSON.stringify(deduction_lines),
      JSON.stringify(pay_lines),
      JSON.stringify(balances),
    ]);

    console.log(`Inserted payslip data for ${username}: ${result.rowCount} rows inserted`);
  } catch (error) {
    console.error('Error inserting payslip data:', error.message);
  } finally {
    // Release the client back to the pool
    if (client) {
      client.release();
    }
  }
}

module.exports = send_to_postgres;
