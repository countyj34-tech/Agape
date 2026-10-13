param(
  [string]$ProjectRef = $env:SUPABASE_PROJECT_REF,
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN
)

if (-not $ProjectRef -or -not $AccessToken) {
  Write-Error "SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN must be set as env vars or passed as parameters"
  exit 1
}

Write-Output "Installing supabase CLI locally..."
npm install --no-audit --no-fund supabase@latest

Write-Output "Deploying admin-signup function to project: $ProjectRef"
npx supabase functions deploy admin-signup --project-ref $ProjectRef

Write-Output "Deployment finished."
