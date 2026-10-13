-- ============================================================================
-- COMPLETE SUPABASE DATABASE SCHEMA FOR MTHUNZI POS SYSTEM
-- Multi-tenant architecture with remote authentication
-- ============================================================================

-- 1. CORE AUTHENTICATION AND MULTI-TENANCY TABLES

-- Companies table (multi-tenant root)
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  owner_email TEXT UNIQUE,
  owner_phone TEXT NOT NULL UNIQUE,
  address TEXT,
  logo_url TEXT,
  currency TEXT DEFAULT 'ZMW',
  currency_symbol TEXT DEFAULT 'K',
  base_currency TEXT DEFAULT 'ZMW',
  tax_rate NUMERIC DEFAULT 0,
  sales_tax_mode TEXT DEFAULT 'none',
  sales_tax_rate NUMERIC DEFAULT 0,
  single_item_margin_percent NUMERIC DEFAULT 0,
  receipt_footer TEXT,
  thermal_printer_width TEXT DEFAULT '58mm',
  plan TEXT DEFAULT 'free',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stores table (company branches)
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_name TEXT,
  address TEXT,
  phone TEXT,
  currency TEXT DEFAULT 'ZMW',
  currency_symbol TEXT DEFAULT 'K',
  is_public BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, -- auth.users.id as TEXT
  full_name TEXT,
  email TEXT,
  phone TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'owner', 'manager', 'staff')),
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memberships table (user-company relationships)
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'owner', 'manager', 'staff')),
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, company_id)
);

-- 2. INVENTORY MANAGEMENT TABLES

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_index INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  barcode TEXT,
  buying_price NUMERIC NOT NULL,
  selling_price NUMERIC NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 10,
  stock_unit TEXT DEFAULT 'individual',
  sell_unit TEXT DEFAULT 'individual',
  units_per_bulk INTEGER DEFAULT 1,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_ids TEXT[] DEFAULT '{}',
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock movements
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment', 'sale', 'return')),
  quantity INTEGER NOT NULL,
  reference_id TEXT, -- sale_id, purchase_id, etc.
  reason TEXT,
  created_by TEXT REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SALES AND TRANSACTIONS

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL, -- normalized for search
  phone TEXT,
  email TEXT,
  address TEXT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sales
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  cashier_id TEXT REFERENCES profiles(id),
  shift_id TEXT,
  receipt_number TEXT NOT NULL UNIQUE,
  subtotal NUMERIC NOT NULL,
  discount NUMERIC DEFAULT 0,
  total NUMERIC NOT NULL,
  sales_tax_mode TEXT DEFAULT 'none',
  sales_tax_rate NUMERIC DEFAULT 0,
  sales_tax_amount NUMERIC DEFAULT 0,
  profit NUMERIC NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'mobile', 'credit', 'transfer')),
  amount_paid NUMERIC DEFAULT 0,
  amount_received NUMERIC DEFAULT 0,
  change_given NUMERIC DEFAULT 0,
  balance_due NUMERIC DEFAULT 0,
  mobile_provider TEXT CHECK (mobile_provider IN ('mtn', 'airtel', 'zamtel', 'other')),
  mobile_reference TEXT,
  status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'cancelled', 'refunded')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sale items
CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC NOT NULL,
  total_price NUMERIC NOT NULL,
  cost_price NUMERIC NOT NULL,
  profit NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer ledger
CREATE TABLE IF NOT EXISTS customer_ledger (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('debt', 'payment')),
  amount NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL,
  reference_id TEXT, -- sale_id or payment_id
  description TEXT,
  created_by TEXT REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. EXPENSES AND FINANCIAL

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  category TEXT NOT NULL,
  note TEXT,
  source TEXT NOT NULL CHECK (source IN ('cash', 'mtn', 'airtel', 'other')),
  mobile_reference TEXT,
  created_by TEXT REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SHIFTS AND OPERATIONS

-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cashier_id TEXT NOT NULL REFERENCES profiles(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  opening_balance NUMERIC DEFAULT 0,
  closing_balance NUMERIC DEFAULT 0,
  cash_sales NUMERIC DEFAULT 0,
  card_sales NUMERIC DEFAULT 0,
  mobile_sales NUMERIC DEFAULT 0,
  credit_sales NUMERIC DEFAULT 0,
  total_sales NUMERIC DEFAULT 0,
  total_expenses NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shift reports
CREATE TABLE IF NOT EXISTS shift_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  report_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ONLINE ORDERS

-- Online orders
CREATE TABLE IF NOT EXISTS online_orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_address TEXT,
  items JSONB NOT NULL, -- array of order items
  subtotal NUMERIC NOT NULL,
  delivery_fee NUMERIC DEFAULT 0,
  total NUMERIC NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled')),
  payment_method TEXT CHECK (payment_method IN ('cash', 'mobile', 'card')),
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed')),
  delivery_address TEXT,
  delivery_notes TEXT,
  estimated_delivery_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. AUDIT AND LOGGING

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES profiles(id),
  action TEXT NOT NULL,
  table_name TEXT,
  record_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. NOTIFICATIONS AND ALERTS

-- Inventory alerts
CREATE TABLE IF NOT EXISTS inventory_alerts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('low_stock', 'out_of_stock', 'overstock')),
  current_stock INTEGER NOT NULL,
  threshold_value INTEGER NOT NULL,
  message TEXT,
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. SYSTEM CONFIGURATION

-- System settings
CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  key TEXT NOT NULL,
  value TEXT,
  description TEXT,
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, store_id, key)
);

-- 10. INDEXES FOR PERFORMANCE

-- Core tables
CREATE INDEX IF NOT EXISTS idx_companies_owner_email ON companies(owner_email);
CREATE INDEX IF NOT EXISTS idx_companies_owner_phone ON companies(owner_phone);
CREATE INDEX IF NOT EXISTS idx_stores_company_id ON stores(company_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_company_id ON memberships(company_id);

-- Inventory
CREATE INDEX IF NOT EXISTS idx_categories_store_id ON categories(store_id);
CREATE INDEX IF NOT EXISTS idx_categories_company_id ON categories(company_id);
CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_company_id ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_category_ids ON products USING GIN(category_ids);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_store_id ON stock_movements(store_id);

-- Sales
CREATE INDEX IF NOT EXISTS idx_customers_company_id ON customers(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_name_key ON customers(name_key);
CREATE INDEX IF NOT EXISTS idx_sales_store_id ON sales(store_id);
CREATE INDEX IF NOT EXISTS idx_sales_company_id ON sales(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_cashier_id ON sales(cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_receipt_number ON sales(receipt_number);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer_id ON customer_ledger(customer_id);

-- Financial
CREATE INDEX IF NOT EXISTS idx_expenses_company_id ON expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_expenses_store_id ON expenses(store_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);

-- Operations
CREATE INDEX IF NOT EXISTS idx_shifts_store_id ON shifts(store_id);
CREATE INDEX IF NOT EXISTS idx_shifts_cashier_id ON shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_shifts_start_time ON shifts(start_time);

-- Online orders
CREATE INDEX IF NOT EXISTS idx_online_orders_store_id ON online_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_status ON online_orders(status);
CREATE INDEX IF NOT EXISTS idx_online_orders_created_at ON online_orders(created_at);

-- Audit
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Alerts
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_store_id ON inventory_alerts(store_id);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_product_id ON inventory_alerts(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_alerts_is_resolved ON inventory_alerts(is_resolved);

-- 11. ROW LEVEL SECURITY (RLS)

-- Enable RLS on all tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- 12. RLS POLICIES

-- Companies policies
CREATE POLICY "Users can view their company" ON companies
  FOR SELECT USING (
    id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true
    )
  );

CREATE POLICY "Admins can update their company" ON companies
  FOR UPDATE USING (
    id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true AND role IN ('admin', 'owner')
    )
  );

-- Stores policies
CREATE POLICY "Company members can view their stores" ON stores
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true
    )
  );

CREATE POLICY "Admins can manage stores" ON stores
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true AND role IN ('admin', 'owner', 'manager')
    )
  );

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (id = auth.uid()::TEXT);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (id = auth.uid()::TEXT);

CREATE POLICY "Company members can view company profiles" ON profiles
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true
    )
  );

-- Memberships policies
CREATE POLICY "Users can view their memberships" ON memberships
  FOR SELECT USING (user_id = auth.uid()::TEXT);

CREATE POLICY "Admins can manage memberships" ON memberships
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true AND role IN ('admin', 'owner')
    )
  );

-- Categories policies
CREATE POLICY "Store members can view categories" ON categories
  FOR SELECT USING (
    store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships 
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
  );

CREATE POLICY "Store staff can manage categories" ON categories
  FOR ALL USING (
    store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships 
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
  );

-- Products policies
CREATE POLICY "Store members can view products" ON products
  FOR SELECT USING (
    store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships 
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
  );

CREATE POLICY "Store staff can manage products" ON products
  FOR ALL USING (
    store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships 
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
  );

-- Sales policies
CREATE POLICY "Store members can view sales" ON sales
  FOR SELECT USING (
    store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships 
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
  );

CREATE POLICY "Store staff can create sales" ON sales
  FOR INSERT WITH CHECK (
    store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships 
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
  );

CREATE POLICY "Cashiers can update their sales" ON sales
  FOR UPDATE USING (
    cashier_id = auth.uid()::TEXT
  );

-- Customers policies
CREATE POLICY "Company members can view customers" ON customers
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true
    )
  );

CREATE POLICY "Store staff can manage customers" ON customers
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true
    )
  );

-- Expenses policies
CREATE POLICY "Company members can view expenses" ON expenses
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true
    )
  );

CREATE POLICY "Store staff can manage expenses" ON expenses
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM memberships 
      WHERE user_id = auth.uid()::TEXT AND is_active = true
    )
  );

-- 13. TRIGGERS AND FUNCTIONS

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, phone, full_name, role)
  VALUES (
    NEW.id::TEXT,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers to relevant tables
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stores_updated_at BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_online_orders_updated_at BEFORE UPDATE ON online_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 14. BUSINESS LOGIC FUNCTIONS

-- Function for company admin signup
CREATE OR REPLACE FUNCTION public.admin_signup(
  p_email TEXT,
  p_phone TEXT,
  p_pin TEXT,
  p_company_name TEXT,
  p_company_phone TEXT,
  p_company_email TEXT DEFAULT NULL,
  p_company_address TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT 'ZMW'
)
RETURNS JSON AS $$
DECLARE
  v_company_id TEXT;
  v_store_id TEXT;
BEGIN
  -- Validate inputs
  IF p_email IS NULL OR p_phone IS NULL OR p_pin IS NULL OR p_company_name IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Missing required fields');
  END IF;

  -- Check if email already exists
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RETURN json_build_object('success', false, 'error', 'Email already registered');
  END IF;

  -- Check if company phone already exists
  IF EXISTS (SELECT 1 FROM companies WHERE owner_phone = p_company_phone) THEN
    RETURN json_build_object('success', false, 'error', 'Company phone already registered');
  END IF;

  -- Create company
  v_company_id := gen_random_uuid()::TEXT;
  INSERT INTO companies (id, name, owner_email, owner_phone, address, currency)
  VALUES (v_company_id, p_company_name, p_company_email, p_company_phone, p_company_address, p_currency);

  -- Create default store
  v_store_id := gen_random_uuid()::TEXT;
  INSERT INTO stores (id, company_id, name, location_name, phone, address)
  VALUES (v_store_id, v_company_id, p_company_name || ' - Main Store', 'Main Location', p_company_phone, p_company_address);

  -- Return success with company and store IDs
  RETURN json_build_object(
    'success', true,
    'company_id', v_company_id,
    'store_id', v_store_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user profile with company data
CREATE OR REPLACE FUNCTION public.get_user_profile_with_company(p_user_id TEXT)
RETURNS JSON AS $$
DECLARE
  v_profile JSON;
  v_company JSON;
  v_store JSON;
  v_membership JSON;
BEGIN
  -- Get user's membership
  SELECT json_build_object(
    'id', m.id,
    'user_id', m.user_id,
    'company_id', m.company_id,
    'role', m.role,
    'store_id', m.store_id,
    'is_active', m.is_active,
    'joined_at', m.joined_at
  ) INTO v_membership
  FROM memberships m
  WHERE m.user_id = p_user_id AND m.is_active = true
  LIMIT 1;

  IF v_membership IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active membership found');
  END IF;

  -- Get profile
  SELECT json_build_object(
    'id', id,
    'full_name', full_name,
    'phone', phone,
    'email', email,
    'role', role,
    'company_id', company_id,
    'store_id', store_id
  ) INTO v_profile
  FROM profiles
  WHERE id = p_user_id;

  -- Get company
  SELECT json_build_object(
    'id', id,
    'name', name,
    'owner_phone', owner_phone,
    'owner_email', owner_email,
    'address', address,
    'currency', currency,
    'currency_symbol', currency_symbol,
    'tax_rate', tax_rate,
    'plan', plan,
    'is_active', is_active
  ) INTO v_company
  FROM companies
  WHERE id = (v_membership->>'company_id');

  -- Get store if assigned
  IF (v_membership->>'store_id') IS NOT NULL THEN
    SELECT json_build_object(
      'id', id,
      'name', name,
      'location_name', location_name,
      'address', address,
      'phone', phone,
      'currency', currency,
      'currency_symbol', currency_symbol
    ) INTO v_store
    FROM stores
    WHERE id = (v_membership->>'store_id');
  END IF;

  -- Return combined result
  RETURN json_build_object(
    'success', true,
    'profile', v_profile,
    'membership', v_membership,
    'company', v_company,
    'store', v_store
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create sale with items
CREATE OR REPLACE FUNCTION public.create_sale_with_items(
  p_sale_data JSONB,
  p_items JSONB
)
RETURNS JSON AS $$
DECLARE
  v_sale_id TEXT;
  v_receipt_number TEXT;
  v_total NUMERIC;
  v_profit NUMERIC;
  v_item JSON;
  v_product RECORD;
BEGIN
  -- Generate receipt number
  v_receipt_number := 'REC-' || to_char(NOW(), 'YYYY-MM-DD') || '-' || lpad((random() * 10000)::int::text, 4, '0');
  
  -- Calculate totals
  v_total := 0;
  v_profit := 0;
  
  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    SELECT buying_price, selling_price INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id');
    
    v_total := v_total + ((v_item->>'quantity')::NUMERIC * (v_item->>'unit_price')::NUMERIC);
    v_profit := v_profit + ((v_item->>'quantity')::NUMERIC * ((v_item->>'unit_price')::NUMERIC - v_product.buying_price));
  END LOOP;

  -- Create sale
  INSERT INTO sales (
    id, store_id, company_id, customer_id, cashier_id, receipt_number,
    subtotal, discount, total, profit, payment_method, amount_paid, amount_received,
    change_given, balance_due, mobile_provider, mobile_reference, notes
  )
  VALUES (
    gen_random_uuid()::TEXT,
    p_sale_data->>'store_id',
    p_sale_data->>'company_id',
    p_sale_data->>'customer_id',
    p_sale_data->>'cashier_id',
    v_receipt_number,
    p_sale_data->>'subtotal',
    COALESCE((p_sale_data->>'discount')::NUMERIC, 0),
    v_total,
    v_profit,
    p_sale_data->>'payment_method',
    COALESCE((p_sale_data->>'amount_paid')::NUMERIC, 0),
    COALESCE((p_sale_data->>'amount_received')::NUMERIC, 0),
    COALESCE((p_sale_data->>'change_given')::NUMERIC, 0),
    COALESCE((p_sale_data->>'balance_due')::NUMERIC, 0),
    p_sale_data->>'mobile_provider',
    p_sale_data->>'mobile_reference',
    p_sale_data->>'notes'
  )
  RETURNING id INTO v_sale_id;

  -- Create sale items
  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP
    SELECT buying_price INTO v_product
    FROM products
    WHERE id = (v_item->>'product_id');
    
    INSERT INTO sale_items (
      id, sale_id, product_id, product_name, quantity, unit_price, total_price, cost_price, profit
    )
    VALUES (
      gen_random_uuid()::TEXT,
      v_sale_id,
      v_item->>'product_id',
      v_item->>'product_name',
      (v_item->>'quantity')::INTEGER,
      (v_item->>'unit_price')::NUMERIC,
      ((v_item->>'quantity')::NUMERIC * (v_item->>'unit_price')::NUMERIC),
      v_product.buying_price,
      ((v_item->>'unit_price')::NUMERIC - v_product.buying_price)
    );
    
    -- Update product stock
    UPDATE products
    SET stock = stock - (v_item->>'quantity')::INTEGER,
        updated_at = NOW()
    WHERE id = (v_item->>'product_id');
    
    -- Create stock movement
    INSERT INTO stock_movements (
      id, product_id, store_id, company_id, movement_type, quantity, reference_id, reason, created_by
    )
    VALUES (
      gen_random_uuid()::TEXT,
      v_item->>'product_id',
      p_sale_data->>'store_id',
      p_sale_data->>'company_id',
      'sale',
      -(v_item->>'quantity')::INTEGER,
      v_sale_id,
      'Sale: ' || v_receipt_number,
      p_sale_data->>'cashier_id'
    );
  END LOOP;

  -- Return success
  RETURN json_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'receipt_number', v_receipt_number,
    'total', v_total,
    'profit', v_profit
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 15. GRANT PERMISSIONS

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION public.admin_signup TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_profile_with_company TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale_with_items TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column TO service_role;

-- Grant usage on sequences (if any)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ============================================================================
-- END OF COMPLETE SUPABASE DATABASE SCHEMA
-- ============================================================================
