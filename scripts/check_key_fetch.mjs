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

  const out = [];
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    out.push('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
    await fs.writeFile('scripts/check_key_fetch_output.txt', out.join('\n'), 'utf8');
    console.log(out.join('\n'));
    return;
  }

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/companies?select=id&limit=1`;
  out.push(`Requesting: ${url}`);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    out.push(`HTTP status: ${res.status} ${res.statusText}`);
    const text = await res.text();
    out.push('Body:');
    out.push(text.slice(0, 2000));
  } catch (e) {
    out.push(`Fetch failed: ${String(e)}`);
  }

  await fs.writeFile('scripts/check_key_fetch_output.txt', out.join('\n'), 'utf8');
  console.log(out.join('\n'));
}

run().catch(e => {
  console.error('Script failed:', e);
  process.exit(1);
});
