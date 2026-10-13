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

function postJson(path, body, preferReturn = true) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(path, SUPABASE_URL);
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
    if (preferReturn) options.headers.Prefer = 'return=representation';

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : null;
          if (res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode} - ${data}`));
          }
          resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.write(body);
    req.end();
  });
}

(async () => {
  try {
    const backupPath = 'backups/test-setup-result.json';
    if (!fs.existsSync(backupPath)) {
      console.error('Backup file not found. Run create_test_company_store_user.cjs first.');
      process.exit(1);
    }

    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const company = backup.company;
    const store = backup.store;
    if (!company || !store) {
      console.error('Invalid backup contents; missing company or store');
      process.exit(1);
    }

    const ts = Date.now();
    const staffEmail = `autotest-staff+${ts}@example.com`;
    const randomSuffix = Math.floor(Math.random() * 900000) + 100000;
    const staffPhone = `26097${String(randomSuffix)}`;
    const staffPin = '654321';
    const nowIso = new Date().toISOString();

    console.log('Creating auth user for staff...');
    const authEndpoint = new URL('/auth/v1/admin/users', SUPABASE_URL);
    const authOptions = {
      hostname: authEndpoint.hostname,
      port: authEndpoint.port || 443,
      path: authEndpoint.pathname + authEndpoint.search,
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    };

    const authPayload = JSON.stringify({
      email: staffEmail,
      password: staffPin,
      email_confirm: true,
      user_metadata: { full_name: `Autotest Staff ${ts}`, phone: staffPhone, role: 'staff', company_id: company.id, store_id: store.id }
    });

    const createAuthUser = () => new Promise((resolve, reject) => {
      const req = https.request(authOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : null;
            if (res.statusCode >= 400) return reject(new Error(`Auth create failed: HTTP ${res.statusCode} - ${data}`));
            const user = json?.user || json || null;
            resolve(user);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.write(authPayload);
      req.end();
    });

    const user = await createAuthUser();
    if (!user || !user.id) throw new Error('Auth user creation failed');
    console.log('Created auth user id:', user.id);

    console.log('Inserting profile...');
    const profilePayload = [
      {
        id: user.id,
        email: staffEmail,
        full_name: `Autotest Staff ${ts}`,
        phone: staffPhone,
        role: 'staff',
        company_id: company.id,
        store_id: store.id,
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso
      }
    ];

    try {
      await postJson('/rest/v1/profiles', JSON.stringify(profilePayload));
      console.log('Profile inserted');
    } catch (pErr) {
      console.warn('Profile insert warning:', pErr.message || pErr);
    }

    console.log('Inserting staff row...');
    const staffRow = [
      {
        id: crypto.randomUUID(),
        company_id: company.id,
        store_id: store.id,
        name: `Autotest Staff ${ts}`,
        email: staffEmail,
        role: 'salesperson',
        phone: staffPhone,
        is_active: true,
        auth_user_id: user.id,
        pin_hash: `${staffPin}#MthunziPOS2026`,
        created_at: nowIso,
        updated_at: nowIso
      }
    ];

    const staffRes = await postJson('/rest/v1/staff', JSON.stringify(staffRow));
    const staffCreated = Array.isArray(staffRes) ? staffRes[0] : staffRes;
    if (!staffCreated) throw new Error('Staff insertion failed');
    console.log('Inserted staff id:', staffCreated.id || staffRow[0].id);

    const out = {
      staff: staffCreated,
      credentials: { email: staffEmail, pin: staffPin }
    };

    if (!fs.existsSync('backups')) fs.mkdirSync('backups');
    fs.writeFileSync('backups/staff-setup-result.json', JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote backups/staff-setup-result.json');
    console.log('Done.');
  } catch (err) {
    console.error('Error creating test staff:', err.message || err);
    process.exit(1);
  }
})();
