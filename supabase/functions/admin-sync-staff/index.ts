/**
 * Supabase Edge Function example: admin-sync-staff
 *
 * Deploy this with the Supabase CLI: `supabase functions deploy admin-sync-staff`
 * The function uses the service role key available in the function runtime to
 * perform an admin upsert on the `staff` table. Keep the service key secret.
 */

import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL') || '';
// Accept either the explicit SUPABASE_SERVICE_ROLE_KEY env or a shorter SERVICE_ROLE_KEY
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('VITE_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('VITE_SERVICE_ROLE_KEY') || '';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('admin-sync-staff: Missing SUPABASE_URL or service role key (SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY) in function environment');
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (req) => {
  try {
    const payload = await req.json();
    const companyId = payload?.company_id || payload?.companyId || null;
    const storeId = payload?.store_id || payload?.storeId || null;
    if (!payload || !companyId) {
      return new Response(JSON.stringify({ error: 'Invalid payload: company_id required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const row = {
      ...payload,
      company_id: companyId,
      store_id: storeId,
    };

    // Perform upsert as service-role (bypasses RLS)
    const { data, error } = await admin.from('staff').upsert(row, { onConflict: 'id' });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
