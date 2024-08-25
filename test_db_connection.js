const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

console.log('Connecting to PostgreSQL with user:', process.env.PGUSER);

pool.query('SELECT NOW() AS now', (err, res) => {
  if (err) {
    console.error('Error executing query:', err.message);
  } else {
    console.log('Connected to PostgreSQL server. Current time:', res.rows[0].now);
    
    // Test connection to 'users' table
    pool.query('SELECT * FROM users LIMIT 1', (err, res) => {
      if (err) {
        console.error('Error querying users table:', err.message);
      } else if (res.rows.length > 0) {
        console.log('Successfully queried users table. Sample row:', res.rows[0]);
      } else {
        console.log('Users table is empty.');
      }
      
      pool.end(); // Don't forget to end the pool when done
    });
  }
});
