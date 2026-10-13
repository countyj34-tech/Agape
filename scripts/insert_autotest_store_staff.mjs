import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

function parseDotEnv(raw) {
  const lines = raw.split(/\r?\n/);
  const out = {};
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function run() {
  const cwd = process.cwd();
  let raw = '';
  try { raw = await fs.readFile(path.join(cwd, '.env'), 'utf8'); } catch (e) { raw = ''; }
  const parsed = parseDotEnv(raw);

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL || '';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in environment or .env before running this script.');
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const ts = Date.now();
  try {
    // Find or create a company to attach to
    const { data: companies, error: cErr } = await admin.from('companies').select('*').ilike('name', 'AUTOTEST COMPANY%').limit(1);
    let company = (companies && companies.length > 0) ? companies[0] : null;
    console.log('Found existing company result:', { companiesCount: companies?.length || 0, error: cErr ? String(cErr.message || cErr) : null });

    if (!company) {
      const companyId = randomUUID();
      const companyRow = {
        id: companyId,
        name: `AUTOTEST COMPANY ${ts}`,
        owner_email: `autotest+${ts}@example.com`,
        owner_phone: `097${String(ts).slice(-7)}`,
        address: 'Automated Test Address',
        currency: 'ZMW',
        currency_symbol: 'K',
        base_currency: 'ZMW',
        plan: 'free',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      console.log('Inserting company row:', companyRow);
      const insertResp = await admin.from('companies').insert(companyRow).select();
      console.log('Company insert response:', insertResp);
      const { data: inserted, error: insertErr } = insertResp;
      if (insertErr) {
        console.error('Failed to insert company:', String(insertErr.message || insertErr));
        process.exit(1);
      }
      company = Array.isArray(inserted) ? inserted[0] : inserted;
      console.log('Inserted company:', company);
    }

    // Insert a store
    const storeId = randomUUID();
    const storeRow = {
      id: storeId,
      company_id: company.id,
      name: `AUTOTEST STORE ${ts}`,
      location_name: `Auto Location ${ts}`,
      address: 'Automated Store Address',
      phone: '',
      currency: 'ZMW',
      currency_symbol: 'K',
      is_public: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Inserting store row:', storeRow);
    const storeResp = await admin.from('stores').insert(storeRow).select();
    console.log('Store insert response:', storeResp);
    const { data: insertedStore, error: storeErr } = storeResp;
    if (storeErr) {
      console.error('Failed to insert store:', String(storeErr.message || storeErr));
      process.exit(1);
    }
    const store = Array.isArray(insertedStore) ? insertedStore[0] : insertedStore;
    console.log('Inserted store:', store);

    // Insert a staff row (no auth user)
    const staffId = randomUUID();
    const staffRow = {
      id: staffId,
      company_id: company.id,
      store_id: store.id,
      name: `AUTOTEST STAFF ${ts}`,
      email: `autotest-staff-${ts}@example.com`,
      phone: '',
      role: 'manager',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Inserting staff row:', staffRow);
    const staffResp = await admin.from('staff').insert(staffRow).select();
    console.log('Staff insert response:', staffResp);
    const { data: insertedStaff, error: staffErr } = staffResp;
    if (staffErr) {
      console.error('Failed to insert staff:', String(staffErr.message || staffErr));
      process.exit(1);
    }

    console.log(JSON.stringify({ createdAt: new Date().toISOString(), company: company, store: store, staff: Array.isArray(insertedStaff) ? insertedStaff[0] : insertedStaff }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Script error:', e);
    process.exit(1);
  }
}

run().catch((e) => { console.error('Script failed:', e); process.exit(1); });
