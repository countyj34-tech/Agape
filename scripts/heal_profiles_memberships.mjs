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
    console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in environment or .env');
    process.exit(2);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const apply = process.argv.includes('--apply');
  console.log('Heal script starting (apply changes?:', apply, ')');

  // Paginate through users via admin.auth.admin.listUsers
  let page = 1;
  const pageSize = 100; // adjust if needed
  let totalFixed = 0;

  while (true) {
    console.log(`Fetching users page ${page}...`);
    let listRes;
    try {
      listRes = await admin.auth.admin.listUsers({ page, perPage: pageSize });
    } catch (e) {
      console.error('listUsers failed:', e.message || e);
      process.exit(1);
    }

    const users = (listRes && listRes.data && listRes.data.users) || [];
    if (!users.length) break;

    for (const u of users) {
      const userId = u.id;
      const email = (u.email || '').toLowerCase();

      // Check profile exists
      try {
        const { data: profRows } = await admin.from('profiles').select('*').eq('id', userId).limit(1);
        const profileExists = Array.isArray(profRows) && profRows.length > 0;
        if (!profileExists) {
          console.log(`Profile missing for user ${userId} (${email}).`);
          if (apply) {
            const profile = { id: userId, email, full_name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.fullName)) || '', role: 'staff', is_active: true };
            const { data: pData, error: pErr } = await admin.from('profiles').upsert(profile, { onConflict: 'id' });
            if (pErr) {
              console.warn('Failed to upsert profile for', userId, pErr.message || pErr);
            } else {
              console.log('Created profile for', userId);
              totalFixed++;
            }
          }
        }
      } catch (e) {
        console.warn('Error checking/creating profile for', userId, e.message || e);
      }

      // Check membership exists for companies owned by this email
      try {
        // find companies where owner_email or email matches
        const { data: companies } = await admin.from('companies').select('id').or(`owner_email.eq.${email},email.eq.${email}`);
        if (companies && companies.length > 0) {
          for (const c of companies) {
            const companyId = c.id;
            const { data: memRows } = await admin.from('memberships').select('*').eq('user_id', userId).eq('company_id', companyId).limit(1);
            const membershipExists = Array.isArray(memRows) && memRows.length > 0;
            if (!membershipExists) {
              console.log(`Membership missing for user ${userId} in company ${companyId}`);
              if (apply) {
                const membership = { user_id: userId, company_id: companyId, role: 'owner', is_active: true };
                const { data: mData, error: mErr } = await admin.from('memberships').insert(membership).select().maybeSingle();
                if (mErr) console.warn('Failed to insert membership:', mErr.message || mErr); else { console.log('Inserted membership for', userId, 'company', companyId); totalFixed++; }
              }
            }
          }
        }
      } catch (e) { console.warn('Error checking/creating membership for', userId, e.message || e); }
    }

    // pagination anchor
    const nextPage = listRes?.data?.nextPage;
    if (!nextPage || users.length < pageSize) break;
    page = nextPage;
  }

  console.log('Heal script complete. Total changes (if applied):', totalFixed);
  if (!apply) console.log('Re-run with --apply to make changes.');
}

run().catch(e => { console.error('Heal script failed:', e); process.exit(1); });
