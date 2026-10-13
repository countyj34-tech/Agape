#!/usr/bin/env bash
set -euo pipefail

# Deploy the `admin-signup` function using the Supabase CLI.
# Requires: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF environment variables set.

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF must be set in the environment." >&2
  echo "Example: export SUPABASE_ACCESS_TOKEN=...; export SUPABASE_PROJECT_REF=your-project-ref" >&2
  exit 1
fi

echo "Installing supabase CLI (local)..."
npm install --no-audit --no-fund supabase@latest

echo "Deploying admin-signup function to project: ${SUPABASE_PROJECT_REF}"
npx supabase functions deploy admin-signup --project-ref "${SUPABASE_PROJECT_REF}"

echo "Deployment finished."
