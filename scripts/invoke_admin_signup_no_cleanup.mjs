import fs from 'fs/promises';
import path from 'path';

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

  if (!SUPABASE_URL) {
    console.error('Missing SUPABASE_URL');
    process.exit(1);
  }

  const payload = {
    email: `fn-admin-no-cleanup-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}@example.com`,
    password: 'P@ssw0rd1',
    companyName: `Fn Company NC ${Date.now().toString().slice(-6)}`,
    companyEmail: `fn-company-nc-${Date.now().toString().slice(-6)}@example.com`,
    companyPhone: `2609${Math.floor(1000000 + Math.random() * 8999999)}`,
    storeName: `Fn Store NC ${Date.now().toString().slice(-6)}`,
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
    console.log('Invoking (no cleanup):', url);
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const text = await res.text();
    let parsedBody = null;
    try { parsedBody = JSON.parse(text); } catch(e) { parsedBody = text; }

    const out = { invokedAt: new Date().toISOString(), url, status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), payload, body: parsedBody };
    const outPath = path.join(cwd, 'scripts', 'admin_signup_no_cleanup_response.json');
    await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote', outPath);
  } catch (e) {
    console.error('Invocation failed:', e);
    process.exit(1);
  }
}

run().catch((e) => { console.error('Script failed:', e); process.exit(1); });
