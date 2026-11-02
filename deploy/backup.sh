#!/usr/bin/env bash
set -euo pipefail
umask 077
# Supply PostgreSQL credentials through PGPASSFILE or standard PG* variables.
backup_dir="${1:?Usage: deploy/backup.sh /absolute/backup/directory}"
mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump --format=custom --file="$backup_dir/payslips-$stamp.dump"
tar -czf "$backup_dir/payslips-$stamp.tar.gz" -C /var/www/pay payslips
printf 'Backup complete: %s\n' "$backup_dir"
