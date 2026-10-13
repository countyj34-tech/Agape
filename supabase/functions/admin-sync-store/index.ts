/**
 * Supabase Edge Function example: admin-sync-store
 *
 * Deploy this with the Supabase CLI: `supabase functions deploy admin-sync-store`
 * The function uses the service role key available in the function runtime to
 * perform admin upserts on `companies` (optional) and `stores`. Keep the
 * service key secret.
 */

import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL') || '';
// Accept either the explicit SUPABASE_SERVICE_ROLE_KEY env or a shorter SERVICE_ROLE_KEY
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('VITE_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('VITE_SERVICE_ROLE_KEY') || '';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('admin-sync-store: Missing SUPABASE_URL or service role key (SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY) in function environment');
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

serve(async (req) => {
  try {
    const payload = await req.json();
    if (!payload || !payload.store) {
      return new Response(JSON.stringify({ error: 'Invalid payload: store object required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const store = payload.store;
    const company = payload.company || null;

    // If company payload is supplied, upsert it first so FK is satisfied
    if (company && company.id) {
      const { error: compErr } = await admin.from('companies').upsert(company, { onConflict: 'id' });
      if (compErr) {
        return new Response(JSON.stringify({ error: 'Failed to upsert company', details: compErr }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // Upsert store
    const { data, error } = await admin.from('stores').upsert(store, { onConflict: 'id' });
    if (error) {
      return new Response(JSON.stringify({ error: error.message, details: error }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
