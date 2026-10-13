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

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error('Missing SUPABASE_URL or ANON_KEY. Set them in environment or .env');
    process.exit(1);
  }

  const adminRespPath = path.join(cwd, 'scripts', 'admin_signup_response.json');
  let fnRespRaw = null;
  try {
    fnRespRaw = JSON.parse(await fs.readFile(adminRespPath, 'utf8'));
  } catch (e) {
    console.error('Failed to read admin_signup_response.json:', e.message || e);
    process.exit(1);
  }

  const payload = fnRespRaw.payload || fnRespRaw.result?.data || fnRespRaw.result || fnRespRaw;
  const email = payload?.email || payload?.payload?.email || (payload?.data && payload.data?.email) || null;
  const password = payload?.password || 'P@ssw0rd1';

  if (!email) {
    console.error('No email found in admin_signup_response.json');
    process.exit(1);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  try {
    console.log('Attempting sign-in for', email);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    console.log('Sign-in result:', { data: data ?? null, error: error ? (error.message || error) : null });
    if (error) process.exit(2);

    if (data?.user) {
      console.log('Sign-in succeeded, user id:', data.user.id);
      // Try to fetch profile
      try {
        const { data: profile, error: profileErr } = await client.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
        console.log('Profile fetch:', { profile: profile || null, error: profileErr ? (profileErr.message || profileErr) : null });
      } catch (e) {
        console.warn('Profile fetch failed:', e);
      }
      process.exit(0);
    }

    console.error('Sign-in did not return a user object');
    process.exit(3);
  } catch (e) {
    console.error('Sign-in failed:', e.message || e);
    process.exit(1);
  }
}

run().catch((e) => { console.error('Script failed:', e); process.exit(1); });
