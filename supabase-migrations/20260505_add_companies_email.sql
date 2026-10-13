-- Migration: Add companies.email column, index and grants
-- Run this in the Supabase SQL editor or via psql as a privileged user

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_email ON public.companies(email);

GRANT SELECT, INSERT, UPDATE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
