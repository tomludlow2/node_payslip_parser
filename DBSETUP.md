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


6. Create the users table:
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255), -- Will be NULL for OAuth users
    provider VARCHAR(50), -- e.g., 'google'
    provider_id VARCHAR(255), -- The user's OAuth ID from the provider
    oauth_token TEXT, -- OAuth token for third-party authentication
    user_category VARCHAR(50) NOT NULL DEFAULT 'tier_2', -- User role or tier
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Then
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

```

Then
```sql
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

7. Bits to be mindful of:
- Environment variables. 
- Can either be stored in .env as:
```
PGHOST=localhost
PGPORT=5432
PGNAME=payslips_db
PGUSER=your_db_user
PGPASSWORD=your_db_password
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

or in the service file: `/etc/systemd/system/payslip_server.service`
```
[Unit]
Description=Payslips Server
After=network.target

[Service]
User=your_user # Replace with your user, e.g., www-data or a specific user
WorkingDirectory=/var/www/pay
ExecStart=/usr/bin/node /var/www/pay/server.js

# Environment variables
PGHOST=localhost
PGPORT=5432
PGNAME=payslips_db
PGUSER=your_db_user
PGPASSWORD=your_db_password
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# Restart policy
Restart=always
RestartSec=10

# Permissions settings
PermissionsStartOnly=true

[Install]
WantedBy=multi-user.target
```
With the usual:
```
sudo systemctl daemon-reload
sudo systemctl start payslips_server.service
sudo systemctl enable payslips_server.service
sudo systemctl status payslips_server.service
```


## Debugging
Errors I've faced that needed sorting:
- Sort out database permissions

`psql -U postgres -d payslips_db`
```
GRANT ALL PRIVILEGES ON TABLE payslips TO payslip_user;
GRANT ALL PRIVILEGES ON TABLE users TO payslip_user;

```

You might need to sort out logging in with a different postgres user to the one you're shelling with:
In psql: `SHOW hba_file;`
`sudo nano /etc/postgresql/12/main/pg_hba.conf` - change to hba_file
Find line that is `local    all         all         peer` and change `peer` to `md5`   
Then
`sudo systemctl restart postgresql`

Finally you might need to sort out update functions:
```sql
GRANT USAGE, SELECT ON SEQUENCE users_id_seq TO payslip_user;
GRANT USAGE, SELECT ON SEQUENCE payslips_id_seq TO payslip_user;
```
