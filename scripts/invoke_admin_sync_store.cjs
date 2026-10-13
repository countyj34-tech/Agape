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

let backup;
try {
  backup = JSON.parse(fs.readFileSync('./backups/test-setup-result.json', 'utf8'));
} catch (e) {
  console.error('Failed to read backups/test-setup-result.json:', e.message || e);
  process.exit(1);
}

if (!backup || !backup.company || !backup.store) {
  console.error('Backup file missing company or store objects');
  process.exit(1);
}

function post(path, bodyObj) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(path, SUPABASE_URL);
    const payload = JSON.stringify(bodyObj);
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
    const payload = { company: backup.company, store: backup.store };
    console.log('Invoking admin-sync-store with payload: company.id=', backup.company.id, 'store.id=', backup.store.id);
    const res = await post('/functions/v1/admin-sync-store', payload);
    console.log('Status:', res.status);
    console.log('Body:', res.body);
  } catch (err) {
    console.error('Error invoking function:', err.message || err);
    process.exit(1);
  }
})();
