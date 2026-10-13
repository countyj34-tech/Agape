-- Mthunzi Parallel - Inventory Intelligence System
-- SQL Migration to create all necessary tables

-- ========== PARALLEL BUSINESSES ==========

CREATE TABLE IF NOT EXISTS parallel_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  address TEXT,
  industry TEXT,
  logo_url TEXT,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  currency_symbol TEXT NOT NULL DEFAULT 'K',
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_business_email UNIQUE(owner_email)
);

CREATE INDEX idx_parallel_businesses_admin ON parallel_businesses(admin_user_id);
CREATE INDEX idx_parallel_businesses_active ON parallel_businesses(is_active);

-- ========== PARALLEL BRANCHES ==========

CREATE TABLE IF NOT EXISTS parallel_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES parallel_businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location TEXT,
  manager_name TEXT,
  manager_phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_parallel_branches_business ON parallel_branches(business_id);
CREATE INDEX idx_parallel_branches_active ON parallel_branches(is_active);

-- ========== DASHBOARD USERS (Read-only access for business clients) ==========

CREATE TABLE IF NOT EXISTS dashboard_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES parallel_businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'manager')),
  password_hash TEXT, -- Simple password hash for now
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_dashboard_email UNIQUE(email)
);

CREATE INDEX idx_dashboard_users_business ON dashboard_users(business_id);
CREATE INDEX idx_dashboard_users_active ON dashboard_users(is_active);

-- ========== UPLOADED FILES ==========

CREATE TABLE IF NOT EXISTS uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES parallel_businesses(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES parallel_branches(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK (file_format IN ('xlsx', 'csv', 'pdf', 'image', 'unknown')),
  file_size INTEGER NOT NULL,
  file_url TEXT NOT NULL, -- Supabase storage path
  uploaded_by TEXT NOT NULL, -- User email or ID
  process_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (process_status IN ('uploaded', 'processing', 'completed', 'failed')),
  error_message TEXT,
  processed_data JSONB, -- Extracted structured data
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_uploaded_files_business ON uploaded_files(business_id);
CREATE INDEX idx_uploaded_files_branch ON uploaded_files(branch_id);
CREATE INDEX idx_uploaded_files_status ON uploaded_files(process_status);

-- ========== PARALLEL REPORTS ==========

CREATE TABLE IF NOT EXISTS parallel_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES parallel_businesses(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES parallel_branches(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'daily' CHECK (report_type IN ('daily', 'weekly', 'custom')),
  
  -- Source files
  uploaded_file_ids UUID[] NOT NULL DEFAULT '{}',
  extracted_from TEXT[] NOT NULL DEFAULT '{}',
  
  -- Stock information (JSONB for flexibility)
  opening_stock_items JSONB NOT NULL DEFAULT '[]'::JSONB,
  opening_stock_value NUMERIC NOT NULL DEFAULT 0,
  closing_stock_items JSONB NOT NULL DEFAULT '[]'::JSONB,
  closing_stock_value NUMERIC NOT NULL DEFAULT 0,
  
  -- Metrics
  products_sold INTEGER NOT NULL DEFAULT 0,
  quantity_sold INTEGER NOT NULL DEFAULT 0,
  sales_value NUMERIC NOT NULL DEFAULT 0,
  gross_profit NUMERIC NOT NULL DEFAULT 0,
  gross_profit_margin NUMERIC,
  
  -- Inventory analysis
  inventory_accuracy NUMERIC NOT NULL DEFAULT 0,
  missing_products TEXT[] NOT NULL DEFAULT '{}',
  extra_products TEXT[] NOT NULL DEFAULT '{}',
  low_stock_products JSONB NOT NULL DEFAULT '[]'::JSONB,
  out_of_stock_products JSONB NOT NULL DEFAULT '[]'::JSONB,
  stock_variance INTEGER NOT NULL DEFAULT 0,
  
  -- Top performers
  top_selling_products JSONB NOT NULL DEFAULT '[]'::JSONB,
  recommendations TEXT[] NOT NULL DEFAULT '{}',
  
  -- Approval workflow
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected')),
  prepared_by TEXT NOT NULL DEFAULT 'system',
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  
  -- Distribution
  report_url TEXT, -- Supabase storage URL for PDF
  shared_via_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  shared_at TIMESTAMP WITH TIME ZONE,
  shared_with TEXT[] NOT NULL DEFAULT '{}',
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_parallel_reports_business ON parallel_reports(business_id);
CREATE INDEX idx_parallel_reports_branch ON parallel_reports(branch_id);
CREATE INDEX idx_parallel_reports_date ON parallel_reports(report_date);
CREATE INDEX idx_parallel_reports_status ON parallel_reports(status);
CREATE INDEX idx_parallel_reports_approved ON parallel_reports(approved_by);

-- ========== PROCESSING LOGS ==========

CREATE TABLE IF NOT EXISTS processing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_file_id UUID NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
  report_id UUID REFERENCES parallel_reports(id) ON DELETE SET NULL,
  log_level TEXT NOT NULL CHECK (log_level IN ('info', 'warning', 'error', 'success')),
  message TEXT NOT NULL,
  details JSONB,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_processing_logs_file ON processing_logs(uploaded_file_id);
CREATE INDEX idx_processing_logs_report ON processing_logs(report_id);
CREATE INDEX idx_processing_logs_level ON processing_logs(log_level);

-- ========== ROW LEVEL SECURITY ==========

-- Enable RLS on all tables
ALTER TABLE parallel_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE parallel_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_logs ENABLE ROW LEVEL SECURITY;

-- Parallel Businesses: Admin can see their own businesses
CREATE POLICY "Admin can view their businesses"
  ON parallel_businesses
  FOR SELECT
  USING (admin_user_id = auth.uid());

CREATE POLICY "Admin can insert their businesses"
  ON parallel_businesses
  FOR INSERT
  WITH CHECK (admin_user_id = auth.uid());

CREATE POLICY "Admin can update their businesses"
  ON parallel_businesses
  FOR UPDATE
  USING (admin_user_id = auth.uid())
  WITH CHECK (admin_user_id = auth.uid());

-- Parallel Branches: Admin can manage branches for their businesses
CREATE POLICY "Admin can view branches of their businesses"
  ON parallel_branches
  FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin can insert branches"
  ON parallel_branches
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin can update branches"
  ON parallel_branches
  FOR UPDATE
  USING (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  );

-- Uploaded Files: Admin can manage files
CREATE POLICY "Admin can view uploaded files"
  ON uploaded_files
  FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin can insert files"
  ON uploaded_files
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin can update files"
  ON uploaded_files
  FOR UPDATE
  USING (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  );

-- Parallel Reports: Admin can manage, Dashboard users can view approved
CREATE POLICY "Admin can view all reports"
  ON parallel_reports
  FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin can insert reports"
  ON parallel_reports
  FOR INSERT
  WITH CHECK (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  );

CREATE POLICY "Admin can update reports"
  ON parallel_reports
  FOR UPDATE
  USING (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
    )
  );

-- Processing Logs: Admin can view logs
CREATE POLICY "Admin can view logs"
  ON processing_logs
  FOR SELECT
  USING (
    uploaded_file_id IN (
      SELECT id FROM uploaded_files 
      WHERE business_id IN (
        SELECT id FROM parallel_businesses WHERE admin_user_id = auth.uid()
      )
    )
  );

-- Dashboard Users: Can view their business profile
CREATE POLICY "Dashboard users can view their info"
  ON dashboard_users
  FOR SELECT
  USING (id = auth.uid());

-- Updates for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_parallel_businesses_updated_at BEFORE UPDATE ON parallel_businesses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_parallel_branches_updated_at BEFORE UPDATE ON parallel_branches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dashboard_users_updated_at BEFORE UPDATE ON dashboard_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_uploaded_files_updated_at BEFORE UPDATE ON uploaded_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_parallel_reports_updated_at BEFORE UPDATE ON parallel_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
