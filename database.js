// database.js

const { Pool } = require('pg');

// Configure the PostgreSQL connection pool
const pool = new Pool({
  user: 'tom',
  host: 'localhost',
  database: 'payslips_db',
  password: '2nsirFejfos!',
  port: 5432, // default PostgreSQL port
});

module.exports = pool;