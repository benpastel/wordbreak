#!/usr/bin/env bash
# Read-only access to the production database from this machine, for poking at it
# with any query you like without being able to change anything.
#
#   scripts/setup-readonly-db.sh            # first time: everything below
#   scripts/setup-readonly-db.sh --ip-only  # later, when this machine's IP changes
#
# 1. Lets this machine's current public IP through the database's allow list
#    (replacing whatever single entry was there; Render-internal access is unaffected).
# 2. Creates (or resets) the role wordbreak_ro: it can read every table, every
#    transaction is read-only, and runaway or idle queries are cut off.
# 3. Saves its login in ~/.pgpass and ~/.pg_service.conf, so afterwards:
#
#      psql service=wordbreak-ro -c "select count(*) from matches"
#
# The owner's login is only ever used by `render psql` for step 2 and is never saved.
# Needs the Render CLI logged in, and psql (brew install libpq).

set -euo pipefail

DB_ID=dpg-dbfnf21srm7s73fkcqg0-a
HOST="$DB_ID.ohio-postgres.render.com"
DB_NAME=wordbreak
ROLE=wordbreak_ro
SERVICE=wordbreak-ro

# libpq is keg-only in Homebrew, so its psql is not on PATH by default.
export PATH="/opt/homebrew/opt/libpq/bin:/usr/local/opt/libpq/bin:$PATH"
command -v psql >/dev/null || { echo "psql not found: brew install libpq" >&2; exit 1; }

ip="$(curl -fsS --max-time 10 https://api.ipify.org)"
echo "Allowing $ip/32 through the database's allow list..."
render postgres update "$DB_ID" --ip-allow-list "cidr=$ip/32,description=$(hostname -s) read-only" --confirm -o text >/dev/null
[ "${1:-}" = "--ip-only" ] && { echo "Done."; exit 0; }

# The allow list takes a moment to apply.
sleep 10

password="$(openssl rand -hex 24)"
echo "Creating role $ROLE..."
render psql "$DB_ID" --confirm -o text -c "
  do \$\$ begin
    if not exists (select from pg_roles where rolname = '$ROLE') then create role $ROLE login; end if;
  end \$\$;
  alter role $ROLE with login password '$password' connection limit 3;
  grant pg_read_all_data to $ROLE;
  alter role $ROLE set default_transaction_read_only = on;
  alter role $ROLE set statement_timeout = '15s';
  alter role $ROLE set idle_in_transaction_session_timeout = '60s';
" >/dev/null

echo "Saving its login in ~/.pgpass and ~/.pg_service.conf..."
touch ~/.pgpass ~/.pg_service.conf
chmod 600 ~/.pgpass
# Replace rather than append, so running this again leaves one entry each.
grep -v "^$HOST:5432:$DB_NAME:$ROLE:" ~/.pgpass > ~/.pgpass.tmp || true
echo "$HOST:5432:$DB_NAME:$ROLE:$password" >> ~/.pgpass.tmp
mv ~/.pgpass.tmp ~/.pgpass && chmod 600 ~/.pgpass
awk -v s="[$SERVICE]" '$0 == s { skip = 1; next } /^\[/ { skip = 0 } !skip' ~/.pg_service.conf > ~/.pg_service.conf.tmp
cat >> ~/.pg_service.conf.tmp <<EOF
[$SERVICE]
host=$HOST
port=5432
dbname=$DB_NAME
user=$ROLE
sslmode=require
EOF
mv ~/.pg_service.conf.tmp ~/.pg_service.conf

echo "Checking..."
psql "service=$SERVICE" -Atc "select 'connected as ' || current_user || ', read-only: ' || current_setting('default_transaction_read_only')"
if psql "service=$SERVICE" -qc "create table should_not_exist ()" 2>/dev/null; then
  echo "WARNING: a write succeeded; the role is not read-only" >&2
  exit 1
fi
echo "Writes are refused. Done: psql service=$SERVICE"
