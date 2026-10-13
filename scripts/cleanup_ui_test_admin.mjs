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
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const file = path.join(cwd, 'scripts', 'ui_test_admin.json');
  let data = null;
  try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { console.error('Failed to read ui_test_admin.json', e); process.exit(1); }

  const { email, pin, companyId, storeId, userId } = data;

  try {
    console.log('Deleting memberships for company:', companyId);
    await admin.from('memberships').delete().eq('company_id', companyId);
    console.log('Deleting profiles for company:', companyId);
    await admin.from('profiles').delete().eq('company_id', companyId);
    console.log('Deleting stores for company:', companyId);
    await admin.from('stores').delete().eq('company_id', companyId);
    console.log('Deleting companies:', companyId);
    await admin.from('companies').delete().eq('id', companyId);

    if (userId) {
      console.log('Deleting auth user:', userId);
      try { await admin.auth.admin.deleteUser(userId); } catch (e) { console.warn('Failed to delete auth user:', e); }
    }

    // remove file
    try { await fs.unlink(file); } catch (e) { /* ignore */ }

    console.log('Cleanup complete');
    process.exit(0);
  } catch (e) {
    console.error('Cleanup failed:', e);
    process.exit(1);
  }
}

run().catch(e => { console.error('Script failed:', e); process.exit(1); });
