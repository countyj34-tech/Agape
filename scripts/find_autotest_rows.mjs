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
  try { raw = await fs.readFile(path.join(cwd, '.env'), 'utf8'); } catch (e) { raw = ''; }
  const parsed = parseDotEnv(raw);

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL || '';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in environment or .env before running this script.');
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const { data: companies, error: cErr } = await admin.from('companies').select('*').ilike('name', 'AutoTest Company%');
    const { data: stores, error: sErr } = await admin.from('stores').select('*').ilike('name', 'AutoTest Store%');
    const { data: staff, error: stErr } = await admin.from('staff').select('*').ilike('email', 'autotest-staff-%@example.com');

    console.log(JSON.stringify({ fetchedAt: new Date().toISOString(), companies: { count: companies?.length||0, rows: companies||[] }, stores: { count: stores?.length||0, rows: stores||[] }, staff: { count: staff?.length||0, rows: staff||[] } }, null, 2));
  } catch (e) {
    console.error('Query failed:', e);
    process.exit(1);
  }
}

run().catch((e) => { console.error('Script failed:', e); process.exit(1); });
