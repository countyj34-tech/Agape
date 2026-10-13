-- Fix for admin_signup function - drop existing and recreate with correct return type

-- Step 1: Drop the existing function if it exists
DROP FUNCTION IF EXISTS admin_signup(text,text,text,text,text,text,text,text);

-- Step 2: Create the admin_signup function with correct return type
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
    v_user_id TEXT;
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

    -- Get the authenticated user ID (auth.user should already exist at this point)
    v_user_id := auth.uid()::TEXT;
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'User not authenticated', NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- Create company
    INSERT INTO companies (
        id,
        name,
        owner_email,
        owner_phone,
        address,
        currency,
        currency_symbol,
        created_at,
        updated_at
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
        id,
        company_id,
        name,
        location_name,
        address,
        phone,
        currency,
        currency_symbol,
        is_public,
        is_active,
        created_at,
        updated_at
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

    -- Create user profile
    INSERT INTO profiles (
        id,
        full_name,
        email,
        phone,
        role,
        company_id,
        store_id,
        is_active,
        created_at,
        updated_at
    ) VALUES (
        v_user_id,
        p_company_name,
        p_email,
        p_phone,
        'owner',
        v_company_id,
        v_store_id,
        true,
        NOW(),
        NOW()
    );

    -- Create membership record
    INSERT INTO memberships (
        id,
        user_id,
        company_id,
        role,
        store_id,
        is_active,
        joined_at
    ) VALUES (
        gen_random_uuid()::TEXT,
        v_user_id,
        v_company_id,
        'owner',
        v_store_id,
        true,
        NOW()
    );

    -- Return success
    RETURN QUERY SELECT true, NULL::TEXT, v_company_id, v_store_id, v_user_id;
    
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT false, SQLERRM, NULL::TEXT, NULL::TEXT, NULL::TEXT;
END;
$$;

-- Step 3: Grant permissions
GRANT EXECUTE ON FUNCTION admin_signup TO authenticated;
GRANT EXECUTE ON FUNCTION admin_signup TO service_role;
