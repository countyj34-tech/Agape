Deployment checklist — admin-signup function

1) Prerequisites
- Install Supabase CLI (recommended):
  - macOS / Linux: `npm i -g supabase` or follow installers at https://supabase.com/docs/guides/cli
  - Windows: `npm i -g supabase` (run PowerShell as Administrator) or use the Windows installer
- Ensure `SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_URL` are available locally (add to `.env` in project root). Example:

  VITE_SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

2) Deploy functions
- From project root run:

  supabase login
  supabase functions deploy admin-signup
  supabase functions deploy admin-sync-store
  supabase functions deploy admin-sync-staff

- If you prefer non-interactive deploy (CI), set `SUPABASE_ACCESS_TOKEN` env var (CI token) and use `--project-ref <your-project-ref>`.

3) Verify function
- Invoke the function via anon client or from repo:

  node scripts/inspect_admin_signup.mjs

- Confirm the response contains `user_id`, `company_id`, `store_id` and that the admin client can find the created user:

  node scripts/check_admin_user.mjs

4) Run local validation (dry-run)
- Create a test user and artifacts using the service role client (this script creates a real auth user and canonical DB rows):

  node scripts/create_test_user_and_artifacts.mjs

- Heal missing profiles/memberships (dry run):

  node scripts/heal_profiles_memberships.mjs

- To apply healing changes (use carefully):

  node scripts/heal_profiles_memberships.mjs --apply

5) Post-deploy / production hardening
- Add idempotency handling to the function if your clients may retry. Use a dedicated table `admin_signups` with unique `request_id` or an idempotency-key header.
- Add logging/monitoring for function failures and latency.
- Ensure RLS policies grant `authenticated` and `service_role` the correct permissions used above.

6) CI e2e
- Add a CI job that deploys function to a staging project, invokes signup, and validates `auth.users`, `profiles`, `memberships`, `companies`, and `stores`.

If you want, I can attempt to deploy from this environment (requires `supabase` CLI available and an authenticated session or `SUPABASE_ACCESS_TOKEN`).
