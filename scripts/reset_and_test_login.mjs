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

(async () => {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) {
      console.error('.env file not found in project root');
      process.exit(2);
    }
    const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
    const url = env.VITE_SUPABASE_URL;
    const serviceKey = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = env.VITE_SUPABASE_ANON_KEY;
    if (!url || !serviceKey || !anonKey) {
      console.error('Supabase URL, service role key or anon key missing in .env');
      process.exit(2);
    }

    const profileId = process.argv[2];
    const password = process.argv[3] || '123456';
    if (!profileId) {
      console.error('Usage: node scripts/reset_and_test_login.mjs <profile_id> [password]');
      process.exit(2);
    }

    console.log('Resetting password for user id:', profileId);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: updated, error: updateErr } = await admin.auth.admin.updateUserById(profileId, { password });
    if (updateErr) {
      console.error('Failed to update user password:', updateErr.message || updateErr);
      process.exit(1);
    }
    console.log('Password updated for user:', updated?.user?.id || profileId);

    // Test sign-in with anon client
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Need email for user
    // Fetch profile email; some deployments return an array, others a single object.
    const { data: profileData, error: profileErr } = await admin.from('profiles').select('email').eq('id', profileId);
    if (profileErr) {
      console.error('Failed to read profile email:', profileErr?.message || profileErr);
      process.exit(1);
    }
    let email;
    console.log('debug: profileData', JSON.stringify(profileData));
    if (Array.isArray(profileData)) {
      if (profileData.length > 0 && profileData[0] && profileData[0].email) {
        email = profileData[0].email;
      }
    } else if (profileData && profileData.email) {
      email = profileData.email;
    }

    // Fallback: if no email found in `profiles`, try fetching the auth user directly
    if (!email) {
      try {
        const { data: userResult, error: userErr } = await admin.auth.admin.getUserById(profileId);
        console.log('debug: getUserById returned', JSON.stringify({ userResult, userErr }));
        if (userErr || !userResult || !userResult.user || !userResult.user.email) {
          console.error('Profile not found or email missing for id:', profileId);
          process.exit(1);
        }
        email = userResult.user.email;
      } catch (e) {
        console.error('Failed to fetch user via admin.auth:', e.message || e);
        process.exit(1);
      }
    }

    // Another safeguard: if email still missing, abort
    if (!email) {
      console.error('Profile email could not be determined for id:', profileId);
      process.exit(1);
    }
    console.log('Attempting sign-in for', email);

    const { data: signData, error: signErr } = await client.auth.signInWithPassword({ email, password });
    if (signErr) {
      console.error('Sign-in failed:', signErr.message || signErr);
      process.exit(1);
    }

    console.log('Sign-in successful for', email);
    // Try fetching company and store for the profile
    // Fetch profile as the signed-in user. Some deployments return an array,
    // others return a single object; handle both without using `.single()`.
    const { data: profData, error: pErr } = await client.from('profiles').select('*').eq('id', profileId);
    if (pErr) {
      console.warn('Could not fetch profile as signed-in user:', pErr.message || pErr);
    } else {
      let prof = null;
      if (Array.isArray(profData)) {
        prof = profData.length > 0 ? profData[0] : null;
      } else if (profData) {
        prof = profData;
      }

      if (!prof) {
        console.warn('Profile not found for signed-in user; attempting admin fallback to fetch profile row');
        try {
          const { data: adminProfData, error: adminProfErr } = await admin.from('profiles').select('*').eq('id', profileId);
          if (adminProfErr) {
            console.warn('Admin client could not fetch profile:', adminProfErr.message || adminProfErr);
          } else {
            let adminProf = null;
            if (Array.isArray(adminProfData)) {
              adminProf = adminProfData.length > 0 ? adminProfData[0] : null;
            } else if (adminProfData) {
              adminProf = adminProfData;
            }
            if (adminProf) {
              console.log('Profile (admin):', JSON.stringify(adminProf, null, 2));
            } else {
              console.warn('Admin client also did not find profile for id', profileId);
            }
          }
        } catch (e) {
          console.warn('Error while fetching profile via admin client:', e.message || e);
        }
      } else {
        console.log('Profile:', JSON.stringify(prof, null, 2));
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Script error', err);
    process.exit(1);
  }
})();
