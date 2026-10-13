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

  if (!SUPABASE_URL) {
    console.error('Missing SUPABASE_URL');
    process.exit(1);
  }

  const payload = {
    email: `fn-admin-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}@example.com`,
    password: 'P@ssw0rd1',
    companyName: `Fn Company ${Date.now().toString().slice(-6)}`,
    companyEmail: `fn-company-${Date.now().toString().slice(-6)}@example.com`,
    companyPhone: `2609${Math.floor(1000000 + Math.random() * 8999999)}`,
    storeName: `Fn Store ${Date.now().toString().slice(-6)}`,
    storeLocation: 'Fn Location',
    staffName: 'Fn Owner',
    staffPhone: `2609${Math.floor(1000000 + Math.random() * 8999999)}`,
    pin: '123456',
    role: 'owner'
  };

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/admin-signup`;
  const headers = { 'Content-Type': 'application/json' };
  if (ANON_KEY) headers['Authorization'] = `Bearer ${ANON_KEY}`;

  try {
    console.log('POST', url);
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const text = await res.text();
    let parsedBody = null;
    try { parsedBody = JSON.parse(text); } catch(e) { parsedBody = text; }

    const out = { invokedAt: new Date().toISOString(), url, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), payload, body: parsedBody };
    await fs.writeFile(path.join(cwd, 'scripts', 'admin_signup_debug_response.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote scripts/admin_signup_debug_response.json');

    // Attempt cleanup if we have service role and function returned ids
    if (SERVICE_ROLE_KEY && parsedBody && typeof parsedBody === 'object') {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const userId = parsedBody?.uid || parsedBody?.user_id || parsedBody?.user?.id || parsedBody?.uid;
      const companyId = parsedBody?.company_id || parsedBody?.company?.id;
      if (companyId) {
        try {
          console.log('Attempting cleanup of created rows for company:', companyId);
          await admin.from('memberships').delete().eq('company_id', companyId);
          await admin.from('profiles').delete().eq('company_id', companyId);
          await admin.from('stores').delete().eq('company_id', companyId);
          await admin.from('companies').delete().eq('id', companyId);
          if (userId) {
            try { await admin.auth.admin.deleteUser(userId); } catch (e) { console.warn('Failed to delete owner user:', e); }
          }
          console.log('Cleanup complete');
        } catch (cleanupErr) {
          console.warn('Cleanup errors occurred:', cleanupErr);
        }
      } else {
        console.log('No companyId returned; skipping cleanup');
      }
    } else {
      console.log('No SERVICE_ROLE_KEY available or no usable body; skipping cleanup');
    }

  } catch (e) {
    console.error('Invocation failed:', e);
    process.exit(1);
  }
}

run().catch((e) => { console.error('Script failed:', e); process.exit(1); });
