import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function parseEnv(envText) {
  const out = {};
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    out[key] = val;
  }
  return out;
}

const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error('.env file not found in project root');
  process.exit(2);
}
const envText = fs.readFileSync(envPath, 'utf8');
const env = parseEnv(envText);
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Supabase URL or service role key missing in .env');
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

(async () => {
  try {
    const companyEmail = 'copilot+company20260506@example.com';
    const companyName = 'Copilot Test Company 20260506';

    console.log('Querying companies by email...');
    const { data: byEmail, error: e1 } = await supabase.from('companies').select('*').eq('email', companyEmail).limit(10);
    if (e1) console.error('Error querying by email:', e1.message || e1);
    console.log('Companies by email:', JSON.stringify(byEmail, null, 2));

    console.log('Querying companies by name...');
    const { data: byName, error: e2 } = await supabase.from('companies').select('*').ilike('name', companyName);
    if (e2) console.error('Error querying by name:', e2.message || e2);
    console.log('Companies by name:', JSON.stringify(byName, null, 2));

    const candidate = (byEmail && byEmail[0]) || (byName && byName[0]);
    if (!candidate) {
      console.log('No matching company found.');
      process.exit(0);
    }

    console.log('Found company:', candidate.id, candidate.name, candidate.email);
    console.log('Querying stores for company id:', candidate.id);
    const { data: stores, error: sErr } = await supabase.from('stores').select('*').eq('company_id', candidate.id);
    if (sErr) console.error('Error querying stores:', sErr.message || sErr);
    console.log('Stores:', JSON.stringify(stores, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Script error', err);
    process.exit(1);
  }
})();
