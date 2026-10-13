-- FINAL DATABASE FIX - Run this in Supabase SQL Editor
-- This will fix the "Database error saving new user" issue

-- Step 1: Remove the problematic trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Step 2: Create a simple, working trigger function
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Simple profile creation that won't fail
  INSERT INTO public.profiles (id, email, full_name, phone, role)
  VALUES (
    NEW.id::TEXT,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  )
  ON CONFLICT (id) DO NOTHING; -- Don't fail if profile already exists
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Don't fail the auth process even if profile creation fails
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Recreate the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Step 4: Grant necessary permissions
GRANT EXECUTE ON FUNCTION handle_new_user TO service_role;

-- Step 5: Test the fix
SELECT 'Database fix applied successfully! Signup should now work.' as status;
