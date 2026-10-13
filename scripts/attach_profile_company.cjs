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

const [userId, companyId, storeId] = process.argv.slice(2);
if (!userId || !companyId || !storeId) {
  console.error('Usage: node scripts/attach_profile_company.cjs <auth_user_id> <company_id> <store_id>');
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
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      }
    };

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
    const path = `/rest/v1/profiles?id=eq.${userId}`;
    const payload = JSON.stringify({ company_id: companyId, store_id: storeId });
    console.log('Patching profile for user:', userId);
    const res = await request('PATCH', path, payload);
    console.log('Status:', res.status);
    console.log('Body:', res.body);

    // Also ensure membership exists
    const membershipPath = '/rest/v1/memberships';
    const membershipPayload = JSON.stringify([
      {
        user_id: userId,
        profile_id: userId,
        company_id: companyId,
        role: 'staff',
        store_id: storeId,
        is_active: true,
        joined_at: new Date().toISOString()
      }
    ]);

    console.log('Upserting membership (insert attempt)...');
    const memRes = await request('POST', membershipPath, membershipPayload);
    console.log('Membership POST status:', memRes.status);
    console.log('Membership body:', memRes.body);
  } catch (err) {
    console.error('Error attaching profile/company:', err.message || err);
    process.exit(1);
  }
})();
