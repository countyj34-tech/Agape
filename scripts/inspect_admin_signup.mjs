import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function parseDotEnv(raw) {
  const lines = raw.split(/\r?\n/);
  const out = {};
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function run() {
  const cwd = process.cwd();
  let raw = '';
  try { raw = await fs.readFile(path.join(cwd, '.env'), 'utf8'); } catch(e) { raw = ''; }
  const parsed = parseDotEnv(raw);

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL || '';
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || parsed.VITE_SUPABASE_ANON_KEY || parsed.SUPABASE_ANON_KEY || '';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error('Missing SUPABASE_URL or ANON_KEY');
    process.exit(1);
  }

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const admin = SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;

  const suffix = `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const payload = {
    email: `fn-admin-${suffix}@example.com`,
    password: 'P@ssw0rd1',
    companyName: `Fn Company ${suffix}`,
    companyEmail: `fn-company-${suffix}@example.com`,
    storeName: `Fn Store ${suffix}`,
    storeLocation: 'Fn Location',
    staffName: 'Fn Owner',
    staffPhone: `2609${Math.floor(1000000 + Math.random() * 8999999)}`,
    pin: '123456',
    role: 'owner'
  };

  try {
    console.log('Invoking admin-signup Edge function (anon client)...');
    const res = await anon.functions.invoke('admin-signup', { body: payload, headers: { 'Content-Type': 'application/json' } });
    const out = { invokedAt: new Date().toISOString(), payload, result: res };
    const outPath = path.join(cwd, 'scripts', 'admin_signup_response.json');
    await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote function response to scripts/admin_signup_response.json');

    // Attempt cleanup if admin client and function returned ids
    const fnData = res.data || res;
    const companyId = fnData?.company?.id || fnData?.company_id || fnData?.companyId;
    const storeId = fnData?.store?.id || fnData?.store_id || fnData?.storeId;
    const ownerUserId = fnData?.user?.id || fnData?.user_id || fnData?.userId || fnData?.user?.user_id;

    if (admin && companyId) {
      console.log('Cleaning up function-created resources via admin client...');
      try {
        await admin.from('memberships').delete().eq('company_id', companyId);
        await admin.from('profiles').delete().eq('company_id', companyId);
        await admin.from('stores').delete().eq('company_id', companyId);
        await admin.from('companies').delete().eq('id', companyId);
        if (ownerUserId) {
          try { await admin.auth.admin.deleteUser(ownerUserId); } catch (e) { console.warn('Failed to delete owner user:', e); }
        }
        console.log('Cleanup complete');
      } catch (cleanupErr) {
        console.warn('Cleanup errors occurred:', cleanupErr);
      }
    } else {
      console.log('Admin client not available or no companyId returned; skipping cleanup. Inspect admin_signup_response.json to clean up manually.');
    }
  } catch (e) {
    console.error('Function invocation failed:', e);
    process.exit(1);
  }
}

run().catch((e) => { console.error('Script failed:', e); process.exit(1); });
