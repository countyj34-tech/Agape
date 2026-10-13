-- Supabase Schema Healer / Repair SQL
-- Run this in Supabase SQL Editor (Project → SQL Editor → New query)
-- Purpose: add missing compatibility columns/tables/views used by the app
-- Notes:
--  - This script uses safe `IF NOT EXISTS`/`IF EXISTS` checks where possible.
--  - After running, wait a few seconds for the PostgREST schema cache to refresh
--    or manually restart the DB/Realtime from the Supabase project settings if needed.

BEGIN;

-- 1) Ensure `profiles` table exists (minimal shape used by app)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  email text,
  phone text,
  role text,
  company_id uuid,
  store_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2) Provide a compatibility `public.users` view/table if missing.
--    Some deployments keep auth users in `auth.users` while older code
--    expects `public.users`. Create a lightweight view if `auth.users` exists,
--    otherwise create a minimal `public.users` table for compatibility.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'users' AND n.nspname = 'public'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'users' AND n.nspname = 'auth'
    ) THEN
      BEGIN
        EXECUTE 'CREATE VIEW public.users AS SELECT id, email, created_at FROM auth.users';
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'Could not create public.users view from auth.users: %', SQLERRM;
      END;
    ELSE
      BEGIN
        EXECUTE 'CREATE TABLE public.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now())';
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'Could not create fallback public.users table: %', SQLERRM;
      END;
    END IF;
  END IF;
END$$;

-- 3) Add compatibility columns to `companies` used by the frontend
ALTER TABLE IF EXISTS public.companies
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS owner_email text;

-- 4) Add missing/optional columns to `stores`
ALTER TABLE IF EXISTS public.stores
  ADD COLUMN IF NOT EXISTS payment_numbers jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS owner_id uuid,
  ADD COLUMN IF NOT EXISTS store_code text,
  ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS company_id uuid;

-- 5) Ensure `memberships` has the expected profile link and helpful columns
ALTER TABLE IF EXISTS public.memberships
  ADD COLUMN IF NOT EXISTS profile_id uuid,
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS joined_at timestamptz;

-- 6) Add foreign key from memberships.profile_id -> profiles.id (best-effort)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'memberships' AND n.nspname = 'public'
  ) AND EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'profiles' AND n.nspname = 'public'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'memberships_profile_id_fkey'
    ) THEN
      BEGIN
        ALTER TABLE public.memberships
          ADD CONSTRAINT memberships_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'Skipping FK creation memberships_profile_id_fkey: %', SQLERRM;
      END;
    END IF;
  END IF;
END$$;

-- 7) Add helpful indexes for common lookups (no-op if already present)
CREATE INDEX IF NOT EXISTS idx_companies_email ON public.companies (lower((email)::text));
CREATE INDEX IF NOT EXISTS idx_companies_owner_email ON public.companies (lower((owner_email)::text));
CREATE INDEX IF NOT EXISTS idx_stores_company_id ON public.stores (company_id);
CREATE INDEX IF NOT EXISTS idx_memberships_profile_id ON public.memberships (profile_id);
CREATE INDEX IF NOT EXISTS idx_memberships_company_id ON public.memberships (company_id);

COMMIT;

-- After running:
-- 1) Wait a few seconds and try the failing flows again. PostgREST caches schema information
--    and will refresh automatically; if errors persist, open Supabase Project -> Settings -> Database
--    and restart the DB/Realtime service to force the schema cache to reload.
-- 2) Verify by running a few checks in the SQL editor:
--    SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='memberships';
--    SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='stores';
--    SELECT * FROM public.profiles LIMIT 5;
-- 3) After this, try the app flows: create company, check `memberships` and `profiles` rows exist, then create store and staff.
