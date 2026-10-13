<#
Deploy helper (PowerShell)

Usage:
  # Option A: rely on environment variables
  $env:SUPABASE_PROJECT_REF = 'your-project-ref'
  $env:SUPABASE_SERVICE_ROLE_KEY = 'your-service-role-key'
  .\scripts\deploy_supabase_functions.ps1

  # Option B: run and you will be prompted for missing values
  .\scripts\deploy_supabase_functions.ps1

This script:
  - sets the SUPABASE_SERVICE_ROLE_KEY secret for functions
  - deploys `admin-sync-staff` and `admin-signup` functions
  - applies `supabase-rls-staff.sql` via the Supabase CLI

Note: run locally; do NOT paste secrets into chat.
#>

param(
  [string]$ProjectRef = $env:SUPABASE_PROJECT_REF,
  [string]$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
)

Write-Host "Supabase deploy helper: deploying functions and applying RLS SQL"

if (!(Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Error "supabase CLI not found. Install from https://supabase.com/docs/guides/cli"
  exit 1
}

if (-not $ProjectRef -or $ProjectRef.Trim().Length -eq 0) {
  $ProjectRef = Read-Host "Enter Supabase project-ref (e.g. abcd1234...)"
}

Write-Host "Project ref: $ProjectRef"

if (-not $ServiceRoleKey -or $ServiceRoleKey.Trim().Length -eq 0) {
  Write-Host "You can set SUPABASE_SERVICE_ROLE_KEY in the environment or paste it now (input hidden)."
  $secure = Read-Host "Enter SUPABASE_SERVICE_ROLE_KEY (leave blank to skip setting secret)" -AsSecureString
  if ($secure.Length -gt 0) {
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    Write-Host "Setting SUPABASE_SERVICE_ROLE_KEY secret for project..."
    supabase secrets set SUPABASE_SERVICE_ROLE_KEY="$plain" --project-ref $ProjectRef
    # clear variable
    $plain = $null
  } else {
    Write-Host "Skipping secret set. Ensure function runtime has SUPABASE_SERVICE_ROLE_KEY."
  }
} else {
  Write-Host "Setting SUPABASE_SERVICE_ROLE_KEY from environment variable..."
  supabase secrets set SUPABASE_SERVICE_ROLE_KEY="$ServiceRoleKey" --project-ref $ProjectRef
}

Write-Host "Deploying functions: admin-sync-staff, admin-signup"
supabase functions deploy admin-sync-staff --project-ref $ProjectRef
supabase functions deploy admin-signup --project-ref $ProjectRef

Write-Host "Applying RLS SQL: supabase-rls-staff.sql"
if (Test-Path "./supabase-rls-staff.sql") {
  Get-Content ./supabase-rls-staff.sql | supabase db query --project-ref $ProjectRef
} else {
  Write-Error "supabase-rls-staff.sql not found in repository root."
}

Write-Host "Deployment complete. Check output above for errors."
