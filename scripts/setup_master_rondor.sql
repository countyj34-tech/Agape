-- Run in Supabase SQL Editor while logged into the DASHBOARD as rondorsparadise205@gmail.com
-- This sets up the APP master user (mthunzilabs@gmail.com) for AI Stock cloud access.
-- Dashboard login ≠ app login. The app signs in via Supabase Auth API as mthunzilabs@gmail.com.

-- Step 1: In Supabase Dashboard → Authentication → Users → Add user:
--   Email: mthunzilabs@gmail.com
--   Password: $Afro2470
--   Auto confirm: ON

-- Step 2: After creating that user, run this SQL (replace USER_ID if you know it, or use email match):

UPDATE profiles
SET role = 'super_admin', is_active = true, updated_at = NOW()
WHERE lower(email) = lower('mthunzilabs@gmail.com');

-- RLS: allow super_admin to read all remote stores/products
DROP POLICY IF EXISTS products_super_admin_select ON products;
CREATE POLICY products_super_admin_select ON products
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  );

DROP POLICY IF EXISTS companies_super_admin_select ON companies;
CREATE POLICY companies_super_admin_select ON companies
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  );

DROP POLICY IF EXISTS stores_super_admin_select ON stores;
CREATE POLICY stores_super_admin_select ON stores
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  );

DROP POLICY IF EXISTS products_super_admin_update ON products;
CREATE POLICY products_super_admin_update ON products
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  );
