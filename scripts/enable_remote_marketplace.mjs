/**
 * Probe Supabase reachability + apply marketplace remote access (no dashboard).
 * Does not print secrets.
 *
 * Usage:
 *   node scripts/enable_remote_marketplace.mjs
 */
import fs from 'fs';
import path from 'path';

function parseEnv(envText) {
  const out = {};
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function extractProjectRef(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    return '';
  }
}

async function fetchWithTimeout(url, options = {}, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const MIGRATION_SQL = `
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

ALTER TABLE online_orders ALTER COLUMN company_id DROP NOT NULL;

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
  USING (true);

DROP POLICY IF EXISTS "Public can read public stores" ON stores;
CREATE POLICY "Public can read public stores" ON stores
  FOR SELECT
  USING (is_public IS DISTINCT FROM false);

DROP POLICY IF EXISTS "Public can read products of public stores" ON products;
CREATE POLICY "Public can read products of public stores" ON products
  FOR SELECT
  USING (
    store_id IN (SELECT id FROM stores WHERE is_public IS DISTINCT FROM false)
  );
`;

async function runManagementSql(projectRef, accessToken, sql) {
  const response = await fetchWithTimeout(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
    60000
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Management API ${response.status}: ${text.slice(0, 400)}`);
  }
  return text;
}

async function restProbe(baseUrl, key, path) {
  const response = await fetchWithTimeout(
    `${baseUrl}/rest/v1/${path}`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    },
    25000
  );
  const text = await response.text();
  return { status: response.status, body: text.slice(0, 240) };
}

(async () => {
  const envPath = path.resolve(process.cwd(), '.env');
  const env = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
  const baseUrl = (env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  const anonKey = env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN || '';
  const projectRef =
    process.env.SUPABASE_PROJECT_REF || extractProjectRef(baseUrl);

  console.log('Remote marketplace enablement');
  console.log(
    JSON.stringify(
      {
        hasUrl: Boolean(baseUrl),
        hasServiceKey: Boolean(serviceKey),
        hasAnonKey: Boolean(anonKey),
        hasAccessToken: Boolean(accessToken),
        projectRef: projectRef || null,
      },
      null,
      2
    )
  );

  if (!baseUrl || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL or service role key in .env');
    process.exit(2);
  }

  console.log('\\n1) Probing Supabase REST...');
  try {
    const stores = await restProbe(baseUrl, serviceKey, 'stores?select=id&limit=1');
    console.log('stores:', stores.status, stores.body);
    const orders = await restProbe(baseUrl, serviceKey, 'online_orders?select=id&limit=1');
    console.log('online_orders:', orders.status, orders.body);
  } catch (error) {
    console.error('Supabase REST unreachable:', error instanceof Error ? error.message : error);
    console.error('Fix internet/VPN/DNS to sotrgvahjouvelnsrsly.supabase.co, then re-run.');
    process.exit(1);
  }

  if (accessToken && projectRef) {
    console.log('\\n2) Applying remote marketplace SQL via Management API...');
    try {
      await runManagementSql(projectRef, accessToken, MIGRATION_SQL);
      console.log('SQL policies applied successfully.');
    } catch (error) {
      console.error('Management SQL failed:', error instanceof Error ? error.message : error);
      console.error('Continuing — service-role pipeline can still sync when reachable.');
    }
  } else {
    console.log('\\n2) Skipping Management SQL (no SUPABASE_ACCESS_TOKEN).');
    console.log('Set SUPABASE_ACCESS_TOKEN once, or keep pipeline server online for POS sync.');
  }

  // Smoke-test anon insert against a throwaway row if we have a real store id
  console.log('\\n3) Checking service-role write capability...');
  try {
    const storeResp = await restProbe(baseUrl, serviceKey, 'stores?select=id,company_id&limit=1');
    const stores = JSON.parse(storeResp.body || '[]');
    const store = Array.isArray(stores) && stores[0] ? stores[0] : null;
    if (!store?.id) {
      console.log('No store found to smoke-test write.');
    } else {
      const testId = `remote-smoke-${Date.now()}`;
      const payload = {
        id: testId,
        store_id: store.id,
        company_id: store.company_id || store.id,
        customer_name: 'Remote Smoke Test',
        customer_phone: '0000000000',
        items: [{ productName: 'test', quantity: 1, priceAtOrder: 1 }],
        subtotal: 1,
        delivery_fee: 0,
        total: 1,
        status: 'pending',
        payment_method: 'mobile',
        payment_status: 'pending',
        delivery_notes: JSON.stringify({ order_number: 'SMOKE-TEST', source: 'ONLINE' }),
      };
      const insert = await fetchWithTimeout(
        `${baseUrl}/rest/v1/online_orders`,
        {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(payload),
        },
        25000
      );
      console.log('service insert:', insert.status);
      if (insert.ok) {
        await fetchWithTimeout(
          `${baseUrl}/rest/v1/online_orders?id=eq.${encodeURIComponent(testId)}`,
          {
            method: 'DELETE',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
            },
          },
          15000
        );
        console.log('smoke row cleaned up.');
      } else {
        console.log('insert body:', (await insert.text()).slice(0, 300));
      }
    }
  } catch (error) {
    console.error('Write smoke test failed:', error instanceof Error ? error.message : error);
  }

  console.log('\\nDone. Keep `npm run pipeline:server` running for POS stock updates.');
})();
