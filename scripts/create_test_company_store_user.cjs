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
    // Set a timeout so the script doesn't hang indefinitely
    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.write(body);
    req.end();
  });
}

(async () => {
  try {
    const ts = Date.now();
    const companyName = `AUTOTEST COMPANY ${ts}`;
    const adminEmail = `autotest+${ts}@example.com`;
    // Generate a pseudo-unique phone to avoid duplicate-key conflicts
    const randomSuffix = Math.floor(Math.random() * 900000) + 100000; // 6 digits
    const adminPhone = `26097${String(randomSuffix)}`;
    const adminPin = '123456';
    const nowIso = new Date().toISOString();

    console.log('Creating company...');
    const companyPayload = [
      {
        id: crypto.randomUUID(),
        name: companyName,
        owner_email: adminEmail,
        owner_phone: adminPhone,
        address: 'Automated Test Address',
        currency: 'ZMW',
        currency_symbol: 'K',
        base_currency: 'ZMW',
        tax_rate: 0,
        sales_tax_mode: 'none',
        sales_tax_rate: 0,
        single_item_margin_percent: 0,
        receipt_footer: '',
        thermal_printer_width: '58mm',
        plan: 'free',
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso
      }
    ];

    const companyRes = await postJson('/rest/v1/companies', JSON.stringify(companyPayload));
    const company = Array.isArray(companyRes) ? companyRes[0] : (companyRes && companyRes[0]) || null;
    if (!company || !company.id) throw new Error('Company creation failed');
    console.log('Created company id:', company.id);

    console.log('Creating store...');
    const storeId = crypto.randomUUID();
    const storePayload = [
      {
        id: storeId,
        company_id: company.id,
        name: `${companyName} - Main Store`,
        location_name: 'Main Location',
        address: 'Automated Test Address',
        phone: adminPhone,
        currency: 'ZMW',
        currency_symbol: 'K',
        is_public: true,
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso
      }
    ];

    const storeRes = await postJson('/rest/v1/stores', JSON.stringify(storePayload));
    const store = Array.isArray(storeRes) ? storeRes[0] : (storeRes && storeRes[0]) || null;
    if (!store || !store.id) throw new Error('Store creation failed');
    console.log('Created store id:', store.id);

    console.log('Creating auth user (admin)...');
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
      email: adminEmail,
      password: adminPin,
      email_confirm: true,
      user_metadata: { full_name: companyName, phone: adminPhone, role: 'admin', company_id: company.id, store_id: store.id }
    });

    const createAuthUser = () => new Promise((resolve, reject) => {
      const req = https.request(authOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : null;
            if (res.statusCode >= 400) return reject(new Error(`Auth create failed: HTTP ${res.statusCode} - ${data}`));
            // The admin endpoint may return an object with 'user' or the user directly
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

    console.log('Creating profile...');
    const profilePayload = [
      {
        id: user.id,
        email: adminEmail,
        full_name: companyName,
        phone: adminPhone,
        role: 'admin',
        company_id: company.id,
        store_id: store.id,
        is_active: true,
        created_at: nowIso,
        updated_at: nowIso
      }
    ];

    let profile = null;
    try {
      const profileRes = await postJson('/rest/v1/profiles', JSON.stringify(profilePayload));
      profile = Array.isArray(profileRes) ? profileRes[0] : (profileRes && profileRes[0]) || null;
      if (profile) {
        console.log('Profile created for user:', profile.id);
      }
    } catch (pErr) {
      const msg = String(pErr.message || pErr);
      if (msg.includes('duplicate') || msg.includes('23505')) {
        console.warn('Profile already exists for this user; continuing.');
      } else {
        throw pErr;
      }
    }

    console.log('Creating membership...');
    const membershipPayload = [
      {
        user_id: user.id,
        company_id: company.id,
        role: 'admin',
        store_id: store.id,
        is_active: true,
        joined_at: nowIso
      }
    ];

    try {
      const membershipRes = await postJson('/rest/v1/memberships', JSON.stringify(membershipPayload));
      const membership = Array.isArray(membershipRes) ? membershipRes[0] : (membershipRes && membershipRes[0]) || null;
      if (!membership) {
        console.warn('Membership insert returned empty response; it may already exist');
      } else {
        console.log('Membership created');
      }
    } catch (mErr) {
      // If membership already exists, continue
      console.warn('Membership creation warning:', mErr.message || mErr);
    }

    const out = {
      company,
      store,
      user: { id: user.id, email: adminEmail },
      adminPin
    };

    if (!fs.existsSync('backups')) fs.mkdirSync('backups');
    fs.writeFileSync('backups/test-setup-result.json', JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote backups/test-setup-result.json');
    console.log('Done.');
  } catch (err) {
    console.error('Error in setup:', err.message || err);
    process.exit(1);
  }
})();
