import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function parseEnv(envText) {
  const out = {};
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

(async () => {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      console.error('.env file not found in project root');
      process.exit(2);
    }
    const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
    const url = env.VITE_SUPABASE_URL;
    const key = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('Supabase URL or service role key missing in .env');
      process.exit(2);
    }

    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const companyId = process.argv[2];
    if (!companyId) {
      console.error('Usage: node scripts/ensure_store_for_company.mjs <company_id>');
      process.exit(2);
    }

    console.log('Checking existing stores for company:', companyId);
    const { data: existingStores, error: storesErr } = await supabase.from('stores').select('*').eq('company_id', companyId);
    if (storesErr) {
      console.error('Failed to query stores:', storesErr.message || storesErr);
      process.exit(1);
    }

    if (existingStores && existingStores.length > 0) {
      console.log('Company already has stores. Listing:');
      console.log(JSON.stringify(existingStores, null, 2));
      process.exit(0);
    }

    // Create a new store
    const storeId = crypto.randomUUID();
    const now = new Date().toISOString();
    const storePayload = {
      id: storeId,
      company_id: companyId,
      name: `Auto-created Store ${now}`,
      location_name: 'Main Location',
      address: null,
      phone: null,
      currency: 'ZMW',
      currency_symbol: 'K',
      is_public: true,
      is_active: true,
      created_at: now,
      updated_at: now
    };

    console.log('Inserting store:', storePayload.name);
    const { data: insertedStore, error: insertErr } = await supabase.from('stores').insert([storePayload]).select('*').single();
    if (insertErr) {
      console.error('Failed to create store:', insertErr.message || insertErr);
      process.exit(1);
    }

    console.log('Created store:', insertedStore.id);

    // Find profiles for the company that lack a store_id
    console.log('Finding profiles with null store_id for company...');
    const { data: profiles, error: profilesErr } = await supabase.from('profiles').select('*').eq('company_id', companyId);
    if (profilesErr) {
      console.error('Failed to query profiles:', profilesErr.message || profilesErr);
      process.exit(1);
    }

    let updatedProfiles = 0;
    let createdMemberships = 0;

    for (const p of profiles || []) {
      if (!p.store_id) {
        const { error: updErr } = await supabase.from('profiles').update({ store_id: storeId, updated_at: now }).eq('id', p.id);
        if (updErr) console.warn('Failed to update profile', p.id, updErr.message || updErr);
        else updatedProfiles++;
      }

      // Ensure membership exists
      const { data: membership, error: memErr } = await supabase.from('memberships').select('*').eq('user_id', p.id).maybeSingle();
      if (memErr) {
        console.warn('Failed to query membership for', p.id, memErr.message || memErr);
      } else if (!membership) {
        const mPayload = {
          user_id: p.id,
          company_id: companyId,
          role: p.role || 'staff',
          store_id: storeId,
          is_active: true,
          joined_at: now
        };
        const { error: mInsertErr } = await supabase.from('memberships').insert([mPayload]);
        if (mInsertErr) console.warn('Failed to create membership for', p.id, mInsertErr.message || mInsertErr);
        else createdMemberships++;
      }
    }

    console.log(`Updated ${updatedProfiles} profiles and created ${createdMemberships} memberships.`);
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Script error', err);
    process.exit(1);
  }
})();
