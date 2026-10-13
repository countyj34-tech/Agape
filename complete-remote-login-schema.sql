-- COMPLETE SCHEMA FOR REMOTE LOGIN FUNCTIONALITY
-- This creates all necessary tables, functions, and policies for secure remote authentication

-- =====================================================
-- 1. CORE TABLES
-- =====================================================

-- Companies table
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_email TEXT,
    owner_phone TEXT NOT NULL,
    address TEXT,
    currency TEXT DEFAULT 'ZMW',
    currency_symbol TEXT DEFAULT 'K',
    base_currency TEXT DEFAULT 'ZMW',
    tax_rate DECIMAL DEFAULT 0,
    sales_tax_mode TEXT DEFAULT 'none',
    sales_tax_rate DECIMAL DEFAULT 0,
    single_item_margin_percent DECIMAL DEFAULT 0,
    receipt_footer TEXT DEFAULT '',
    thermal_printer_width TEXT DEFAULT '58mm',
    plan TEXT DEFAULT 'free',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stores table
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location_name TEXT,
    address TEXT,
    phone TEXT,
    currency TEXT DEFAULT 'ZMW',
    currency_symbol TEXT DEFAULT 'K',
    is_public BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User profiles table
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY,
    full_name TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'staff',
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(email)
);

-- User memberships table
CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'staff',
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, company_id)
);

-- =====================================================
-- 2. INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_companies_owner_phone ON companies(owner_phone);
CREATE INDEX IF NOT EXISTS idx_companies_email ON companies(owner_email);
CREATE INDEX IF NOT EXISTS idx_stores_company_id ON stores(company_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_company_id ON memberships(company_id);

-- =====================================================
-- 3. ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

-- Companies policies
CREATE POLICY "Users can view their company" ON companies
    FOR SELECT USING (
        auth.uid() = ANY(
            SELECT user_id FROM memberships 
            WHERE company_id = companies.id AND is_active = true
        )
    );

CREATE POLICY "Users can update their company" ON companies
    FOR UPDATE USING (
        auth.uid() = ANY(
            SELECT user_id FROM memberships 
            WHERE company_id = companies.id AND is_active = true AND role IN ('admin', 'owner')
        )
    );

CREATE POLICY "Allow company creation during signup" ON companies
    FOR INSERT WITH CHECK (true);

-- Stores policies  
CREATE POLICY "Users can view their stores" ON stores
    FOR SELECT USING (
        company_id = ANY(
            SELECT company_id FROM memberships 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

CREATE POLICY "Users can update their stores" ON stores
    FOR UPDATE USING (
        company_id = ANY(
            SELECT company_id FROM memberships 
            WHERE user_id = auth.uid() AND is_active = true AND role IN ('admin', 'owner', 'manager')
        )
    );

CREATE POLICY "Allow store creation during signup" ON stores
    FOR INSERT WITH CHECK (true);

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON profiles
    FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Allow profile creation during signup" ON profiles
    FOR INSERT WITH CHECK (true);

-- Memberships policies
CREATE POLICY "Users can view their memberships" ON memberships
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update their memberships" ON memberships
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Allow membership creation during signup" ON memberships
    FOR INSERT WITH CHECK (true);

-- =====================================================
-- 4. AUTHENTICATION FUNCTIONS
-- =====================================================

-- Function to create user with company (signup)
CREATE OR REPLACE FUNCTION create_user_with_company(
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
    user_id UUID,
    company_id UUID,
    store_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_company_id UUID;
    v_store_id UUID;
    v_existing_user profiles%ROWTYPE;
BEGIN
    -- Validate inputs
    IF p_email IS NULL OR p_phone IS NULL OR p_pin IS NULL OR p_company_name IS NULL OR p_company_phone IS NULL THEN
        RETURN QUERY SELECT false, 'Missing required fields', NULL::UUID, NULL::UUID, NULL::UUID;
        RETURN;
    END IF;

    -- Check if user already exists
    SELECT * INTO v_existing_user FROM profiles WHERE email = LOWER(p_email);
    IF v_existing_user.id IS NOT NULL THEN
        RETURN QUERY SELECT false, 'Email already registered', NULL::UUID, NULL::UUID, NULL::UUID;
        RETURN;
    END IF;

    -- Check if company already exists
    IF EXISTS (SELECT 1 FROM companies WHERE owner_phone = p_company_phone) THEN
        RETURN QUERY SELECT false, 'Company with this phone already exists', NULL::UUID, NULL::UUID, NULL::UUID;
        RETURN;
    END IF;

    -- Create company
    INSERT INTO companies (
        name, owner_email, owner_phone, address, currency, currency_symbol, created_at, updated_at
    ) VALUES (
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

    -- Create store
    INSERT INTO stores (
        company_id, name, location_name, address, phone, currency, currency_symbol, created_at, updated_at
    ) VALUES (
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
        NOW(),
        NOW()
    ) RETURNING id INTO v_store_id;

    -- Create user profile (requires auth.uid() to exist)
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT false, 'User not authenticated', NULL::UUID, NULL::UUID, NULL::UUID;
        RETURN;
    END IF;

    INSERT INTO profiles (
        id, full_name, email, phone, role, company_id, store_id, created_at, updated_at
    ) VALUES (
        v_user_id,
        p_company_name,
        p_email,
        p_phone,
        'owner',
        v_company_id,
        v_store_id,
        NOW(),
        NOW()
    );

    -- Create membership
    INSERT INTO memberships (
        user_id, company_id, role, store_id, is_active, joined_at
    ) VALUES (
        v_user_id,
        v_company_id,
        'owner',
        v_store_id,
        true,
        NOW()
    );

    -- Return success
    RETURN QUERY SELECT true, NULL::TEXT, v_user_id, v_company_id, v_store_id;
    
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM, NULL::UUID, NULL::UUID, NULL::UUID;
END;
$$;

-- Function to authenticate user
CREATE OR REPLACE FUNCTION authenticate_user(
    p_email TEXT,
    p_pin TEXT
)
RETURNS TABLE(
    success BOOLEAN,
    error TEXT,
    user_id UUID,
    company_id UUID,
    store_id UUID,
    user_role TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user profiles%ROWTYPE;
    v_membership memberships%ROWTYPE;
BEGIN
    -- Validate inputs
    IF p_email IS NULL OR p_pin IS NULL THEN
        RETURN QUERY SELECT false, 'Missing credentials', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- Find user by email
    SELECT * INTO v_user FROM profiles WHERE email = LOWER(p_email);
    IF v_user.id IS NULL THEN
        RETURN QUERY SELECT false, 'User not found', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- Check if user is active
    IF NOT v_user.is_active THEN
        RETURN QUERY SELECT false, 'User account is inactive', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- Get user's active membership
    SELECT * INTO v_membership FROM memberships 
    WHERE user_id = v_user.id AND is_active = true 
    LIMIT 1;

    IF v_membership.id IS NULL THEN
        RETURN QUERY SELECT false, 'No active membership found', NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
        RETURN;
    END IF;

    -- Return success with user details
    RETURN QUERY SELECT true, NULL::TEXT, v_user.id, v_user.company_id, v_user.store_id, v_membership.role;
    
EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, SQLERRM, NULL::UUID, NULL::UUID, NULL::UUID, NULL::TEXT;
END;
$$;

-- Function to get user profile with company
CREATE OR REPLACE FUNCTION get_user_profile_with_company()
RETURNS TABLE(
    user_id UUID,
    user_email TEXT,
    user_name TEXT,
    user_phone TEXT,
    user_role TEXT,
    company_id UUID,
    company_name TEXT,
    company_phone TEXT,
    company_email TEXT,
    store_id UUID,
    store_name TEXT,
    is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id as user_id,
        p.email as user_email,
        p.full_name as user_name,
        p.phone as user_phone,
        p.role as user_role,
        c.id as company_id,
        c.name as company_name,
        c.owner_phone as company_phone,
        c.owner_email as company_email,
        s.id as store_id,
        s.name as store_name,
        p.is_active
    FROM profiles p
    LEFT JOIN companies c ON p.company_id = c.id
    LEFT JOIN stores s ON p.store_id = s.id
    WHERE p.id = auth.uid() AND p.is_active = true;
END;
$$;

-- =====================================================
-- 5. PERMISSIONS
-- =====================================================

-- Grant function permissions
GRANT EXECUTE ON FUNCTION create_user_with_company TO authenticated;
GRANT EXECUTE ON FUNCTION create_user_with_company TO service_role;
GRANT EXECUTE ON FUNCTION authenticate_user TO authenticated;
GRANT EXECUTE ON FUNCTION authenticate_user TO service_role;
GRANT EXECUTE ON FUNCTION get_user_profile_with_company TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_profile_with_company TO service_role;

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE ON companies TO authenticated;
GRANT SELECT, INSERT, UPDATE ON stores TO authenticated;
GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON memberships TO authenticated;

-- Grant service role full access
GRANT ALL ON companies TO service_role;
GRANT ALL ON stores TO service_role;
GRANT ALL ON profiles TO service_role;
GRANT ALL ON memberships TO service_role;

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

-- =====================================================
-- 6. TRIGGERS FOR AUTOMATIC UPDATES
-- =====================================================

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to tables
CREATE TRIGGER update_companies_updated_at 
    BEFORE UPDATE ON companies 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stores_updated_at 
    BEFORE UPDATE ON stores 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at 
    BEFORE UPDATE ON profiles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 7. SAMPLE DATA (OPTIONAL)
-- =====================================================

-- Create a default admin user (remove in production)
-- INSERT INTO profiles (id, email, full_name, role, is_active, created_at, updated_at)
-- VALUES (
--     gen_random_uuid(),
--     'admin@mthunzi.com',
--     'System Administrator',
--     'admin',
--     true,
--     NOW(),
--     NOW()
-- );

-- =====================================================
-- 8. VIEWS FOR EASY ACCESS
-- =====================================================

-- View for user dashboard
CREATE OR REPLACE VIEW user_dashboard AS
SELECT 
    u.id as user_id,
    u.email as user_email,
    u.full_name as user_name,
    u.phone as user_phone,
    u.role as user_role,
    c.id as company_id,
    c.name as company_name,
    c.owner_phone as company_phone,
    c.owner_email as company_email,
    c.currency as company_currency,
    c.currency_symbol as company_currency_symbol,
    s.id as store_id,
    s.name as store_name,
    s.location_name as store_location,
    m.role as membership_role,
    m.is_active as membership_active,
    m.joined_at as member_since
FROM profiles u
JOIN memberships m ON u.id = m.user_id
JOIN companies c ON m.company_id = c.id
LEFT JOIN stores s ON u.store_id = s.id
WHERE u.is_active = true AND m.is_active = true;

-- Grant view permissions
GRANT SELECT ON user_dashboard TO authenticated;
GRANT SELECT ON user_dashboard TO service_role;
