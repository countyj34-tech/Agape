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
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || parsed.VITE_SUPABASE_ANON_KEY || parsed.SUPABASE_ANON_KEY || '';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

  console.log('Using SUPABASE_URL:', SUPABASE_URL ? SUPABASE_URL : '(missing)');
  console.log('SERVICE_ROLE_KEY present:', !!SERVICE_ROLE_KEY);
  console.log('ANON_KEY present:', !!ANON_KEY);

  if (!SUPABASE_URL) {
    console.error('Missing SUPABASE_URL');
    process.exit(2);
  }

  const admin = SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
  const anon = ANON_KEY ? createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }) : null;

  const respPath = path.join(cwd, 'scripts', 'admin_signup_response.json');
  let fnResp = null;
  try { fnResp = JSON.parse(await fs.readFile(respPath, 'utf8')); } catch (e) { console.warn('No admin_signup_response.json found or parse error:', e.message); }

  const candidates = [];
  if (fnResp) {
    const r = fnResp.result || fnResp.data || fnResp;
    const data = r && r.data ? r.data : r;
    if (data) {
      if (data.user_id) candidates.push({ kind: 'user_id', value: data.user_id });
      if (data.uid) candidates.push({ kind: 'uid', value: data.uid });
      if (data.uid || data.user_id) {
        // also push email if in payload
      }
    }
    const payload = fnResp.payload || fnResp;
    if (payload && payload.email) candidates.push({ kind: 'email', value: payload.email });
    if (payload && payload.companyEmail) candidates.push({ kind: 'companyEmail', value: payload.companyEmail });
  }

  console.log('Candidates from function response:', candidates);

  // Try to locate user by id and by email using admin client
  if (!admin) {
    console.error('No service role key available to query admin API');
  } else {
    for (const c of candidates) {
      if (c.kind === 'user_id' || c.kind === 'uid') {
        console.log(`Querying admin.auth.admin.getUserById(${c.value})...`);
        try {
          const { data, error } = await admin.auth.admin.getUserById(c.value);
          console.log('getUserById result:', { data: data ?? null, error: error ? (error.message || error) : null });
        } catch (e) {
          console.log('getUserById threw:', e && e.message ? e.message : e);
        }

        console.log(`Querying profiles table for id=${c.value}...`);
        try {
          const { data, error } = await admin.from('profiles').select('*').eq('id', c.value);
          console.log('profiles by id result:', { rows: data ?? null, error: error ? (error.message || error) : null });
        } catch (e) { console.log('profiles by id threw:', e && e.message ? e.message : e); }
      }

      if (c.kind === 'email' || c.kind === 'companyEmail' ) {
        console.log(`Querying profiles table for email=${c.value}...`);
        try {
          const { data, error } = await admin.from('profiles').select('*').ilike('email', c.value);
          console.log('profiles by email result:', { rows: data ?? null, error: error ? (error.message || error) : null });
        } catch (e) { console.log('profiles by email threw:', e && e.message ? e.message : e); }

        // Try to find auth user by email via admin.auth.admin.listUsers if available
        try {
          if (admin.auth && admin.auth.admin && typeof admin.auth.admin.listUsers === 'function') {
            console.log('Listing users (admin.auth.admin.listUsers) to search for email...');
            const { data, error } = await admin.auth.admin.listUsers();
            if (error) {
              console.log('listUsers error:', error.message || error);
            } else {
              const found = data?.users?.find(u => u?.email?.toLowerCase() === c.value.toLowerCase());
              console.log('listUsers search result:', !!found);
              if (found) console.log('found user via listUsers:', { id: found.id, email: found.email });
            }
          } else {
            console.log('admin.auth.admin.listUsers not available on this client');
          }
        } catch (e) { console.log('listUsers threw:', e && e.message ? e.message : e); }
      }
    }

    // As a broader check, list recent users (if method exists)
    try {
      if (admin.auth && admin.auth.admin && typeof admin.auth.admin.listUsers === 'function') {
        console.log('Fetching first 10 users via listUsers for inspection...');
        const { data, error } = await admin.auth.admin.listUsers({ pageSize: 10 });
        console.log('listUsers output:', { data: data ?? null, error: error ? (error.message || error) : null });
      }
    } catch (e) { console.log('listUsers threw:', e && e.message ? e.message : e); }
  }

  // Try to query anon client profiles (simulate sign-in visibility)
  if (anon) {
    try {
      console.log('Querying profiles via anon client for company rows count...');
      const { data, error } = await anon.from('companies').select('id,name').limit(5);
      console.log('Anon companies result:', { rows: data ?? null, error: error ? (error.message || error) : null });
    } catch (e) { console.log('anon query threw:', e && e.message ? e.message : e); }
  }

  console.log('Check script complete.');
}

run().catch(e => { console.error('Script failed:', e); process.exit(1); });
