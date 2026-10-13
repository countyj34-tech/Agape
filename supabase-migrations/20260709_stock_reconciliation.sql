-- AI Stock Reconciliation sessions (super admin only)
-- Safe additive migration: does not modify existing POS tables.

CREATE TABLE IF NOT EXISTS stock_reconciliation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_name TEXT NOT NULL,
  store_id UUID NOT NULL,
  store_name TEXT NOT NULL,
  report_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  sale_id UUID,
  upload_started_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  processing_duration_ms INTEGER,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  prepared_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_reconciliation_company ON stock_reconciliation_sessions(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_reconciliation_store_date ON stock_reconciliation_sessions(store_id, report_date);
CREATE INDEX IF NOT EXISTS idx_stock_reconciliation_status ON stock_reconciliation_sessions(status);

ALTER TABLE stock_reconciliation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_reconciliation_service_role_all ON stock_reconciliation_sessions;
CREATE POLICY stock_reconciliation_service_role_all ON stock_reconciliation_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Allow master users (super_admin) to manage reconciliation sessions from the app
DROP POLICY IF EXISTS stock_reconciliation_super_admin_all ON stock_reconciliation_sessions;
CREATE POLICY stock_reconciliation_super_admin_all ON stock_reconciliation_sessions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- Allow master (super_admin) to read all companies, stores, and products for remote AI stock processing
DROP POLICY IF EXISTS products_super_admin_select ON products;
CREATE POLICY products_super_admin_select ON products
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS companies_super_admin_select ON companies;
CREATE POLICY companies_super_admin_select ON companies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS stores_super_admin_select ON stores;
CREATE POLICY stores_super_admin_select ON stores
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS products_super_admin_update ON products;
CREATE POLICY products_super_admin_update ON products
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );
