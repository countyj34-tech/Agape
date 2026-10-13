/**
 * Provision or update the MTHUNZI master (super_admin) user.
 * Usage:
 *   MASTER_EMAIL=you@example.com MASTER_PASSWORD='your-password' node scripts/provision_master_user.mjs
 */
import fs from 'fs';
import path from 'path';
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

async function findUserByEmail(admin, email) {
  if (admin.auth?.admin?.listUsers) {
    let page = 1;
    const perPage = 200;
    while (page <= 20) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const users = data?.users ?? [];
      const match = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
      if (match) return match;
      if (users.length < perPage) break;
      page += 1;
    }
  }
  return null;
}

(async () => {
  const email = (process.env.MASTER_EMAIL || '').trim().toLowerCase();
  const password = process.env.MASTER_PASSWORD || '';
  if (!email || !password) {
    console.error('Set MASTER_EMAIL and MASTER_PASSWORD environment variables.');
    process.exit(2);
  }

  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('.env file not found');
    process.exit(2);
  }
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  const url = env.VITE_SUPABASE_URL;
  const serviceKey = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    console.error('Supabase URL, service role key, or anon key missing in .env');
    process.exit(2);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let user = await findUserByEmail(admin, email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: 'Mthunzi Labs Master',
        role: 'super_admin',
      },
    });
    if (error) {
      console.error('Failed to create auth user:', error.message || error);
      process.exit(1);
    }
    user = data.user;
    console.log('Created new auth user:', user.id);
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(user.user_metadata || {}),
        full_name: user.user_metadata?.full_name || 'Mthunzi Labs Master',
        role: 'super_admin',
      },
    });
    if (error) {
      console.error('Failed to update auth user:', error.message || error);
      process.exit(1);
    }
    console.log('Updated existing auth user:', user.id);
  }

  const { data: profileRow } = await admin.from('profiles').select('*').eq('id', user.id).maybeSingle();
  const companyId = profileRow?.company_id || user.user_metadata?.company_id || null;

  const profilePayload = {
    id: user.id,
    email,
    full_name: profileRow?.full_name || 'Mthunzi Labs Master',
    phone: profileRow?.phone || null,
    role: 'super_admin',
    company_id: companyId,
    store_id: profileRow?.store_id || user.user_metadata?.store_id || null,
    is_active: true,
    updated_at: new Date().toISOString(),
    ...(profileRow?.created_at ? {} : { created_at: new Date().toISOString() }),
  };

  const { error: profileErr } = await admin.from('profiles').upsert(profilePayload, { onConflict: 'id' });
  if (profileErr) {
    const msg = String(profileErr.message || profileErr);
    if (msg.includes('profiles_role_check') || msg.includes('check constraint')) {
      console.warn('super_admin not allowed on profiles table — using owner role + master metadata');
      const fallbackPayload = {
        ...profilePayload,
        role: 'owner',
      };
      const { error: fallbackErr } = await admin.from('profiles').upsert(fallbackPayload, { onConflict: 'id' });
      if (fallbackErr) {
        console.error('Failed to upsert profile (owner fallback):', fallbackErr.message || fallbackErr);
        process.exit(1);
      }
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...(user.user_metadata || {}),
          full_name: 'Mthunzi Labs Master',
          role: 'super_admin',
          is_master_admin: true,
        },
      });
      console.log('Profile role set to owner (master metadata flag set)');
    } else {
      console.error('Failed to upsert profile:', msg);
      process.exit(1);
    }
  } else {
    console.log('Profile role set to super_admin');
  }

  const { data: memberships } = await admin.from('memberships').select('id, company_id').eq('user_id', user.id);
  if (memberships?.length) {
    const { error: memErr } = await admin
      .from('memberships')
      .update({ role: 'owner', is_active: true })
      .eq('user_id', user.id);
    if (memErr) {
      console.warn('Membership update warning:', memErr.message || memErr);
    } else {
      console.log(`Updated ${memberships.length} membership(s) to owner`);
    }
  } else if (companyId) {
    const { error: memInsertErr } = await admin.from('memberships').insert({
      user_id: user.id,
      profile_id: user.id,
      company_id: companyId,
      role: 'owner',
      is_active: true,
      joined_at: new Date().toISOString(),
    });
    if (memInsertErr) {
      console.warn('Membership insert warning:', memInsertErr.message || memInsertErr);
    } else {
      console.log('Created owner membership for master user');
    }
  }

  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) {
    console.error('Login verification failed:', signErr.message || signErr);
    process.exit(1);
  }
  console.log('Login verification successful for', email);
  console.log('Master user ready. Sign in at /login?tab=admin with your email and password.');
})();
