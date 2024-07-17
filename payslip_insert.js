const fs = require('fs');
const pool = require('./database'); // Import the PostgreSQL connection pool
const crypto = require('crypto');

// Function to insert payslip data into PostgreSQL
async function send_to_postgres(username, payslipData, override = false) {
  let client;
  try {
    client = await pool.connect();

    // Construct the INSERT query
    const query = `
      INSERT INTO payslips (
        username, filename, demographics, job, wage, tax,
        deduction_lines, pay_lines, this_period_summary,
        year_to_date, total_payments, total_deductions,
        pay_date, net_pay, file_hash
      ) VALUES (
        $1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb,
        $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb,
        $11::numeric, $12::numeric, $13::date, $14::numeric, $15
      )
      ON CONFLICT (file_hash) 
      ${override ? `
      DO UPDATE SET
        username = EXCLUDED.username,
        filename = EXCLUDED.filename,
        demographics = EXCLUDED.demographics,
        job = EXCLUDED.job,
        wage = EXCLUDED.wage,
        tax = EXCLUDED.tax,
        deduction_lines = EXCLUDED.deduction_lines,
        pay_lines = EXCLUDED.pay_lines,
        this_period_summary = EXCLUDED.this_period_summary,
        year_to_date = EXCLUDED.year_to_date,
        total_payments = EXCLUDED.total_payments,
        total_deductions = EXCLUDED.total_deductions,
        pay_date = EXCLUDED.pay_date,
        net_pay = EXCLUDED.net_pay
      ` : `
      DO NOTHING
      `}
    `;

    // Extract data from payslipData
    const {
      filename, demographics, job, wage, tax,
      deduction_lines, pay_lines, this_period_summary,
      year_to_date, total_payments, total_deductions,
      pay_date, net_pay
    } = payslipData;

    const hash = crypto.createHash('sha256').update(JSON.stringify(payslipData)).digest('hex');

    // Execute the query with parameters
    try {
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
        net_pay,
        hash
      ]);

      if (result.rowCount === 0) {
        console.log(`Payslip data for ${username} already exists and was not inserted.`);
      } else {
        console.log(`Inserted/Updated payslip data for ${username}: ${result.rowCount} rows affected`);
      }


    } catch (error) {
      console.error('Error executing query:', error.message);
      throw error; // Rethrow the error to propagate it upwards
    }

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
