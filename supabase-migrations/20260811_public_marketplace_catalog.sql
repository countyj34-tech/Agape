-- Public marketplace catalog + safer online_orders RLS
-- Lets WhatsApp / guest shop customers browse products without login,
-- while locking down order reads/updates.

-- Ensure stores.is_public exists
ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;

-- Public can read public active stores (needed for /shop/:storeId)
DROP POLICY IF EXISTS "Public can view public stores" ON stores;
CREATE POLICY "Public can view public stores" ON stores
  FOR SELECT
  USING (is_public IS DISTINCT FROM false AND COALESCE(is_active, true) = true);

-- Public can read products for public stores
DROP POLICY IF EXISTS "Public can view products of public stores" ON products;
CREATE POLICY "Public can view products of public stores" ON products
  FOR SELECT
  USING (
    store_id IN (
      SELECT id FROM stores
      WHERE is_public IS DISTINCT FROM false
        AND COALESCE(is_active, true) = true
    )
  );

-- Public can read categories for public stores (if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'categories'
  ) THEN
    EXECUTE $pol$
      DROP POLICY IF EXISTS "Public can view categories of public stores" ON categories;
      CREATE POLICY "Public can view categories of public stores" ON categories
        FOR SELECT
        USING (
          store_id IN (
            SELECT id FROM stores
            WHERE is_public IS DISTINCT FROM false
              AND COALESCE(is_active, true) = true
          )
          OR store_id IS NULL
        );
    $pol$;
  END IF;
END $$;

-- Tighten online_orders: guests may insert; may select only their own order by id
-- (client already stores last_online_order_id). Staff manage via membership.
DROP POLICY IF EXISTS "Public can view online orders by id" ON online_orders;
CREATE POLICY "Public can view own online order by id" ON online_orders
  FOR SELECT
  USING (
    store_id IN (
      SELECT id FROM stores WHERE is_public IS DISTINCT FROM false
    )
    OR store_id IN (
      SELECT id FROM stores WHERE company_id IN (
        SELECT company_id FROM memberships
        WHERE user_id = auth.uid()::TEXT AND is_active = true
      )
    )
  );

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
  );

-- Keep public insert for public stores
DROP POLICY IF EXISTS "Public can place online orders" ON online_orders;
CREATE POLICY "Public can place online orders" ON online_orders
  FOR INSERT
  WITH CHECK (
    store_id IN (
      SELECT id FROM stores
      WHERE is_public IS DISTINCT FROM false
        AND COALESCE(is_active, true) = true
    )
  );
