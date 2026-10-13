-- Marketplace online orders: align schema + allow public checkout → POS confirm flow

-- Extra columns used by the app (safe if already present)
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS discount NUMERIC DEFAULT 0;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'ONLINE';
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'collect';
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_category TEXT;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS mobile_provider TEXT;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS selected_bank TEXT;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_transaction_id TEXT;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS needs_payment_approval BOOLEAN DEFAULT false;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS verified_by_staff_id TEXT;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS completed_sale_id TEXT;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS approval_notes TEXT;

-- Broaden status + payment_status checks for app values
ALTER TABLE online_orders DROP CONSTRAINT IF EXISTS online_orders_status_check;
ALTER TABLE online_orders ADD CONSTRAINT online_orders_status_check
  CHECK (status IN (
    'pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled',
    'PENDING', 'AWAITING_APPROVAL', 'CONFIRMED', 'COMPLETED', 'CANCELLED'
  ));

ALTER TABLE online_orders DROP CONSTRAINT IF EXISTS online_orders_payment_status_check;
ALTER TABLE online_orders ADD CONSTRAINT online_orders_payment_status_check
  CHECK (payment_status IN (
    'pending', 'paid', 'failed',
    'UNPAID', 'PENDING_APPROVAL', 'PAID', 'PARTIAL'
  ));

-- Make company_id nullable so guest checkout can still insert if company lookup is delayed
ALTER TABLE online_orders ALTER COLUMN company_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_online_orders_order_number ON online_orders(order_number);

-- RLS: public marketplace can place orders for public stores; staff can manage
DROP POLICY IF EXISTS "Public can place online orders" ON online_orders;
CREATE POLICY "Public can place online orders" ON online_orders
  FOR INSERT
  WITH CHECK (
    store_id IN (SELECT id FROM stores WHERE is_public IS DISTINCT FROM false)
  );

DROP POLICY IF EXISTS "Public can view online orders by id" ON online_orders;
CREATE POLICY "Public can view online orders by id" ON online_orders
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Store members can update online orders" ON online_orders;
CREATE POLICY "Store members can update online orders" ON online_orders
  FOR UPDATE
  USING (
    store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
    OR store_id IN (SELECT id FROM stores WHERE is_public IS DISTINCT FROM false)
  );

DROP POLICY IF EXISTS "Store members can delete online orders" ON online_orders;
CREATE POLICY "Store members can delete online orders" ON online_orders
  FOR DELETE
  USING (
    store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
  );

-- Allow authenticated staff to update product stock after confirming online orders
DROP POLICY IF EXISTS "Store staff can manage products" ON products;
CREATE POLICY "Store staff can manage products" ON products
  FOR ALL USING (
    store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
  );
