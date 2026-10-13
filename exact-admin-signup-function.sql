-- Exact admin_signup function that matches what TypeScript code expects
-- This creates company, store, profile, and membership in one call

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

    -- Get authenticated user ID (should exist at this point in signup flow)
    v_user_id := auth.uid()::TEXT;
    
    -- If no authenticated user, create one first (this handles the chicken-and-egg issue)
    IF v_user_id IS NULL THEN
        -- Create a temporary auth user for signup
        INSERT INTO auth.users (
            id,
            email,
            created_at,
            updated_at,
            phone_confirmed_at,
            email_confirmed_at
        ) VALUES (
            gen_random_uuid()::TEXT,
            p_email,
            NOW(),
            NOW(),
            NOW(),
            NOW()
        ) RETURNING id INTO v_user_id;
        
        -- Set user metadata for the profile we're about to create
        UPDATE auth.users SET 
            raw_user_meta_data = jsonb_build_object(
                'phone', p_phone,
                'role', 'admin',
                'full_name', p_company_name,
                'company_id', 'temp_company_id',
                'store_id', 'temp_store_id'
            )
        WHERE id = v_user_id;
    END IF;

    -- Check if company with this phone already exists
    IF EXISTS (SELECT 1 FROM companies WHERE owner_phone = p_company_phone AND id != 'temp_company_id') THEN
        RETURN QUERY SELECT false, 'Company with this phone already exists', NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- Create company
    INSERT INTO companies (
        id, name, owner_email, owner_phone, address, currency, currency_symbol, created_at, updated_at
    ) VALUES (
        COALESCE(v_user_id, 'temp_company_id'), -- Use existing user_id or temp
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

    -- Create user profile
    INSERT INTO profiles (
        id, full_name, email, phone, role, company_id, store_id, is_active, created_at, updated_at
    ) VALUES (
        COALESCE(v_user_id, 'temp_user_id'), -- Use existing user_id or temp
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
        id, user_id, company_id, role, store_id, is_active, joined_at
    ) VALUES (
        gen_random_uuid()::TEXT,
        COALESCE(v_user_id, 'temp_user_id'),
        v_company_id,
        'owner',
        v_store_id,
        true,
        NOW()
    );

    -- Update temp user to point to real company if we created one
    IF v_user_id IS NULL THEN
        UPDATE auth.users SET 
            raw_user_meta_data = jsonb_build_object(
                'phone', p_phone,
                'role', 'admin',
                'full_name', p_company_name,
                'company_id', v_company_id,
                'store_id', v_store_id
            )
        WHERE id = (SELECT id FROM profiles WHERE email = p_email LIMIT 1);
    END IF;

    -- Return success
    RETURN QUERY SELECT true, NULL::TEXT, v_company_id, v_store_id, COALESCE(v_user_id, (SELECT id FROM profiles WHERE email = p_email LIMIT 1));
    
EXCEPTION WHEN OTHERS THEN
    -- Return error information
    RETURN QUERY SELECT false, SQLERRM, NULL::TEXT, NULL::TEXT, NULL::TEXT;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION admin_signup TO public;
GRANT EXECUTE ON FUNCTION admin_signup TO authenticated;
GRANT EXECUTE ON FUNCTION admin_signup TO service_role;

-- Grant usage on auth schema for function
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO service_role;
