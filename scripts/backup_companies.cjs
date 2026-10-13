const fs = require('fs');
const https = require('https');
const { URL } = require('url');

function parseEnv(filePath = '.env') {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    const env = {};
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) {
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[m[1]] = val;
      }
    }
    return env;
  } catch (err) {
    console.error('Failed to read .env:', err.message || err);
    process.exit(1);
  }
}

const env = parseEnv();
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Build endpoint to fetch companies; request a high limit to get all rows
const endpoint = new URL('/rest/v1/companies?select=*&limit=10000', SUPABASE_URL);

const options = {
  hostname: endpoint.hostname,
  port: endpoint.port || 443,
  path: endpoint.pathname + endpoint.search,
  method: 'GET',
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Accept: 'application/json',
  },
};

console.log('Requesting', endpoint.href);

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    if (!data) {
      console.error('Empty response. Status code:', res.statusCode);
      process.exit(1);
    }

    try {
      const json = JSON.parse(data);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = 'backups';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      const outPath = `${dir}/companies-backup-${ts}.json`;
      fs.writeFileSync(outPath, JSON.stringify(json, null, 2), 'utf8');
      console.log('Saved backup to', outPath, 'rows:', Array.isArray(json) ? json.length : 'unknown');
    } catch (err) {
      console.error('Failed to parse response or write file:', err.message || err);
      console.log('Raw response:', data.slice(0, 2000));
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message || e);
});

req.end();
