import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

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
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || parsed.VITE_SUPABASE_ANON_KEY || parsed.SUPABASE_ANON_KEY || '';

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error('Missing SUPABASE_URL, SERVICE_ROLE_KEY or ANON_KEY');
    process.exit(2);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  const ts = Date.now().toString().slice(-6);
  const email = `test-admin-${ts}@example.com`;
  const password = 'P@ssw0rd1';
  const companyName = `Test Company ${ts}`;
  const storeName = `Test Store ${ts}`;

  console.log('Creating user via admin client:', email);
  let createdUserId = null;
  try {
    const res = await admin.auth.admin.createUser({
      email,
      password,
      user_metadata: { createdBy: 'create_test_user_script' },
      email_confirm: true
    });
    // res may be { data: { user }, error } or { user } or { data }
    if (res?.data?.user) {
      createdUserId = res.data.user.id || res.data.user?.id;
      console.log('admin.createUser returned data.user.id:', createdUserId);
    } else if (res?.user) {
      createdUserId = res.user.id;
      console.log('admin.createUser returned user.id:', createdUserId);
    } else if (res?.data?.id) {
      createdUserId = res.data.id;
      console.log('admin.createUser returned data.id:', createdUserId);
    } else if (res?.id) {
      createdUserId = res.id;
      console.log('admin.createUser returned id:', createdUserId);
    } else {
      console.warn('Unexpected createUser result shape:', JSON.stringify(res));
    }
  } catch (e) {
    console.error('admin.createUser failed:', e && e.message ? e.message : e);
    process.exit(1);
  }

  if (!createdUserId) {
    console.error('Could not determine created user id; aborting');
    process.exit(1);
  }

  // NOTE: postpone profile upsert until after company/store creation

  // Create company
  let companyId = null;
  try {
    const company = { name: companyName, owner_email: email, is_active: true };
    const { data: cData, error: cErr } = await admin.from('companies').insert(company).select('id').maybeSingle();
    if (cErr) {
      console.error('Failed to insert company:', cErr.message || cErr);
    } else {
      companyId = (cData && (cData.id || (Array.isArray(cData) && cData[0] && cData[0].id))) || null;
      console.log('Inserted company id:', companyId);
    }
  } catch (e) { console.error('company insert threw:', e && e.message ? e.message : e); }

  if (!companyId) {
    // Try inserting with returning clause (older supabase clients)
    try {
      const { data, error } = await admin.from('companies').insert([{ name: companyName, owner_email: email, is_active: true }], { returning: 'representation' });
      if (error) console.error('company insert fallback error:', error.message || error);
      else if (Array.isArray(data) && data[0] && data[0].id) companyId = data[0].id;
      console.log('Inserted company id (fallback):', companyId);
    } catch (e) { console.error('company insert fallback threw:', e && e.message ? e.message : e); }
  }

  if (!companyId) {
    console.error('Failed to create company; aborting');
    process.exit(1);
  }

  // Create store
  let storeId = null;
  try {
    const store = { company_id: companyId, name: storeName, location_name: 'Test Location', is_public: true, is_active: true };
    const { data: sData, error: sErr } = await admin.from('stores').insert(store).select('id').maybeSingle();
    if (sErr) {
      console.error('Failed to insert store:', sErr.message || sErr);
    } else {
      storeId = (sData && (sData.id || (Array.isArray(sData) && sData[0] && sData[0].id))) || null;
      console.log('Inserted store id:', storeId);
    }
  } catch (e) { console.error('store insert threw:', e && e.message ? e.message : e); }

  if (!storeId) {
    try {
      const { data, error } = await admin.from('stores').insert([{ company_id: companyId, name: storeName, location_name: 'Test Location', is_public: true, is_active: true }], { returning: 'representation' });
      if (error) console.error('store insert fallback error:', error.message || error);
      else if (Array.isArray(data) && data[0] && data[0].id) storeId = data[0].id;
      console.log('Inserted store id (fallback):', storeId);
    } catch (e) { console.error('store insert fallback threw:', e && e.message ? e.message : e); }
  }

  // Upsert profile with required fields (role is NOT NULL in schema)
  try {
    const profile = {
      id: createdUserId,
      email,
      full_name: 'Test Owner',
      role: 'owner',
      company_id: companyId,
      store_id: storeId,
      is_active: true
    };
    const { data: pData2, error: pErr2 } = await admin.from('profiles').upsert(profile, { onConflict: 'id' });
    if (pErr2) {
      console.error('Failed to upsert profile:', pErr2.message || pErr2);
      process.exit(1);
    } else {
      console.log('Upserted profile:', pData2 && pData2[0] ? pData2[0] : pData2);
    }
  } catch (e) { console.error('profiles upsert threw:', e && e.message ? e.message : e); process.exit(1); }

  // Create membership
  try {
    const membership = { user_id: createdUserId, company_id: companyId, role: 'owner', store_id: storeId, is_active: true };
    const { data: mData, error: mErr } = await admin.from('memberships').insert(membership).select().maybeSingle();
    if (mErr) console.error('Failed to insert membership:', mErr.message || mErr); else console.log('Inserted membership:', mData);
  } catch (e) { console.error('membership insert threw:', e && e.message ? e.message : e); }

  // Try sign-in with anon client
  try {
    console.log('Attempting sign-in via anon client for', email);
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    console.log('Sign-in result:', { data: data ?? null, error: error ? (error.message || error) : null });
    if (error) process.exit(2);
    if (data?.user) {
      console.log('Sign-in succeeded for user id:', data.user.id);
      // fetch profile via anon
      const { data: prof, error: pErr } = await anon.from('profiles').select('*').eq('id', data.user.id);
      console.log('Anon profile fetch:', { rows: prof ?? null, error: pErr ? (pErr.message || pErr) : null });
      process.exit(0);
    } else {
      console.error('Sign-in did not return a user');
      process.exit(3);
    }
  } catch (e) {
    console.error('Sign-in attempt threw:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

run().catch(e => { console.error('Script failed:', e); process.exit(1); });
