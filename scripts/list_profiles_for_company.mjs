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
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

(async () => {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      console.error('.env file not found in project root');
      process.exit(2);
    }
    const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
    const url = env.VITE_SUPABASE_URL;
    const key = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('Supabase URL or service role key missing in .env');
      process.exit(2);
    }

    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const companyId = process.argv[2];
    if (!companyId) {
      console.error('Usage: node scripts/list_profiles_for_company.mjs <company_id>');
      process.exit(2);
    }

    console.log('Querying profiles for company:', companyId);
    const { data: profiles, error } = await supabase.from('profiles').select('*').eq('company_id', companyId);
    if (error) {
      console.error('Failed to query profiles:', error.message || error);
      process.exit(1);
    }

    if (!profiles || profiles.length === 0) {
      console.log('No profiles found for company.');
      process.exit(0);
    }

    console.log(JSON.stringify(profiles, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Script error', err);
    process.exit(1);
  }
})();
