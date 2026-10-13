#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function parseDotEnv(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
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
  } catch (e) {
    return {};
  }
}

async function run() {
  const env = parseDotEnv(path.resolve(process.cwd(), '.env'));
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  const SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL, ANON_KEY, or SERVICE_ROLE_KEY in env or .env');
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  const suffix = `${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*9000+1000)}`;
  const companyId = crypto.randomUUID();
  const storeId = crypto.randomUUID();
  const ownerEmail = `owner-${suffix}@example.com`;
  const staffEmail = `staff-${suffix}@example.com`;
  const staffPassword = 'P@ssw0rd!' + Math.floor(Math.random()*900 + 100);

  console.log('Creating company...', companyId);
  try {
    const { data: compData, error: compErr } = await admin.from('companies').insert([{ id: companyId, name: `E2E Test ${suffix}`, owner_email: ownerEmail, owner_phone: '260900000000', currency: 'ZMW', is_active: true }]).select();
    if (compErr) throw compErr;
    console.log('Company created');
  } catch (e) {
    console.error('Failed to create company:', e);
    process.exit(1);
  }

  console.log('Creating store...', storeId);
  try {
    const { data: storeData, error: storeErr } = await admin.from('stores').insert([{ id: storeId, company_id: companyId, name: `Main ${suffix}`, location_name: 'Test', phone: '260900000000', currency: 'ZMW', is_public: true, is_active: true }]).select();
    if (storeErr) throw storeErr;
    console.log('Store created');
  } catch (e) {
    console.error('Failed to create store:', e);
    await admin.from('companies').delete().eq('id', companyId);
    process.exit(1);
  }

  console.log('Creating staff auth user via admin client:', staffEmail);
  let createdStaffId = null;
  try {
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({ email: staffEmail, password: staffPassword, email_confirm: true, user_metadata: { full_name: 'E2E Staff', phone: '260900000001', role: 'staff', company_id: companyId, store_id: storeId } });
    if (userErr) throw userErr;
    createdStaffId = userData.user?.id || userData.id || null;
    console.log('Created staff auth user id:', createdStaffId);
  } catch (e) {
    console.error('Failed to create staff user:', e);
    await admin.from('stores').delete().eq('id', storeId);
    await admin.from('companies').delete().eq('id', companyId);
    process.exit(1);
  }

  console.log('Upserting profile and membership via admin client');
  try {
    await admin.from('profiles').upsert({ id: createdStaffId, email: staffEmail, full_name: 'E2E Staff', phone: '260900000001', role: 'staff', company_id: companyId, store_id: storeId, is_active: true }, { onConflict: 'id' });
    await admin.from('memberships').insert({ user_id: createdStaffId, company_id: companyId, role: 'staff', store_id: storeId, is_active: true, joined_at: new Date().toISOString() });
    console.log('Profile and membership created');
  } catch (e) {
    console.error('Failed to upsert profile/membership:', e);
  }

  console.log('Attempting anon sign-in as staff...');
  try {
    const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email: staffEmail, password: staffPassword });
    if (signInErr) throw signInErr;
    if (signInData?.user) {
      console.log('✅ Anon sign-in succeeded for staff:', signInData.user.id);
    } else {
      console.error('Anon sign-in did not return a user:', signInData);
    }
  } catch (e) {
    console.error('Anon sign-in failed:', e);
  }

  console.log('Cleaning up created resources...');
  try {
    if (createdStaffId) {
      try { await admin.auth.admin.deleteUser(createdStaffId); } catch (e) { console.warn('Failed to delete auth user:', e); }
    }
    await admin.from('memberships').delete().eq('company_id', companyId);
    await admin.from('profiles').delete().eq('id', createdStaffId);
    await admin.from('stores').delete().eq('id', storeId);
    await admin.from('companies').delete().eq('id', companyId);
    console.log('Cleanup complete');
  } catch (e) {
    console.warn('Cleanup errors:', e);
  }

}

run().catch((e) => { console.error('Script failed:', e); process.exit(1); });
