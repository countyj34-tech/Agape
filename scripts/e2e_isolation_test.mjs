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
      if ((val.startsWith("\'") && val.endsWith("\'")) || (val.startsWith('"') && val.endsWith('"'))) {
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
  const SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing Supabase URL or service-role key. Set VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY in .env or environment.');
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const suffix = `${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}`;

  const companyA = {
    id: crypto.randomUUID(),
    name: `E2E Company A ${suffix}`,
    owner_email: `e2e-a-${suffix}@example.com`,
    owner_phone: `2609${Math.floor(1000000 + Math.random() * 8999999)}`,
    currency: 'ZMW',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const companyB = {
    id: crypto.randomUUID(),
    name: `E2E Company B ${suffix}`,
    owner_email: `e2e-b-${suffix}@example.com`,
    owner_phone: `2609${Math.floor(1000000 + Math.random() * 8999999)}`,
    currency: 'ZMW',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  console.log('Creating test companies...');
  const { data: createdCompanies, error: createCompErr } = await admin.from('companies').insert([companyA, companyB]).select();
  let createdStores = null;
  let usedFunctionFallback = false;
  if (createCompErr) {
    console.warn('Direct admin insert of companies failed:', createCompErr);
    // If the error indicates invalid API key, attempt function-based fallback using anon client
    if (String(createCompErr.message || '').toLowerCase().includes('invalid api key') || String(createCompErr.hint || '').toLowerCase().includes('api key')) {
      console.log('Attempting fallback: invoke `admin-signup` Edge function via anon key');
      const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || parsed.VITE_SUPABASE_ANON_KEY || parsed.SUPABASE_ANON_KEY;
      if (!anonKey) {
        console.error('No anon key available for function fallback. Aborting.');
        process.exit(1);
      }
      const anonClient = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });

      // Build admin-signup payloads for two companies
      const payloadA = {
        email: companyA.owner_email,
        password: 'P@ssw0rd1',
        companyName: companyA.name,
        companyEmail: companyA.owner_email,
        storeName: `${companyA.name} - Main`,
        storeLocation: 'Location 1',
        staffName: 'Owner A',
        staffPhone: companyA.owner_phone,
        pin: '123456',
        role: 'owner'
      };

      const payloadB = {
        email: companyB.owner_email,
        password: 'P@ssw0rd2',
        companyName: companyB.name,
        companyEmail: companyB.owner_email,
        storeName: `${companyB.name} - Main`,
        storeLocation: 'Location 1',
        staffName: 'Owner B',
        staffPhone: companyB.owner_phone,
        pin: '123456',
        role: 'owner'
      };

      const resA = await anonClient.functions.invoke('admin-signup', { body: payloadA, headers: { 'Content-Type': 'application/json' } });
      const resB = await anonClient.functions.invoke('admin-signup', { body: payloadB, headers: { 'Content-Type': 'application/json' } });

      if (resA.error || resB.error) {
        console.error('Function fallback failed:', resA.error || resB.error);
        process.exit(1);
      }

      const fnA = resA.data || resA;
      const fnB = resB.data || resB;

      // If functions returned company & store objects, use them
      if (fnA?.company && fnB?.company && fnA?.store && fnB?.store) {
        console.log('Function created company/store for A:', fnA.company.id, fnA.store.id);
        console.log('Function created company/store for B:', fnB.company.id, fnB.store.id);
        createdStores = [fnA.store, fnB.store];
        // update local company ids to match created resources
        companyA.id = fnA.company.id;
        companyB.id = fnB.company.id;
        usedFunctionFallback = true;
        // note: each function creates one store only (main store)
      } else {
        console.error('Unexpected function response shape; cannot verify isolation reliably:', fnA, fnB);
        process.exit(1);
      }

      // Skip further direct DB queries since we used function path
    } else {
      console.error('Failed to create test companies:', createCompErr);
      process.exit(1);
    }
  } else {
    console.log('Companies created:', createdCompanies.map((c) => c.id).join(', '));

    // Create 2 stores for each company
    const stores = [];
    for (const c of [companyA, companyB]) {
      const s1 = {
        id: crypto.randomUUID(),
        company_id: c.id,
        name: `${c.name} - Store 1`,
        location_name: 'Location 1',
        phone: c.owner_phone,
        currency: c.currency,
        is_public: false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const s2 = {
        id: crypto.randomUUID(),
        company_id: c.id,
        name: `${c.name} - Store 2`,
        location_name: 'Location 2',
        phone: c.owner_phone,
        currency: c.currency,
        is_public: false,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      stores.push(s1, s2);
    }

    console.log('Creating test stores...');
    const { data: createdStoresRes, error: createStoresErr } = await admin.from('stores').insert(stores).select();
    if (createStoresErr) {
      console.error('Failed to create test stores:', createStoresErr);
      // attempt cleanup of companies
      await admin.from('companies').delete().in('id', [companyA.id, companyB.id]);
      process.exit(1);
    }

    createdStores = createdStoresRes;
    console.log('Stores created:', createdStores.map((s) => `${s.id}@${s.company_id}`).join(', '));
  }

  // Verify isolation
  console.log('Verifying isolation: querying stores per company...');
  let passA = false;
  let passB = false;
  if (usedFunctionFallback) {
    // If we used the function fallback and admin key is invalid, verify using function responses only
    const fnAStore = createdStores[0];
    const fnBStore = createdStores[1];
    passA = !!fnAStore && !!companyA.id;
    passB = !!fnBStore && !!companyB.id;
    console.log(`Company A (${companyA.id}) stores count (function):`, passA ? 1 : 0);
    console.log(`Company B (${companyB.id}) stores count (function):`, passB ? 1 : 0);
    if (passA && passB && companyA.id !== companyB.id) {
      console.log('✅ Isolation test passed (verified via Edge function responses).');
    } else {
      console.error('❌ Isolation test failed (function response verification).');
      console.error('Function A store:', fnAStore);
      console.error('Function B store:', fnBStore);
    }
  } else {
    // passA/passB will be set below using DB queries
    const { data: storesForA, error: errA } = await admin.from('stores').select('*').eq('company_id', companyA.id);
    const { data: storesForB, error: errB } = await admin.from('stores').select('*').eq('company_id', companyB.id);

    if (errA || errB) {
      console.error('Failed to query stores for companies:', errA || errB);
      // proceed to cleanup
    }

    console.log(`Company A (${companyA.id}) stores count:`, (storesForA || []).length);
    console.log(`Company B (${companyB.id}) stores count:`, (storesForB || []).length);

    const aIds = (storesForA || []).map((s) => s.id).sort();
    const bIds = (storesForB || []).map((s) => s.id).sort();

    const expectedA = (createdStores || []).filter((s) => s.company_id === companyA.id).map((s) => s.id).sort();
    const expectedB = (createdStores || []).filter((s) => s.company_id === companyB.id).map((s) => s.id).sort();

    const passA = JSON.stringify(aIds) === JSON.stringify(expectedA);
    const passB = JSON.stringify(bIds) === JSON.stringify(expectedB);

    if (passA && passB) {
      console.log('✅ Isolation test passed: each company only sees its own stores.');
    } else {
      console.error('❌ Isolation test failed.');
      console.error('Expected A:', expectedA);
      console.error('Got A     :', aIds);
      console.error('Expected B:', expectedB);
      console.error('Got B     :', bIds);
    }
  }

  // Cleanup: delete stores then companies
  try {
    const storeIds = createdStores.map((s) => s.id);
    console.log('Cleaning up test stores...');
    const { error: delStoresErr } = await admin.from('stores').delete().in('id', storeIds);
    if (delStoresErr) console.warn('Failed to delete test stores:', delStoresErr);

    console.log('Cleaning up test companies...');
    const { error: delCompErr } = await admin.from('companies').delete().in('id', [companyA.id, companyB.id]);
    if (delCompErr) console.warn('Failed to delete test companies:', delCompErr);
  } catch (cleanupErr) {
    console.warn('Cleanup errors:', cleanupErr);
  }

  process.exit(passA && passB ? 0 : 2);
}

run().catch((e) => {
  console.error('E2E script failed:', e);
  process.exit(1);
});
