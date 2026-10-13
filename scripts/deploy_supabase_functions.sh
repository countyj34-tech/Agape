#!/usr/bin/env bash
set -euo pipefail

# Deploy helper (Bash)
# Usage:
#   SUPABASE_PROJECT_REF=your-ref SUPABASE_SERVICE_ROLE_KEY=your_key ./scripts/deploy_supabase_functions.sh
#   or run without env vars and you'll be prompted.

PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found. Install from https://supabase.com/docs/guides/cli"
  exit 1
fi

if [ -z "$PROJECT_REF" ]; then
  read -rp "Enter Supabase project-ref: " PROJECT_REF
fi
echo "Project ref: $PROJECT_REF"

if [ -z "$SERVICE_KEY" ]; then
  read -rsp "Enter SUPABASE_SERVICE_ROLE_KEY (leave empty to skip): " SERVICE_KEY
  echo
fi

if [ -n "$SERVICE_KEY" ]; then
  echo "Setting secret SUPABASE_SERVICE_ROLE_KEY..."
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" --project-ref "$PROJECT_REF"
else
  echo "Skipping secret set. Ensure function runtime has SUPABASE_SERVICE_ROLE_KEY."
fi

echo "Deploying functions admin-sync-staff and admin-signup..."
supabase functions deploy admin-sync-staff --project-ref "$PROJECT_REF"
supabase functions deploy admin-signup --project-ref "$PROJECT_REF"

echo "Applying supabase-rls-staff.sql..."
if [ -f ./supabase-rls-staff.sql ]; then
  supabase db query --project-ref "$PROJECT_REF" < ./supabase-rls-staff.sql
else
  echo "supabase-rls-staff.sql not found in repository root."
fi

echo "Done. Review CLI output for success or errors."
