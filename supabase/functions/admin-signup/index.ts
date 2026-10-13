/**
 * Supabase Edge Function: admin-signup
 * Creates an auth user (service role) and associated company, store, profile, membership
 * Returns canonical rows. Performs rollback on failure to avoid partial state.
 *
 * Deploy with: supabase functions deploy admin-signup
 */

import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('VITE_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('admin-signup: Missing SUPABASE_URL or service role key (SUPABASE_SERVICE_ROLE_KEY) in function environment');
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

function normalizeProfileRole(role: unknown): 'owner' | 'manager' | 'staff' {
  const value = String(role || '').toLowerCase();
  if (value === 'admin' || value === 'owner') {
    return 'owner';
  }
  if (value === 'manager') {
    return value;
  }
  return 'staff';
}

// CORS headers to allow browser clients (e.g., localhost dev) to call this function.
const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  // include common client headers (supabase-js sends `x-client-info` and `apikey` in preflight)
  // add other Supabase client headers to avoid preflight rejections from browser
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey, x-client-meta, x-supabase-auth',
};

serve(async (req) => {
  // Handle preflight OPTIONS requests early with CORS headers
  if (req.method === 'OPTIONS') {
    // Echo requested headers back in the Access-Control-Allow-Headers to
    // avoid missing future client headers (supabase-js may send `apikey`, etc.)
    const requested = req.headers.get('access-control-request-headers') || '';
    const base = CORS_HEADERS['Access-Control-Allow-Headers'] || '';
    const allowed = requested ? `${requested}, ${base}` : base;
    const headers = { ...CORS_HEADERS, 'Access-Control-Allow-Headers': allowed };
    return new Response(null, { status: 204, headers });
  }
  try {
    const payload = await req.json();
    if (!payload) return new Response(JSON.stringify({ success: false, error: 'Missing payload' }), { status: 400, headers: CORS_HEADERS });

    const email = (payload.email || payload.adminEmail || '').toString().trim().toLowerCase();
    const password = payload.password || payload.pin || payload.pwd || null;
    const companyName = payload.companyName || payload.company_name || payload.name || payload.company || null;
    const companyPhone = payload.companyPhone || payload.company_phone || payload.companyPhoneNumber || payload.companyPhoneNumber || payload.company_phone || payload.phone || null;
    const storeName = payload.storeName || payload.store_name || `${companyName || 'New Company'} Store`;
    const staffName = payload.staffName || payload.fullName || payload.full_name || payload.name || 'Owner';
    const staffPhone = payload.staffPhone || payload.phone || null;
    const providedCompanyId = payload.companyId || payload.company_id || null;
    const providedStoreId = payload.storeId || payload.store_id || null;

    // Validation: if creating a brand-new company, require companyName and companyPhone.
    // If `companyId` is provided, we are creating a staff/auth user for an existing company.
    if (!email || !password) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields: email, password/pin' }), { status: 400, headers: CORS_HEADERS });
    }
    if (!providedCompanyId && (!companyName || !companyPhone)) {
      return new Response(JSON.stringify({ success: false, error: 'Missing required fields: companyName and companyPhone required when creating a new company' }), { status: 400, headers: CORS_HEADERS });
    }

    // Track created IDs for rollback
    let createdUserId = null;
    let createdCompanyId = null;
    let createdStoreId = null;
    let createdProfile = false;
    let createdMembership = false;

    try {
      // 1) Create auth user
      const normalizedRole = normalizeProfileRole(payload.role || 'owner');

      const createRes = await admin.auth.admin.createUser({
        email,
        password,
        user_metadata: { createdBy: 'admin-signup', staffName, staffPhone, role: normalizedRole },
        email_confirm: true
      });

      // Normalise result shapes
      const userObj = createRes?.data?.user || createRes?.user || createRes?.data || createRes;
      createdUserId = userObj?.id || userObj?.user?.id || userObj?.uid || null;

      if (!createdUserId) {
        // Could be the function or SDK returned different shape
        return new Response(JSON.stringify({ success: false, error: 'Failed to create auth user', details: createRes }), { status: 500, headers: CORS_HEADERS });
      }

      // 2) Create or verify company
      if (providedCompanyId) {
        // verify company exists
        const { data: existingCompany, error: compErr } = await admin.from('companies').select('id,name').eq('id', providedCompanyId).maybeSingle();
        if (compErr) throw new Error(`Failed to verify provided companyId: ${compErr.message || JSON.stringify(compErr)}`);
        if (!existingCompany || !existingCompany.id) throw new Error('Provided companyId does not exist');
        createdCompanyId = existingCompany.id;
      } else {
        // Normalize optional company phone to null when empty to avoid unique-index collisions
        const normalizedCompanyPhone = companyPhone ? String(companyPhone).trim() : null;
        const companyObj: any = { name: companyName, owner_email: email, is_active: true };
        if (normalizedCompanyPhone) companyObj.owner_phone = normalizedCompanyPhone;
        const { data: cData, error: cErr } = await admin.from('companies').insert(companyObj).select('id,name').maybeSingle();
        if (cErr) throw new Error(`Failed to create company: ${cErr.message || JSON.stringify(cErr)}`);
        createdCompanyId = cData?.id || (Array.isArray(cData) && cData[0] && cData[0].id) || null;
        if (!createdCompanyId) throw new Error('Company created but id not returned');
      }

      // 3) Create or verify store
      if (providedStoreId) {
        const { data: existingStore, error: storeErr } = await admin.from('stores').select('id,name').eq('id', providedStoreId).maybeSingle();
        if (storeErr) throw new Error(`Failed to verify provided storeId: ${storeErr.message || JSON.stringify(storeErr)}`);
        if (!existingStore || !existingStore.id) throw new Error('Provided storeId does not exist');
        createdStoreId = existingStore.id;
      } else {
        const storeObj = { company_id: createdCompanyId, name: storeName, location_name: payload.storeLocation || 'Main location', is_public: true, is_active: true };
        const { data: sData, error: sErr } = await admin.from('stores').insert(storeObj).select('id,name').maybeSingle();
        if (sErr) throw new Error(`Failed to create store: ${sErr.message || JSON.stringify(sErr)}`);
        createdStoreId = sData?.id || (Array.isArray(sData) && sData[0] && sData[0].id) || null;
        if (!createdStoreId) throw new Error('Store created but id not returned');
      }

      // 4) Insert profile
      // Normalize optional staff phone to null when empty so multiple profiles without
      // a phone do not violate unique constraints on `profiles(phone)`.
      const normalizedStaffPhone = staffPhone ? String(staffPhone).trim() : null;
      const profile: any = {
        id: createdUserId,
        email,
        full_name: staffName,
          role: normalizedRole,
        company_id: createdCompanyId,
        store_id: createdStoreId,
        is_active: true,
      };
      if (normalizedStaffPhone) profile.phone = normalizedStaffPhone;

      // Pre-check for existing profile with the same phone. If another profile
      // already uses this phone number, omit the phone to avoid unique constraint errors.
      if (profile.phone) {
        try {
          const { data: existingByPhone, error: phoneCheckErr } = await admin.from('profiles').select('id').eq('phone', profile.phone).maybeSingle();
          if (phoneCheckErr) {
            console.warn('Phone lookup before profile upsert failed:', phoneCheckErr);
          } else if (existingByPhone && existingByPhone.id && existingByPhone.id !== createdUserId) {
            console.warn('Phone already used by another profile; omitting phone from new profile');
            delete profile.phone;
          }
        } catch (e) {
          console.warn('Phone uniqueness check threw:', e);
        }
      }

      // Attempt upsert; if it fails due to phone uniqueness, retry without the phone value.
      const { data: pData, error: pErr } = await admin.from('profiles').upsert(profile, { onConflict: 'id' });
      if (pErr) {
        const pMsg = pErr.message || JSON.stringify(pErr || {});
        const pMsgLower = typeof pMsg === 'string' ? pMsg.toLowerCase() : '';
        const isPhoneConstraint =
          pMsgLower.includes('profiles_phone_key') ||
          (pMsgLower.includes('duplicate key value violates unique constraint') && pMsgLower.includes('phone'));

        // If the error points to phone uniqueness, retry the upsert without the
        // `phone` field. This covers both explicit constraint names and the
        // generic Postgres duplicate-key message.
        if (isPhoneConstraint) {
          console.warn('Profile upsert failed due to phone uniqueness; retrying without phone');
          const profileNoPhone = { ...profile };
          if (profileNoPhone.phone) delete profileNoPhone.phone;
          const { data: pData2, error: pErr2 } = await admin.from('profiles').upsert(profileNoPhone, { onConflict: 'id' });
          if (pErr2) {
            throw new Error(`Failed to create profile after removing phone: ${pErr2.message || JSON.stringify(pErr2)}`);
          }
          createdProfile = true;
        } else {
          throw new Error(`Failed to create profile: ${pMsg}`);
        }
      } else {
        createdProfile = true;
      }

      // 5) Insert membership
      const membership = { user_id: createdUserId, company_id: createdCompanyId, role: normalizedRole, store_id: createdStoreId, is_active: true };
      const { data: mData, error: mErr } = await admin.from('memberships').insert(membership).select().maybeSingle();
      if (mErr) throw new Error(`Failed to create membership: ${mErr.message || JSON.stringify(mErr)}`);
      createdMembership = true;

      // All good — return canonical rows
      return new Response(JSON.stringify({
        success: true,
        uid: createdUserId,
        user_id: createdUserId,
        company_id: createdCompanyId,
        store_id: createdStoreId,
        company: { id: createdCompanyId, name: companyName },
        store: { id: createdStoreId, name: storeName }
      }), { status: 201, headers: CORS_HEADERS });
    } catch (innerErr) {
      // Rollback what we created
      try {
        if (createdMembership) {
          await admin.from('memberships').delete().eq('user_id', createdUserId).eq('company_id', createdCompanyId);
        }
      } catch (e) { console.warn('Rollback memberships failed', e); }
      try {
        if (createdProfile) {
          await admin.from('profiles').delete().eq('id', createdUserId);
        }
      } catch (e) { console.warn('Rollback profile failed', e); }
      try {
        if (createdStoreId) {
          await admin.from('stores').delete().eq('id', createdStoreId);
        }
      } catch (e) { console.warn('Rollback store failed', e); }
      try {
        if (createdCompanyId) {
          await admin.from('companies').delete().eq('id', createdCompanyId);
        }
      } catch (e) { console.warn('Rollback company failed', e); }
      try {
        if (createdUserId) {
          await admin.auth.admin.deleteUser(createdUserId);
        }
      } catch (e) { console.warn('Rollback user delete failed', e); }

      console.error('admin-signup error:', innerErr);
      return new Response(JSON.stringify({ success: false, error: String(innerErr) }), { status: 500, headers: CORS_HEADERS });
    }
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: CORS_HEADERS });
  }
});
