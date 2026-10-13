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

function post(path, bodyObj) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(path, SUPABASE_URL);
    const payload = bodyObj ? JSON.stringify(bodyObj) : '';
    const options = {
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: endpoint.pathname + endpoint.search,
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => reject(e));
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  try {
    const functions = [
      { name: 'admin-sync-store', payload: { store: { id: 'diag-store', company_id: 'diag-company' } } },
      { name: 'admin-sync-staff', payload: { company_id: 'diagnostic-check' } },
      { name: 'admin-signup', payload: { email: 'diag+fn@example.com', pin: '000000', name: 'Diag' } }
    ];

    for (const fn of functions) {
      const path = `/functions/v1/${fn.name}`;
      console.log(`Checking function: ${fn.name} -> ${SUPABASE_URL}${path}`);
      try {
        const res = await post(path, fn.payload);
        console.log(`${fn.name} status: ${res.status}`);
        console.log(`${fn.name} body: ${res.body}`);
      } catch (err) {
        console.error(`${fn.name} request error:`, err.message || err);
      }
      console.log('---');
    }
  } catch (err) {
    console.error('Error checking functions:', err.message || err);
    process.exit(1);
  }
})();
