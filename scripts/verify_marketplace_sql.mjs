/**
 * Quick check: marketplace SQL applied + remote order path works.
 * Does not print secrets.
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function req(baseUrl, key, method, path, body) {
  const resp = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: resp.status, ok: resp.ok, json, text: String(text).slice(0, 300) };
}

(async () => {
  const env = parseEnv(fs.readFileSync(path.resolve('.env'), 'utf8'));
  const baseUrl = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = env.VITE_SUPABASE_ANON_KEY || '';
  const svc = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

  if (!baseUrl || !anon) {
    console.log('RESULT: missing env');
    process.exit(2);
  }

  const checks = [];

  // 1) Reachability
  try {
    const r = await req(baseUrl, svc || anon, 'GET', 'stores?select=id,name,is_public,company_id&limit=3');
    checks.push({ step: 'reach_supabase', ok: r.ok, status: r.status, detail: r.ok ? `stores=${Array.isArray(r.json) ? r.json.length : 0}` : r.text });
    var stores = Array.isArray(r.json) ? r.json : [];
  } catch (e) {
    checks.push({ step: 'reach_supabase', ok: false, detail: e.message });
    console.log(JSON.stringify({ working: false, reason: 'Supabase unreachable from this PC', checks }, null, 2));
    process.exit(1);
  }

  const publicStore = stores.find((s) => s.is_public !== false) || stores[0];
  if (!publicStore) {
    console.log(JSON.stringify({ working: false, reason: 'No stores found', checks }, null, 2));
    process.exit(1);
  }

  // 2) Anon can read public store
  const storeRead = await req(baseUrl, anon, 'GET', `stores?select=id,name,is_public&id=eq.${publicStore.id}`);
  checks.push({
    step: 'anon_read_store',
    ok: storeRead.ok && Array.isArray(storeRead.json) && storeRead.json.length > 0,
    status: storeRead.status,
    detail: storeRead.ok ? publicStore.name || publicStore.id : storeRead.text,
  });

  // 3) Anon can read products for that store
  const products = await req(baseUrl, anon, 'GET', `products?select=id,name,stock&store_id=eq.${publicStore.id}&limit=2`);
  checks.push({
    step: 'anon_read_products',
    ok: products.ok,
    status: products.status,
    detail: products.ok ? `count=${Array.isArray(products.json) ? products.json.length : 0}` : products.text,
  });

  // 4) Anon can insert online order (the key marketplace check)
  const orderId = `verify-${Date.now()}`;
  const orderPayload = {
    id: orderId,
    store_id: publicStore.id,
    company_id: publicStore.company_id || publicStore.id,
    customer_name: 'SQL Verify Customer',
    customer_phone: '0977000000',
    items: [{ productName: 'Verify Item', quantity: 1, priceAtOrder: 1 }],
    subtotal: 1,
    delivery_fee: 0,
    total: 1,
    status: 'pending',
    payment_method: 'mobile',
    payment_status: 'pending',
    order_number: 'ORD-VERIFY',
    delivery_notes: JSON.stringify({ order_number: 'ORD-VERIFY', source: 'ONLINE' }),
  };

  const insert = await req(baseUrl, anon, 'POST', 'online_orders', orderPayload);
  checks.push({
    step: 'anon_insert_order',
    ok: insert.ok,
    status: insert.status,
    detail: insert.ok ? orderId : insert.text,
  });

  // 5) Read pending back
  if (insert.ok) {
    const pending = await req(
      baseUrl,
      anon,
      'GET',
      `online_orders?select=id,status,customer_name,order_number&id=eq.${orderId}`
    );
    checks.push({
      step: 'read_pending_order',
      ok: pending.ok && Array.isArray(pending.json) && pending.json.length > 0,
      status: pending.status,
      detail: pending.ok ? pending.json[0] : pending.text,
    });

    // cleanup with service role if available
    if (svc) {
      await req(baseUrl, svc, 'DELETE', `online_orders?id=eq.${orderId}`);
      checks.push({ step: 'cleanup', ok: true });
    }
  }

  const working = checks.every((c) => c.ok);
  console.log(
    JSON.stringify(
      {
        working,
        store: { id: publicStore.id, name: publicStore.name, is_public: publicStore.is_public },
        checks,
      },
      null,
      2
    )
  );
  process.exit(working ? 0 : 1);
})();
