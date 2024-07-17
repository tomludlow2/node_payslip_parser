// database.js

/*
Store environment variables:
npm install dotenv
PGUSER=user
PGHOST=localhost
PGDATABASE=database
PGPASSWORD=your_password_here
PGPORT=5432
*/

require('dotenv').config(); // Load environment variables from .env file
const { Pool } = require('pg');

// Configure the PostgreSQL connection pool
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

module.exports = pool;
