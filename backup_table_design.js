//Backup the tables in 
require('dotenv').config(); // Load environment variables from .env file
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Configure the PostgreSQL connection pool
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
});

// Ensure the backup directory exists
const backupDir = path.join(__dirname, 'backup');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir);
}

// Function to generate the CREATE TABLE statement for each table
async function generateCreateTableSQL() {
  let client;
  try {
    client = await pool.connect();

    // Query to get all tables in public schema
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);

    const tableNames = tablesResult.rows.map(row => row.table_name);

    // Loop through each table and generate CREATE TABLE statement
    for (const tableName of tableNames) {
      try {
        // Query to get columns and constraints for the table
        const createTableResult = await client.query(`
          SELECT 
            'CREATE TABLE ' || table_name || ' (' ||
            string_agg(column_name || ' ' || data_type || 
              CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END, ', ') ||
            COALESCE(
              (
                SELECT ', CONSTRAINT ' || constraint_name || ' ' || constraint_type ||
                       ' (' || string_agg(column_name, ', ') || ')'
                FROM information_schema.constraint_column_usage
                WHERE table_name = cols.table_name
                GROUP BY constraint_name, constraint_type
              ), ''
            ) ||
            ' )' as create_table_sql
          FROM information_schema.columns AS cols
          WHERE table_name = '${tableName}'
          GROUP BY table_name;
        `);

        const createTableSQL = createTableResult.rows[0].create_table_sql;

        // Write the SQL statement to a file
        const filePath = path.join(backupDir, `${tableName}.sql`);
        fs.writeFileSync(filePath, createTableSQL);
        console.log(`Created backup for table: ${tableName}`);
      } catch (err) {
        console.error(`Error generating CREATE TABLE statement for ${tableName}:`, err.message);
      }
    }
  } catch (error) {
    console.error('Error fetching table names:', error.message);
  } finally {
    // Release the client back to the pool
    if (client) {
      client.release();
    }
  }
}

// Run the function
generateCreateTableSQL().then(() => {
  console.log('Backup completed.');
  process.exit(0);
}).catch(err => {
  console.error('Error during backup:', err.message);
  process.exit(1);
});