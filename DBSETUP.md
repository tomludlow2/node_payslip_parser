# How to setup the postgres database
Setting Up PostgreSQL with Node.js
1. Install PostgreSQL on Debian
```sh
sudo apt update
sudo apt install postgresql postgresql-contrib
```
2. Set Up the Database
Log into PostgreSQL:

```sh
sudo -i -u postgres
psql
```
Create a database and user:

```sql
CREATE DATABASE payslips_db;
CREATE USER payslip_user WITH ENCRYPTED PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE payslips_db TO payslip_user;
```
3. Create Tables
Exit psql and create tables:

```sh
sudo -i -u postgres
psql payslips_db
```

4. Define tables:
```sql
CREATE TABLE payslips (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    demographics JSONB,
    job JSONB,
    wage JSONB,
    tax JSONB,
    deduction_lines JSONB,
    pay_lines JSONB,
    this_period_summary JSONB,
    year_to_date JSONB,
    total_payments NUMERIC(12, 2),
    total_deductions NUMERIC(12, 2),
    pay_date DATE,
    net_pay NUMERIC(12, 2),
    file_hash VARCHAR(64) UNIQUE
);

```

5. Add Index:
```sql
CREATE INDEX idx_payslips_username ON payslips (username);
```