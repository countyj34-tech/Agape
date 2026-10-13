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

  const tables = ['companies','stores','staff'];
  const result = {};
  for (const t of tables) {
    try {
      const { count, error } = await admin.from(t).select('id', { count: 'exact', head: true });
      if (error) {
        result[t] = { error: String(error.message || error) };
      } else {
        result[t] = { count: typeof count === 'number' ? count : null };
      }
    } catch (e) {
      result[t] = { error: String(e) };
    }
  }

  console.log(JSON.stringify({ fetchedAt: new Date().toISOString(), result }, null, 2));
}

run().catch((e) => { console.error('Script failed:', e); process.exit(1); });
