How to apply the Supabase migration
----------------------------------

Files added:

- supabase-migrations/20260505_add_companies_email.sql

Recommended (web UI) — easiest
1. Open your Supabase project in the browser.
2. Go to **SQL Editor** → **New query** .
3. Open the file `supabase-migrations/20260505_add_companies_email.sql` in your local editor, copy the SQL and paste into the SQL Editor.
4. Click **RUN** and confirm there are no errors.

psql (service-role/admin connection)
1. Obtain a Postgres connection string that has permission to ALTER tables (service role or DB superuser).
   Example connection string format (replace placeholders):

   psql "postgresql://postgres:<SERVICE_ROLE_PASSWORD>@<DB_HOST>:5432/postgres"

2. Run:

```bash
psql "postgresql://postgres:<SERVICE_ROLE_PASSWORD>@<DB_HOST>:5432/postgres" -f supabase-migrations/20260505_add_companies_email.sql
```

Notes
- Running this requires admin privileges on the Supabase Postgres instance (service_role or equivalent).
- The SQL will add the `email` column only if it does not already exist, create an index, and grant permissions to `authenticated` and `service_role`.
- If you prefer, I can run this for you if you provide a secure way to supply the service role key or run it from a CI environment with proper secrets.
