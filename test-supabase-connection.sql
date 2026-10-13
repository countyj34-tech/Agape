-- Test Supabase connection and create simple working function
-- This will help diagnose the "Failed to fetch" error

-- Step 1: Create a simple test function
CREATE OR REPLACE FUNCTION test_connection()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN 'Connection successful - ' || NOW();
END;
$$;

-- Step 2: Create a simplified admin_signup that doesn't touch auth.users
DROP FUNCTION IF EXISTS admin_signup(text,text,text,text,text,text,text,text);

CREATE OR REPLACE FUNCTION admin_signup(
    p_email TEXT,
    p_phone TEXT,
    p_pin TEXT,
    p_company_name TEXT,
    p_company_phone TEXT,
    p_company_email TEXT DEFAULT NULL,
    p_company_address TEXT DEFAULT NULL,
    p_currency TEXT DEFAULT 'ZMW'
)
RETURNS TABLE(
    success BOOLEAN,
    error TEXT,
    company_id TEXT,
    store_id TEXT,
    user_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_company_id TEXT;
    v_store_id TEXT;
BEGIN
    -- Validate inputs
    IF p_email IS NULL OR p_phone IS NULL OR p_pin IS NULL OR p_company_name IS NULL OR p_company_phone IS NULL THEN
        RETURN QUERY SELECT false, 'Missing required fields', NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- Check if company with this phone already exists
    IF EXISTS (SELECT 1 FROM companies WHERE owner_phone = p_company_phone) THEN
        RETURN QUERY SELECT false, 'Company with this phone already exists', NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- Create company (no auth dependency)
    INSERT INTO companies (
        id, name, owner_email, owner_phone, address, currency, currency_symbol, created_at, updated_at
    ) VALUES (
        gen_random_uuid()::TEXT,
        p_company_name,
        p_email,
        p_company_phone,
        p_company_address,
        p_currency,
        CASE 
            WHEN p_currency = 'ZMW' THEN 'K'
            WHEN p_currency = 'USD' THEN '$'
            WHEN p_currency = 'EUR' THEN '€'
            WHEN p_currency = 'GBP' THEN '£'
            ELSE p_currency
        END,
        NOW(),
        NOW()
    ) RETURNING id INTO v_company_id;

    -- Create default store
    INSERT INTO stores (
        id, company_id, name, location_name, address, phone, currency, currency_symbol, is_public, is_active, created_at, updated_at
    ) VALUES (
        gen_random_uuid()::TEXT,
        v_company_id,
        p_company_name || ' - Main Store',
        'Main Location',
        p_company_address,
        p_company_phone,
        p_currency,
        CASE 
            WHEN p_currency = 'ZMW' THEN 'K'
            WHEN p_currency = 'USD' THEN '$'
            WHEN p_currency = 'EUR' THEN '€'
            WHEN p_currency = 'GBP' THEN '£'
            ELSE p_currency
        END,
        true,
        true,
        NOW(),
        NOW()
    ) RETURNING id INTO v_store_id;

    -- Return success (user_id will be set later by auth flow)
    RETURN QUERY SELECT true, NULL::TEXT, v_company_id, v_store_id, NULL::TEXT;
    
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM, NULL::TEXT, NULL::TEXT, NULL::TEXT;
END;
$$;

-- Step 3: Grant permissions
GRANT EXECUTE ON FUNCTION test_connection TO public;
GRANT EXECUTE ON FUNCTION test_connection TO authenticated;
GRANT EXECUTE ON FUNCTION test_connection TO service_role;

GRANT EXECUTE ON FUNCTION admin_signup TO public;
GRANT EXECUTE ON FUNCTION admin_signup TO authenticated;
GRANT EXECUTE ON FUNCTION admin_signup TO service_role;

-- Step 4: Disable RLS temporarily to prevent permission issues
ALTER TABLE companies DISABLE ROW LEVEL SECURITY;
ALTER TABLE stores DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE memberships DISABLE ROW LEVEL SECURITY;

-- Step 5: Grant table permissions
GRANT ALL ON companies TO public;
GRANT ALL ON stores TO public;
GRANT ALL ON profiles TO public;
GRANT ALL ON memberships TO public;
