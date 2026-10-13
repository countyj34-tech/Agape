-- Fix for company creation permission issue
-- Add INSERT policy to allow authenticated users to create companies

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can create companies" ON companies;

-- Create policy to allow authenticated users to create companies
CREATE POLICY "Users can create companies" ON companies
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND
    owner_email IS NOT NULL AND
    owner_phone IS NOT NULL
  );

-- Also add policy to allow users to view their own created company during signup
DROP POLICY IF EXISTS "Users can view their created company" ON companies;

CREATE POLICY "Users can view their created company" ON companies
  FOR SELECT USING (
    owner_phone IN (
      SELECT phone FROM profiles WHERE id = auth.uid()::TEXT
    ) OR
    id IN (
      SELECT company_id FROM memberships WHERE user_id = auth.uid()::TEXT
    )
  );
