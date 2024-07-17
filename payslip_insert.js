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
        username, filename, demographics, job, wage, tax,
        deduction_lines, pay_lines, this_period_summary,
        year_to_date, total_payments, total_deductions,
        pay_date, net_pay
      ) VALUES (
        $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb,
        $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb,
        $11::numeric, $12::numeric, $13::date, $14::numeric
      )
    `;

    // Extract data from payslipData
    const {
      filename, demographics, job, wage, tax,
      deduction_lines, pay_lines, this_period_summary,
      year_to_date, total_payments, total_deductions,
      pay_date, net_pay
    } = payslipData;

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
      JSON.stringify(this_period_summary),
      JSON.stringify(year_to_date),
      total_payments,
      total_deductions,
      new Date(pay_date), // Ensure pay_date is converted to a Date object
      net_pay
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
