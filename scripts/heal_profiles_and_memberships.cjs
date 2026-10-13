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
const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const SERVICE_KEY = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Try to read backup company/store ids if available
let backup = null;
try {
  backup = JSON.parse(fs.readFileSync('./backups/test-setup-result.json', 'utf8'));
} catch (e) {
  // ignore
}

const FALLBACK_COMPANY = (backup && backup.company && backup.company.id) || env.VITE_COMPANY_ID || null;
const FALLBACK_STORE = (backup && backup.store && backup.store.id) || env.VITE_STORE_ID || null;

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
    console.log('Healing profiles and memberships (using service-role key)');

    // 1) Fetch auth users (requires service role)
    console.log('Fetching auth users...');
    // Try PostgREST users view first
    let usersRes = await request('GET', '/rest/v1/users?select=*');
    let users = [];
    if (!usersRes || usersRes.status >= 400) {
      console.warn('PostgREST /rest/v1/users unavailable (status:', usersRes && usersRes.status, '), attempting admin auth endpoint');
      // Try Auth Admin REST endpoint
      const adminAuthRes = await request('GET', '/auth/v1/admin/users');
      if (!adminAuthRes || adminAuthRes.status >= 400) {
        console.error('Failed to fetch users from admin endpoint:', adminAuthRes && adminAuthRes.status, adminAuthRes && adminAuthRes.body);
        process.exit(1);
      }
      try {
        const parsed = JSON.parse(adminAuthRes.body || '[]');
        // Support multiple shapes: array directly, or { users: [...] }, or { data: [...] }
        if (Array.isArray(parsed)) users = parsed;
        else if (parsed && Array.isArray(parsed.users)) users = parsed.users;
        else if (parsed && Array.isArray(parsed.data)) users = parsed.data;
        else {
          // unknown shape
          console.warn('Admin users response shape unexpected, attempting to normalize');
          users = Array.isArray(parsed) ? parsed : [];
        }
      } catch (e) {
        console.error('Failed to parse admin users response:', e.message || e, adminAuthRes.body);
        process.exit(1);
      }
    } else {
      try {
        users = JSON.parse(usersRes.body || '[]');
      } catch (e) {
        console.error('Failed to parse users response:', e.message || e, usersRes.body);
        process.exit(1);
      }
    }

    console.log('Auth users found:', users.length);

    let createdProfiles = 0;
    let createdMemberships = 0;
    let skipped = 0;

    for (const user of users) {
      const userId = user.id;
      if (!userId) continue;

      // Skip service accounts or anon if any
      // (no robust check here; assume user rows represent real users)

      // 2) Check for profiles row
      const profGet = await request('GET', `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`);
      if (!profGet) {
        console.warn('profiles GET failed for', userId);
        continue;
      }

      let profRows = [];
      try { profRows = JSON.parse(profGet.body || '[]'); } catch (e) { profRows = []; }

      if (Array.isArray(profRows) && profRows.length > 0) {
        // profile exists
      } else {
        // Build profile payload from user metadata or fallbacks
        let meta = {};
        try {
          if (user.user_metadata && typeof user.user_metadata === 'object') meta = user.user_metadata;
          else if (user.user_metadata && typeof user.user_metadata === 'string') meta = JSON.parse(user.user_metadata);
        } catch (e) { /* ignore */ }
        try {
          if (!meta || Object.keys(meta).length === 0) {
            if (user.raw_user_meta_data) {
              try { meta = JSON.parse(user.raw_user_meta_data); } catch (e) { }
            }
          }
        } catch (e) { /* ignore */ }

        const fullName = meta.full_name || meta.fullName || meta.name || null;
        const phone = meta.phone || meta.phone_number || meta.phoneNumber || null;
        const role = meta.role || 'staff';
        const company_id = meta.company_id || meta.companyId || FALLBACK_COMPANY || null;
        const store_id = meta.store_id || meta.storeId || FALLBACK_STORE || null;

        const profilePayload = {
          id: userId,
          email: user.email || null,
          full_name: fullName,
          phone: phone,
          role: role,
          company_id: company_id,
          store_id: store_id,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        console.log('Creating profile for', user.email || userId, 'company:', company_id, 'store:', store_id);
        const createProfRes = await request('POST', '/rest/v1/profiles', JSON.stringify([profilePayload]));
        if (createProfRes && createProfRes.status >= 200 && createProfRes.status < 300) {
          createdProfiles++;
        } else {
          console.warn('Failed creating profile for', userId, createProfRes && createProfRes.status, createProfRes && createProfRes.body);
          skipped++;
          continue;
        }

        // Create membership if possible
        if (company_id) {
          // check existing membership
          const memGet = await request('GET', `/rest/v1/memberships?user_id=eq.${encodeURIComponent(userId)}&select=*`);
          let memRows = [];
          try { memRows = JSON.parse(memGet.body || '[]'); } catch (e) { memRows = []; }
          if (!Array.isArray(memRows) || memRows.length === 0) {
            const membershipPayload = {
              user_id: userId,
              company_id: company_id,
              role: role || 'staff',
              store_id: store_id || null,
              is_active: true,
              joined_at: new Date().toISOString()
            };
            const createMemRes = await request('POST', '/rest/v1/memberships', JSON.stringify([membershipPayload]));
            if (createMemRes && createMemRes.status >= 200 && createMemRes.status < 300) {
              createdMemberships++;
            } else {
              console.warn('Failed creating membership for', userId, createMemRes && createMemRes.status, createMemRes && createMemRes.body);
            }
          }
        }
      }
    }

    console.log('Done. Created profiles:', createdProfiles, 'Created memberships:', createdMemberships, 'Skipped:', skipped);
    process.exit(0);
  } catch (err) {
    console.error('Script error', err);
    process.exit(1);
  }
})();
