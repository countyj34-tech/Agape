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
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
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

const endpoint = new URL('/auth/v1/admin/users?limit=100', SUPABASE_URL);

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
      let users = [];
      if (Array.isArray(json)) users = json;
      else if (json && Array.isArray(json.users)) users = json.users;
      else if (json && Array.isArray(json.data)) users = json.data;
      else if (json && Array.isArray(json.list)) users = json.list;

      if (!users || users.length === 0) {
        console.log('No users found. Raw response:');
        console.log(data);
        process.exit(0);
      }

      for (const u of users) {
        const email = u.email || (u.user_metadata && u.user_metadata.email) || (u.identities && u.identities[0] && u.identities[0].identity_data && u.identities[0].identity_data.email) || null;
        console.log(`${u.id || u.user_id || '-'}  ${email || '(no email)'} `);
      }
    } catch (err) {
      console.error('Failed to parse response:', err.message || err);
      console.log('Raw response:', data);
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message || e);
});

req.end();
