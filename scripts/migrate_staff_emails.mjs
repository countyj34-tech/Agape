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

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in environment or .env before running this script.');
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  console.log('Fetching staff rows from Supabase...');
  const { data: staffRows, error: fetchErr } = await admin.from('staff').select('id,company_id,store_id,name,phone,email,auth_user_id,pin_hash');
  if (fetchErr) {
    console.error('Failed to fetch staff rows:', fetchErr);
    process.exit(1);
  }
  if (!Array.isArray(staffRows) || staffRows.length === 0) {
    console.log('No staff rows found in remote table. Nothing to migrate.');
    process.exit(0);
  }

  const toMigrate = staffRows.filter((s) => {
    const hasEmail = s.email && String(s.email).trim() !== '';
    const hasPhone = s.phone && String(s.phone).trim() !== '';
    return !hasEmail && hasPhone;
  });

  if (toMigrate.length === 0) {
    console.log('No staff rows require email migration (all have email or no phone).');
    process.exit(0);
  }

  console.log(`Found ${toMigrate.length} staff rows to migrate. Updating emails now...`);
  const results = [];

  for (const s of toMigrate) {
    const sanitizedPhone = String(s.phone || '').replace(/\D/g, '');
    // Generate a stable, unique placeholder email. Uses staff id to guarantee uniqueness.
    const generatedEmail = `staff-${s.id}@example.com`;

    try {
      const { data: updated, error: updErr } = await admin.from('staff').update({ email: generatedEmail }).eq('id', s.id).select();
      if (updErr) {
        console.warn(`Failed to update staff ${s.id}:`, updErr.message || updErr);
        results.push({ id: s.id, phone: s.phone, email: null, error: String(updErr) });
        continue;
      }

      console.log(`Updated staff ${s.id} -> ${generatedEmail}`);
      results.push({ id: s.id, phone: s.phone, email: generatedEmail, updated: updated && Array.isArray(updated) ? updated[0] : updated });
    } catch (e) {
      console.error(`Error migrating staff ${s.id}:`, e);
      results.push({ id: s.id, phone: s.phone, email: null, error: String(e) });
    }
  }

  const outPath = path.join(cwd, 'scripts', 'migrate_staff_emails_result.json');
  await fs.writeFile(outPath, JSON.stringify({ migratedAt: new Date().toISOString(), results }, null, 2), 'utf8');
  console.log('Migration complete. Results written to', outPath);
}

run().catch((e) => { console.error('Script failed:', e); process.exit(1); });
