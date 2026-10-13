import fs from 'fs/promises';
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
  let raw = '';
  try {
    raw = await fs.readFile('.env', 'utf8');
  } catch (e) {
    // ignore
  }
  const parsed = parseDotEnv(raw);

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL || '';
  const SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY || '';
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || parsed.VITE_SUPABASE_ANON_KEY || parsed.SUPABASE_ANON_KEY || '';

  function mask(s) {
    if (!s) return 'MISSING';
    if (s.length <= 12) return s;
    return `${s.slice(0,6)}...${s.slice(-6)}`;
  }

  const out = [];
  out.push(`SUPABASE_URL: ${SUPABASE_URL || 'MISSING'}`);
  out.push(`SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY ? mask(SERVICE_ROLE_KEY) : 'MISSING'}`);
  out.push(`ANON_KEY present: ${!!ANON_KEY}`);

  if (!SERVICE_ROLE_KEY || !SUPABASE_URL) {
    out.push('Result: missing required env values; cannot verify key.');
    await fs.writeFile('scripts/verify_service_key_output.txt', out.join('\n'), 'utf8');
    console.log(out.join('\n'));
    return;
  }

  // Create admin client and run a tiny admin query (select count of companies)
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const res = await admin.from('companies').select('id', { count: 'exact', head: true });
    // When head=true, data is null but count will be in res.count
    out.push(`Admin query status: ${res.error ? 'ERROR' : 'OK'}`);
    if (res.error) {
      function stringifyError(err) {
        try {
          return JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
        } catch (e) {
          return String(err);
        }
      }

      out.push(`Admin error raw: ${stringifyError(res.error)}`);
      if (res.error && res.error.status) out.push(`Admin error status: ${res.error.status}`);
      if (res.error && res.error.message) out.push(`Admin error message: ${String(res.error.message)}`);
      if (res.error && res.error.details) out.push(`Admin error details: ${JSON.stringify(res.error.details)}`);
    } else {
      out.push(`Admin count header: ${res.count ?? 'unknown'}`);
    }
  } catch (e) {
    out.push(`Admin client threw: ${String(e.message || e)}`);
  }

  // Save output to file and echo
  await fs.writeFile('scripts/verify_service_key_output.txt', out.join('\n'), 'utf8');
  console.log(out.join('\n'));
}

run().catch(e => {
  console.error('Script failed:', e);
  process.exit(1);
});
