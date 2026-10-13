const fs = require('fs');
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');

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

// Try to read backup company/store ids if available
let companyId = null;
let storeId = null;
let backup = null;
try {
  backup = JSON.parse(fs.readFileSync('./backups/test-setup-result.json', 'utf8'));
  if (backup && backup.company && backup.company.id) companyId = backup.company.id;
  if (backup && backup.store && backup.store.id) storeId = backup.store.id;
} catch (e) {
  // ignore
}

// Fallback to env store id
if (!storeId && env.VITE_STORE_ID) storeId = env.VITE_STORE_ID;

if (!companyId || !storeId) {
  console.error('No company_id/store_id available. Add one to backups/test-setup-result.json or set VITE_STORE_ID in .env');
  process.exit(1);
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(path, SUPABASE_URL);
    const options = {
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: endpoint.pathname + endpoint.search,
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: 'application/json'
      }
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.headers.Prefer = 'return=representation';
    }
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => reject(e));
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  try {
    console.log('GET /rest/v1/staff?select=*');
    const getRes = await request('GET', '/rest/v1/staff?select=*');
    console.log('GET status:', getRes.status);
    console.log('GET body:', getRes.body);

    console.log('\nPOST /rest/v1/staff (full test row)');
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const payloadRow = {
      id,
      company_id: companyId,
      store_id: storeId,
      name: 'Diag Test ' + id.slice(0, 8),
      email: `diag+${Date.now()}@example.com`,
      role: 'other',
      phone: (backup && backup.store && backup.store.phone) || (backup && backup.company && backup.company.owner_phone) || '26000000000',
      is_active: true,
      auth_user_id: null,
      created_at: timestamp,
      updated_at: timestamp
    };

    const payload = JSON.stringify([payloadRow]);
    const postRes = await request('POST', '/rest/v1/staff', payload);
    console.log('POST status:', postRes.status);
    console.log('POST body:', postRes.body);

  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
})();
