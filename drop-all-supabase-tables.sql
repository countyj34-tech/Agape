-- ============================================================================
-- DROP ALL SUPABASE TABLES AND OBJECTS
-- Use this to completely reset your Supabase database
-- WARNING: This will delete ALL data permanently!
-- ============================================================================

-- Disable foreign key constraints temporarily
SET session_replication_role = replica;

-- Drop all tables in correct order (respecting dependencies)
DROP TABLE IF EXISTS inventory_alerts CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS online_orders CASCADE;
DROP TABLE IF EXISTS shift_reports CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS customer_ledger CASCADE;
DROP TABLE IF EXISTS sale_items CASCADE;
DROP TABLE IF EXISTS sales CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS stores CASCADE;
DROP TABLE IF EXISTS companies CASCADE;

-- Drop all functions
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS public.admin_signup CASCADE;
DROP FUNCTION IF EXISTS public.get_user_profile_with_company CASCADE;
DROP FUNCTION IF EXISTS public.create_sale_with_items CASCADE;

-- Drop all triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS update_companies_updated_at ON companies;
DROP TRIGGER IF EXISTS update_stores_updated_at ON stores;
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
DROP TRIGGER IF EXISTS update_sales_updated_at ON sales;
DROP TRIGGER IF EXISTS update_online_orders_updated_at ON online_orders;

-- Drop all policies (they will be dropped with tables, but let's be thorough)
DROP POLICY IF EXISTS "Users can view their company" ON companies;
DROP POLICY IF EXISTS "Admins can update their company" ON companies;
DROP POLICY IF EXISTS "Company members can view their stores" ON stores;
DROP POLICY IF EXISTS "Admins can manage stores" ON stores;
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Company members can view company profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view their memberships" ON memberships;
DROP POLICY IF EXISTS "Admins can manage memberships" ON memberships;
DROP POLICY IF EXISTS "Store members can view categories" ON categories;
DROP POLICY IF EXISTS "Store staff can manage categories" ON categories;
DROP POLICY IF EXISTS "Store members can view products" ON products;
DROP POLICY IF EXISTS "Store staff can manage products" ON products;
DROP POLICY IF EXISTS "Store members can view sales" ON sales;
DROP POLICY IF EXISTS "Store staff can create sales" ON sales;
DROP POLICY IF EXISTS "Cashiers can update their sales" ON sales;
DROP POLICY IF EXISTS "Company members can view customers" ON customers;
DROP POLICY IF EXISTS "Store staff can manage customers" ON customers;
DROP POLICY IF EXISTS "Company members can view expenses" ON expenses;
DROP POLICY IF EXISTS "Store staff can manage expenses" ON expenses;

-- Re-enable foreign key constraints
SET session_replication_role = DEFAULT;

-- Drop all indexes (they will be dropped with tables, but let's be explicit)
DROP INDEX IF EXISTS idx_companies_owner_email;
DROP INDEX IF EXISTS idx_companies_owner_phone;
DROP INDEX IF EXISTS idx_stores_company_id;
DROP INDEX IF EXISTS idx_profiles_email;
DROP INDEX IF EXISTS idx_profiles_phone;
DROP INDEX IF EXISTS idx_profiles_company_id;
DROP INDEX IF EXISTS idx_memberships_user_id;
DROP INDEX IF EXISTS idx_memberships_company_id;
DROP INDEX IF EXISTS idx_categories_store_id;
DROP INDEX IF EXISTS idx_categories_company_id;
DROP INDEX IF EXISTS idx_products_store_id;
DROP INDEX IF EXISTS idx_products_company_id;
DROP INDEX IF EXISTS idx_products_barcode;
DROP INDEX IF EXISTS idx_products_category_ids;
DROP INDEX IF EXISTS idx_stock_movements_product_id;
DROP INDEX IF EXISTS idx_stock_movements_store_id;
DROP INDEX IF EXISTS idx_customers_company_id;
DROP INDEX IF EXISTS idx_customers_name_key;
DROP INDEX IF EXISTS idx_sales_store_id;
DROP INDEX IF EXISTS idx_sales_company_id;
DROP INDEX IF EXISTS idx_sales_customer_id;
DROP INDEX IF EXISTS idx_sales_cashier_id;
DROP INDEX IF EXISTS idx_sales_receipt_number;
DROP INDEX IF EXISTS idx_sales_created_at;
DROP INDEX IF EXISTS idx_sale_items_sale_id;
DROP INDEX IF EXISTS idx_sale_items_product_id;
DROP INDEX IF EXISTS idx_customer_ledger_customer_id;
DROP INDEX IF EXISTS idx_expenses_company_id;
DROP INDEX IF EXISTS idx_expenses_store_id;
DROP INDEX IF EXISTS idx_expenses_created_at;
DROP INDEX IF EXISTS idx_shifts_store_id;
DROP INDEX IF EXISTS idx_shifts_cashier_id;
DROP INDEX IF EXISTS idx_shifts_start_time;
DROP INDEX IF EXISTS idx_online_orders_store_id;
DROP INDEX IF EXISTS idx_online_orders_status;
DROP INDEX IF EXISTS idx_online_orders_created_at;
DROP INDEX IF EXISTS idx_audit_logs_company_id;
DROP INDEX IF EXISTS idx_audit_logs_user_id;
DROP INDEX IF EXISTS idx_audit_logs_created_at;
DROP INDEX IF EXISTS idx_inventory_alerts_store_id;
DROP INDEX IF EXISTS idx_inventory_alerts_product_id;
DROP INDEX IF EXISTS idx_inventory_alerts_is_resolved;

-- Reset RLS (disable on all tables)
-- Note: RLS is automatically disabled when tables are dropped

-- Clean up any remaining sequences
DO $$
DECLARE
    seq RECORD;
BEGIN
    FOR seq IN 
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_schema = 'public'
    LOOP
        EXECUTE 'DROP SEQUENCE IF EXISTS ' || quote_ident(seq.sequence_name) || ' CASCADE';
    END LOOP;
END $$;

-- Vacuum and analyze to clean up
VACUUM FULL;
ANALYZE;

-- ============================================================================
-- COMPLETED: All Supabase tables, functions, triggers, and objects dropped
-- Your database is now completely empty and ready for fresh setup
-- ============================================================================
