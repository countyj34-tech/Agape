-- Safe RLS policy for `staff` table
-- Applies Row-Level Security and allows only company-scoped access based on `memberships`.
-- Run this in Supabase SQL Editor as an admin.
-- Safe RLS policy for `staff` table
-- Applies Row-Level Security and allows only company-scoped access based on `memberships`.
-- This file is idempotent: it creates/replaces helper functions and only applies
-- RLS/policies if the `public.staff` table exists.

-- Helper function to check whether current auth user is an active member of a company
-- Accepts company id as text to avoid type mismatches between uuid/text
CREATE OR REPLACE FUNCTION public.is_company_member(company_id_text text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE (m.profile_id::text = auth.uid()::text OR m.user_id::text = auth.uid()::text)
      AND m.company_id::text = company_id_text
      AND m.is_active = true
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

-- If the staff table exists, enable RLS, grant privileges and (re)create policies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'staff' AND n.nspname = 'public'
  ) THEN

    -- Enable RLS (safe to run if already enabled)
    ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

    -- Ensure the authenticated role has basic privileges (GRANT is idempotent)
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO authenticated;
    -- Also grant the service role explicit privileges so service-role API calls succeed
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO service_role;

    -- Drop policies if they exist, then create them to ensure idempotency
    DROP POLICY IF EXISTS "Allow company members to select staff" ON public.staff;
    CREATE POLICY "Allow company members to select staff" ON public.staff
      FOR SELECT
      USING (
        public.is_company_member(company_id::text)
      );

    DROP POLICY IF EXISTS "Allow company members to insert staff for their company" ON public.staff;
    CREATE POLICY "Allow company members to insert staff for their company" ON public.staff
      FOR INSERT
      WITH CHECK (
        public.is_company_member(company_id::text)
      );

    DROP POLICY IF EXISTS "Allow company members to update staff within their company" ON public.staff;
    CREATE POLICY "Allow company members to update staff within their company" ON public.staff
      FOR UPDATE
      USING (
        public.is_company_member(company_id::text)
      )
      WITH CHECK (
        public.is_company_member(company_id::text)
      );

    DROP POLICY IF EXISTS "Allow company members to delete staff within their company" ON public.staff;
    CREATE POLICY "Allow company members to delete staff within their company" ON public.staff
      FOR DELETE
      USING (
        public.is_company_member(company_id::text)
      );

  ELSE
    RAISE NOTICE 'Skipping staff RLS/policies: table public.staff does not exist.';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Notes:
-- - This requires a `memberships` table linking `profile_id` or `user_id` to `company_id`.
-- - Adjust `auth.uid()` checks if your JWT uses a different identifier claim.
-- - Deploy carefully: test on staging first. Service-role operations continue to bypass RLS.
