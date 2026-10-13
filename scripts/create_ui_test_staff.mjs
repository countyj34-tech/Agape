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
  const adminEmail = `ui-test-owner-${suffix}@example.com`;
  const ownerPin = '123456';
  const staffEmail = `ui-test-staff-${suffix}@example.com`;
  const staffPin = '654321';
  const companyName = `UI Staff Company ${suffix}`;

  try {
    // Create company
    const companyPayload = {
      name: companyName,
      owner_email: adminEmail,
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

    // Create owner auth user
    const { data: ownerAuthData, error: ownerAuthErr } = await admin.auth.admin.createUser({
      email: adminEmail,
      password: ownerPin,
      email_confirm: true,
      user_metadata: { full_name: companyName, role: 'owner', company_id: createdCompany.id, store_id: createdStore?.id || null }
    });
    if (ownerAuthErr) {
      console.error('Failed to create owner auth user:', ownerAuthErr);
      process.exit(1);
    }
    const createdOwner = ownerAuthData?.user || ownerAuthData;
    console.log('Created owner user:', createdOwner?.id || createdOwner?.email);

    // Create staff auth user
    const { data: staffAuthData, error: staffAuthErr } = await admin.auth.admin.createUser({
      email: staffEmail,
      password: staffPin,
      email_confirm: true,
      user_metadata: { full_name: 'UI Test Staff', role: 'staff', company_id: createdCompany.id, store_id: createdStore?.id || null }
    });
    if (staffAuthErr) {
      console.error('Failed to create staff auth user:', staffAuthErr);
      process.exit(1);
    }
    const createdStaff = staffAuthData?.user || staffAuthData;
    console.log('Created staff user:', createdStaff?.id || createdStaff?.email);

    // Upsert profiles
    try {
      await admin.from('profiles').upsert({
        id: createdOwner.id,
        email: adminEmail,
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
      console.warn('Owner profile upsert warning:', e);
    }

    try {
      await admin.from('profiles').upsert({
        id: createdStaff.id,
        email: staffEmail,
        full_name: 'UI Test Staff',
        phone: null,
        role: 'staff',
        company_id: createdCompany.id,
        store_id: createdStore?.id || null,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch (e) {
      console.warn('Staff profile upsert warning:', e);
    }

    // Insert memberships
    try {
      await admin.from('memberships').insert({ user_id: createdOwner.id, profile_id: createdOwner.id, company_id: createdCompany.id, role: 'owner', is_active: true, joined_at: new Date().toISOString() });
    } catch (e) { console.warn('Owner membership insert warning:', e); }

    try {
      await admin.from('memberships').insert({ user_id: createdStaff.id, profile_id: createdStaff.id, company_id: createdCompany.id, role: 'staff', store_id: createdStore?.id || null, is_active: true, joined_at: new Date().toISOString() });
    } catch (e) { console.warn('Staff membership insert warning:', e); }

    const out = { email: staffEmail, pin: staffPin, companyId: createdCompany.id, storeId: createdStore?.id || null, userId: createdStaff.id };
    const outPath = path.join(cwd, 'scripts', 'ui_test_staff.json');
    await fs.writeFile(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote credentials to scripts/ui_test_staff.json');
    process.exit(0);
  } catch (e) {
    console.error('Failed to create UI test staff:', e);
    process.exit(1);
  }
}

run().catch(e => { console.error('Script failed:', e); process.exit(1); });
