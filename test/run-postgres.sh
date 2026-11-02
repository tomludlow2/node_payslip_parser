#!/usr/bin/env bash
set -euo pipefail
umask 077
test_root="$(mktemp -d /tmp/pay-postgres-XXXXXX)"
pg_bin="${PG_BIN:-/usr/lib/postgresql/15/bin}"
cleanup() { "$pg_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_root"; }
trap cleanup EXIT
"$pg_bin/initdb" -D "$test_root/data" -A trust --no-locale > "$test_root/init.log"
"$pg_bin/pg_ctl" -D "$test_root/data" -l "$test_root/server.log" -o "-k $test_root -p 55439 -h ''" start
export TEST_PG_SOCKET="$test_root"
export TEST_PG_PORT=55439
node --test test/*.test.js
if [ "${BROWSER_SMOKE:-0}" = 1 ]; then node test/browser-smoke.js; fi
