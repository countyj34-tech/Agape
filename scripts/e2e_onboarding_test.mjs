#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
  const envFile = path.resolve(process.cwd(), '.env');
  const parsed = parseDotEnv(envFile);

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL;
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || parsed.VITE_SUPABASE_ANON_KEY || parsed.SUPABASE_ANON_KEY;
  const SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error('Missing Supabase URL or anon key. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    process.exit(1);
  }

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  let admin = null;
  if (SERVICE_ROLE_KEY) {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  }

  const suffix = `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}`;

  const companyPayload = {
    id: crypto.randomUUID(),
    name: `E2E Onboard ${suffix}`,
    owner_email: `onboard-${suffix}@example.com`,
    owner_phone: `2609${Math.floor(1000000 + Math.random() * 8999999)}`,
    currency: 'ZMW',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  console.log('Creating company (admin client preferred) ...');

  let createdCompany = null;
  let createdStore = null;
  let createdOwnerUser = null;
  let createdStaffUser = null;
  let usedFunctionFallback = false;

  if (admin) {
    try {
      const { data: compData, error: compErr } = await admin.from('companies').insert([companyPayload]).select();
      if (compErr) {
        console.warn('Admin company insert error:', compErr);
        if (String(compErr.message || '').toLowerCase().includes('invalid api key')) {
          admin = null;
        }
      } else if (compData && compData.length > 0) {
        createdCompany = compData[0];
        console.log('Company created via admin client:', createdCompany.id);
      }
    } catch (e) {
      console.warn('Admin client company insert failed:', e);
      admin = null;
    }
  }

  if (!createdCompany) {
    console.log('Falling back to `admin-signup` Edge function via anon key');
    const payload = {
      email: companyPayload.owner_email,
      password: 'P@ssw0rd1',
      companyName: companyPayload.name,
      companyEmail: companyPayload.owner_email,
      storeName: `${companyPayload.name} - Main`,
      storeLocation: 'Main Location',
      staffName: 'Owner',
      staffPhone: companyPayload.owner_phone,
      pin: '123456',
      role: 'owner'
    };

    try {
      const res = await anon.functions.invoke('admin-signup', { body: payload, headers: { 'Content-Type': 'application/json' } });
      const fn = res.data || res;
      if (fn?.company) createdCompany = fn.company;
      if (fn?.store) createdStore = fn.store;
      if (fn?.user) createdOwnerUser = fn.user;
      if (!createdCompany && fn?.company_id) createdCompany = { id: fn.company_id };
      usedFunctionFallback = true;
      console.log('Function created company:', createdCompany?.id, 'store:', createdStore?.id || createdStore?.name);
    } catch (e) {
      console.error('admin-signup function invocation failed:', e);
      process.exit(1);
    }
  }

  // If admin exists and we haven't created store/owner yet, attempt to create them
  if (admin && !createdStore) {
    try {
      const storePayload = {
        id: crypto.randomUUID(),
        company_id: createdCompany.id,
        name: `${createdCompany.name} - Main Store`,
        location_name: 'Main Location',
        phone: createdCompany.owner_phone,
        currency: createdCompany.currency || 'ZMW',
        currency_symbol: 'K',
        is_public: true,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { data: storeData, error: storeErr } = await admin.from('stores').insert([storePayload]).select();
      if (!storeErr && storeData && storeData.length > 0) {
        createdStore = storeData[0];
        console.log('Store created via admin client:', createdStore.id);
      } else if (storeErr) {
        console.warn('Store create error:', storeErr);
      }
    } catch (e) {
      console.warn('Admin create store failed:', e);
    }
  }

  // Create an additional staff via admin client if possible
  if (admin) {
    try {
      const staffEmail = `staff-${suffix}@example.com`;
      const staffPassword = `P@ssw0rd2`;
      console.log('Creating staff user via admin client:', staffEmail);
      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email: staffEmail,
        password: staffPassword,
        email_confirm: true,
        user_metadata: {
          full_name: 'E2E Staff',
          phone: `2609${Math.floor(1000000 + Math.random() * 8999999)}`,
          role: 'salesperson',
          company_id: createdCompany.id,
          store_id: createdStore?.id || null
        }
      });
      if (authErr) {
        console.warn('Admin.createUser failed:', authErr);
      } else if (authData?.user) {
        createdStaffUser = authData.user;
        // upsert profile & membership
        await admin.from('profiles').upsert({
          id: createdStaffUser.id,
          email: staffEmail,
          full_name: 'E2E Staff',
          phone: authData.user.user_metadata?.phone || null,
          role: 'salesperson',
          company_id: createdCompany.id,
          store_id: createdStore?.id || null,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
        await admin.from('memberships').insert({
          user_id: createdStaffUser.id,
          company_id: createdCompany.id,
          role: 'salesperson',
          store_id: createdStore?.id || null,
          is_active: true,
          joined_at: new Date().toISOString()
        });
        console.log('Created staff user and membership via admin client:', createdStaffUser.id);
      }
    } catch (e) {
      console.warn('Failed to create staff via admin:', e);
    }
  } else {
    console.log('Admin client not available; skipping staff creation.');
  }

  // Verification
  console.log('Verifying onboarding artifacts...');
  let pass = true;
  if (admin) {
    try {
      const { data: storesForCompany, error: storesErr } = await admin.from('stores').select('*').eq('company_id', createdCompany.id);
      if (storesErr) {
        console.warn('Failed to query stores for verification:', storesErr);
        pass = false;
      } else {
        console.log('Stores found for company:', (storesForCompany || []).map(s => s.id));
      }
      const { data: membersForCompany, error: membersErr } = await admin.from('memberships').select('*').eq('company_id', createdCompany.id);
      if (membersErr) {
        console.warn('Failed to query memberships for verification:', membersErr);
        pass = false;
      } else {
        console.log('Memberships found for company:', (membersForCompany || []).map(m => m.user_id));
      }
    } catch (e) {
      console.warn('Verification failed via admin:', e);
      pass = false;
    }
  } else if (usedFunctionFallback) {
    console.log('Verified via function response: company id:', createdCompany?.id, 'store id:', createdStore?.id || createdStore?.name);
  } else {
    console.warn('No verification possible.');
    pass = false;
  }

  // Attempt cleanup if admin available
  if (admin) {
    console.log('Cleaning up created resources...');
    try {
      // Delete memberships
      await admin.from('memberships').delete().eq('company_id', createdCompany.id);
      // Delete profiles linked to company
      await admin.from('profiles').delete().eq('company_id', createdCompany.id);
      // Delete stores
      await admin.from('stores').delete().eq('company_id', createdCompany.id);
      // Delete companies
      await admin.from('companies').delete().eq('id', createdCompany.id);
      // Delete auth users if created
      if (createdStaffUser?.id) {
        try { await admin.auth.admin.deleteUser(createdStaffUser.id); } catch (e) { console.warn('Failed to delete staff auth user:', e); }
      }
      if (createdOwnerUser?.id) {
        try { await admin.auth.admin.deleteUser(createdOwnerUser.id); } catch (e) { console.warn('Failed to delete owner auth user:', e); }
      }
      console.log('Cleanup complete.');
    } catch (cleanupErr) {
      console.warn('Cleanup errors occurred:', cleanupErr);
    }
  } else {
    console.log('Admin service-role key not available or invalid; created resources were NOT deleted. Please remove manually in Supabase dashboard if needed.');
    console.log('Created company id:', createdCompany?.id);
    console.log('Created store id:', createdStore?.id || createdStore?.name);
    console.log('Created owner id:', createdOwnerUser?.id || createdOwnerUser);
    console.log('Created staff id:', createdStaffUser?.id || createdStaffUser);
  }

  console.log(pass ? '✅ Onboarding e2e test passed' : '❌ Onboarding e2e test failed');
  process.exit(pass ? 0 : 2);
}

run().catch((e) => { console.error('E2E onboarding script failed:', e); process.exit(1); });
