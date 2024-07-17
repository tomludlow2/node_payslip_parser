const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

console.log(process.env.PGPASSWORD);

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error executing query:', err.message);
  } else {
    console.log('Connected to PostgreSQL server at:', res.rows[0].now);
  }
  
  pool.end(); // Don't forget to end the pool when done
});
