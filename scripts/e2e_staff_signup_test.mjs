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

  // Step 1: create a company + store via admin client
  const ts = Date.now().toString().slice(-6);
  const ownerEmail = `e2e-owner-${ts}@example.com`;
  const ownerPassword = 'P@ssw0rd1';
  const companyName = `E2E Company ${ts}`;
  const storeName = `E2E Store ${ts}`;

  console.log('Creating owner auth user via admin client:', ownerEmail);
  let ownerId;
  try {
    const res = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true });
    ownerId = res?.data?.user?.id || res?.user?.id || res?.data?.id || res?.id;
    console.log('Owner id:', ownerId);
  } catch (e) {
    console.error('Failed to create owner user:', e.message || e);
    process.exit(1);
  }

  let companyId;
  try {
    const { data, error } = await admin.from('companies').insert({ name: companyName, owner_email: ownerEmail, owner_phone: '+260000000', is_active: true }).select('id').maybeSingle();
    if (error) throw error;
    companyId = data?.id || (Array.isArray(data) && data[0] && data[0].id) || null;
    console.log('Created company id:', companyId);
  } catch (e) {
    console.error('Failed to create company:', e.message || e);
    process.exit(1);
  }

  let storeId;
  try {
    const { data, error } = await admin.from('stores').insert({ company_id: companyId, name: storeName, location_name: 'E2E Location', is_active: true }).select('id').maybeSingle();
    if (error) throw error;
    storeId = data?.id || (Array.isArray(data) && data[0] && data[0].id) || null;
    console.log('Created store id:', storeId);
  } catch (e) {
    console.error('Failed to create store:', e.message || e);
    process.exit(1);
  }

  // Step 2: create staff via admin-signup function (anon client) using companyId/storeId
  const staffEmail = `e2e-staff-${ts}@example.com`;
  const staffPin = '123456';
  const staffName = 'E2E Staff';
  console.log('Invoking admin-signup to create staff via anon function:', staffEmail);
  try {
    const res = await anon.functions.invoke('admin-signup', { body: { email: staffEmail, password: staffPin, pin: staffPin, companyId, storeId, name: staffName, phone: '+260111111' }, headers: { 'Content-Type': 'application/json' } });
    const out = res?.data || res;
    console.log('Function response:', out);
  } catch (e) {
    console.error('admin-signup invocation failed:', e.message || e);
    process.exit(1);
  }

  // Step 3: attempt sign-in via anon client (simulate another device)
  try {
    console.log('Attempting sign-in for staff via anon client...');
    const { data, error } = await anon.auth.signInWithPassword({ email: staffEmail, password: staffPin });
    console.log('Sign-in result:', { data: data ?? null, error: error ? (error.message || error) : null });
    if (error) process.exit(2);
    if (data?.user) {
      console.log('Staff sign-in succeeded, user id:', data.user.id);
      // fetch profile/membership via anon client
      const { data: prof, error: pErr } = await anon.from('profiles').select('*').eq('id', data.user.id);
      console.log('Anon profile rows:', prof, 'error:', pErr ? (pErr.message || pErr) : null);

      const { data: mem, error: mErr } = await admin.from('memberships').select('*').eq('user_id', data.user.id);
      console.log('Admin memberships rows for user:', mem, 'error:', mErr ? (mErr.message || mErr) : null);

      console.log('E2E staff signup+login test PASSED');
      process.exit(0);
    }
    console.error('Staff sign-in did not return a user');
    process.exit(3);
  } catch (e) {
    console.error('Staff sign-in attempt failed:', e.message || e);
    process.exit(1);
  }
}

run().catch(e => { console.error('Script failed:', e); process.exit(1); });
