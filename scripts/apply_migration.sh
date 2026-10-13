#!/usr/bin/env bash
# Script to apply the payment_numbers migration. Edit DB_URL or set env var PG_CONN.

set -e

if [ -z "$PG_CONN" ]; then
  echo "Please set PG_CONN (psql connection string) or SUPABASE_CLI_PROJECT_REF to use supabase CLI"
  echo "Example: export PG_CONN=\"postgresql://user:pass@host:5432/dbname\""
  exit 1
fi

echo "Applying SQL migration file: supabase/migrations/20260314_add_payment_numbers.sql"
psql "$PG_CONN" -f "supabase/migrations/20260314_add_payment_numbers.sql"

echo "Migration applied."
