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
  try { raw = await fs.readFile(path.join(cwd, '.env'), 'utf8'); } catch(e) { raw = ''; }
  const parsed = parseDotEnv(raw);

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL || '';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const respPath = path.join(cwd, 'scripts', 'admin_signup_response.json');
  const fnResp = JSON.parse(await fs.readFile(respPath, 'utf8'));
  const uid = fnResp?.result?.data?.uid || fnResp?.result?.data?.user_id || fnResp?.result?.data?.id || fnResp?.result?.data?.user?.id;
  console.log('Checking uid:', uid);

  try {
    const userRes = await admin.auth.admin.getUserById(uid);
    console.log('getUserById:', JSON.stringify(userRes, null, 2));
    await fs.writeFile(path.join(process.cwd(), 'scripts', 'check_user_by_uid_out.json'), JSON.stringify({ userRes }, null, 2), 'utf8');
  } catch (e) { console.error('getUserById error:', e.message || e); }

  try {
    const prof = await admin.from('profiles').select('*').eq('id', uid).maybeSingle();
    console.log('profiles query:', JSON.stringify(prof, null, 2));
    // append to result file
    try {
      const outPath = path.join(process.cwd(), 'scripts', 'check_user_by_uid_out.json');
      const existing = JSON.parse(await fs.readFile(outPath, 'utf8')) || {};
      existing.profiles = prof;
      await fs.writeFile(outPath, JSON.stringify(existing, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
  } catch (e) { console.error('profiles query error:', e.message || e); }

  try {
    const members = await admin.from('memberships').select('*').eq('user_id', uid);
    console.log('memberships query:', JSON.stringify(members, null, 2));
    try {
      const outPath = path.join(process.cwd(), 'scripts', 'check_user_by_uid_out.json');
      const existing = JSON.parse(await fs.readFile(outPath, 'utf8')) || {};
      existing.memberships = members;
      await fs.writeFile(outPath, JSON.stringify(existing, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
  } catch (e) { console.error('memberships query error:', e.message || e); }
}

run().catch(e => { console.error('failed:', e); process.exit(1); });
