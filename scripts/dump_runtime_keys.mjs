import fs from 'fs/promises';

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

function mask(s) {
  if (!s) return 'MISSING';
  if (s.length <= 12) return s;
  return `${s.slice(0,6)}...${s.slice(-6)}`;
}

async function run() {
  const raw = await (async () => {
    try { return await fs.readFile('.env', 'utf8'); } catch(e){ return ''; }
  })();
  const parsed = parseDotEnv(raw);

  const envVite = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';
  const envSup = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const fileVite = parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || '';
  const fileSup = parsed.SUPABASE_SERVICE_ROLE_KEY || '';

  console.log('Node version:', process.version);
  console.log('process.env.VITE_SUPABASE_SERVICE_ROLE_KEY:', envVite ? mask(envVite) : 'MISSING');
  console.log('process.env.SUPABASE_SERVICE_ROLE_KEY:', envSup ? mask(envSup) : 'MISSING');
  console.log('.env VITE_SUPABASE_SERVICE_ROLE_KEY:', fileVite ? mask(fileVite) : 'MISSING');
  console.log('.env SUPABASE_SERVICE_ROLE_KEY:', fileSup ? mask(fileSup) : 'MISSING');

  const chosen = envVite || envSup || fileVite || fileSup || '';
  console.log('Key chosen by e2e logic:', chosen ? mask(chosen) : 'MISSING');

  // Additional diagnostics
  console.log('lengths -> process.env:', envSup.length || 0, ' .env:', fileSup.length || 0);
  if (envSup && fileSup) {
    console.log('.env includes process.env value?', fileSup.includes(envSup));
    console.log('process.env includes .env value?', envSup.includes(fileSup));
  }

  if (!chosen) return;

  // Do a HEAD check
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL || '').replace(/\/$/, '') + '/rest/v1/companies?select=id&limit=1';
  if (!url) {
    console.log('No SUPABASE_URL found.');
    return;
  }

  try {
    const res = await fetch(url, { method: 'HEAD', headers: { Authorization: `Bearer ${chosen}`, apikey: chosen } });
    console.log('HEAD status:', res.status, res.statusText);
  } catch (e) {
    console.log('HEAD request failed:', e.message || e);
  }
}

run().catch(e => { console.error('dump failed', e); process.exit(1); });
