const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

(async () => {
  const env = parseEnv();
  const url = env.VITE_SUPABASE_URL;
  const serviceKey = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Supabase URL or service key missing in .env');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const profileId = process.argv[2];
  if (!profileId) {
    console.error('Usage: node scripts/debug_get_user.cjs <profileId>');
    process.exit(2);
  }

  try {
    console.log('Calling admin.auth.admin.getUserById(', profileId, ')');
    const res = await admin.auth.admin.getUserById(profileId);
    console.log('Raw result:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error calling getUserById:', err);
    process.exit(1);
  }
})();
