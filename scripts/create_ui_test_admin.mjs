import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
  try { raw = await fs.readFile(path.join(cwd, '.env'), 'utf8'); } catch(e) { raw = ''; }
  const parsed = parseDotEnv(raw);

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL || '';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const suffix = `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const email = `ui-test-admin-${suffix}@example.com`;
  const pin = '123456';
  const companyName = `UI Test Company ${suffix}`;
  try {
    // Create company
    const companyPayload = {
      name: companyName,
      owner_email: email,
      currency: 'ZMW',
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: compData, error: compErr } = await admin.from('companies').insert([companyPayload]).select();
    if (compErr) {
      console.error('Failed to create company:', compErr);
      process.exit(1);
    }
    const createdCompany = Array.isArray(compData) && compData.length ? compData[0] : compData;
    console.log('Company created via admin client:', createdCompany?.id || createdCompany?.name);

    // Create store
    const storePayload = {
      company_id: createdCompany.id,
      name: `${companyName} - Main Store`,
      location_name: 'Main Location',
      phone: '',
      currency: 'ZMW',
      currency_symbol: 'K',
      is_public: true,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data: storeData, error: storeErr } = await admin.from('stores').insert([storePayload]).select();
    if (storeErr) {
      console.error('Failed to create store:', storeErr);
      process.exit(1);
    }
    const createdStore = Array.isArray(storeData) && storeData.length ? storeData[0] : storeData;
    console.log('Store created via admin client:', createdStore?.id || createdStore?.name);

    // Create auth user (owner)
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
      user_metadata: {
        full_name: companyName,
        role: 'owner',
        company_id: createdCompany.id,
        store_id: createdStore?.id || null,
      }
    });

    if (authErr) {
      console.error('Failed to create auth user:', authErr);
      process.exit(1);
    }

    const createdUser = authData?.user || authData;
    console.log('Created auth user:', createdUser?.id || createdUser?.email);

    // Upsert profile
    try {
      await admin.from('profiles').upsert({
        id: createdUser.id,
        email,
        full_name: companyName,
        phone: null,
        role: 'owner',
        company_id: createdCompany.id,
        store_id: createdStore?.id || null,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch (e) {
      console.warn('Profile upsert warning:', e);
    }

    // Insert membership
    try {
      await admin.from('memberships').insert({
        user_id: createdUser.id,
        profile_id: createdUser.id,
        company_id: createdCompany.id,
        role: 'owner',
        is_active: true,
        joined_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Membership insert warning:', e);
    }

    const out = {
      email,
      pin,
      companyId: createdCompany.id,
      storeId: createdStore?.id || null,
      userId: createdUser.id,
    };

    await fs.writeFile(path.join(cwd, 'scripts', 'ui_test_admin.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote credentials to scripts/ui_test_admin.json');
    console.log(email, pin);
    process.exit(0);
  } catch (e) {
    console.error('Failed to create UI test admin:', e);
    process.exit(1);
  }
}

run().catch(e => { console.error('Script failed:', e); process.exit(1); });
