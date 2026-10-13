// Lightweight helper to invoke the deployed `admin-signup` Edge Function
// using a direct `fetch` so the browser does not add the `apikey` header
// (which some Supabase gateway configurations reject in CORS preflight).

export async function invokeAdminSignup(payload: any): Promise<{ data: any; error: any }> {
  try {
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL)
      ? String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')
      : (typeof process !== 'undefined' ? (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '') : '');

    const anonKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY)
      ? String(import.meta.env.VITE_SUPABASE_ANON_KEY)
      : (typeof process !== 'undefined' ? (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '') : '');

    if (!base) {
      return { data: null, error: new Error('Missing VITE_SUPABASE_URL') };
    }

    const url = `${base}/functions/v1/admin-signup`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(anonKey ? { Authorization: `Bearer ${anonKey}` } : {}),
      },
      body: JSON.stringify(payload),
      mode: 'cors',
    });

    const text = await resp.text().catch(() => '');
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (e) {
      parsed = text;
    }

    if (!resp.ok) {
      const msg = parsed && (parsed.error || parsed.message) ? String(parsed.error || parsed.message) : `HTTP ${resp.status} ${resp.statusText}`;
      return { data: parsed, error: new Error(msg) };
    }

    return { data: parsed, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

export async function invokeFunction(functionName: string, payload: any, options: { method?: string; headers?: Record<string, string> } = {}): Promise<{ data: any; error: any }> {
  try {
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL)
      ? String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')
      : (typeof process !== 'undefined' ? (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '') : '');

    const anonKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY)
      ? String(import.meta.env.VITE_SUPABASE_ANON_KEY)
      : (typeof process !== 'undefined' ? (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '') : '');

    if (!base) {
      return { data: null, error: new Error('Missing VITE_SUPABASE_URL') };
    }

    const url = `${base}/functions/v1/${functionName}`;
    const method = options.method || 'POST';

    const resp = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(anonKey ? { Authorization: `Bearer ${anonKey}` } : {}),
        ...(options.headers || {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(payload),
      mode: 'cors',
    });

    const text = await resp.text().catch(() => '');
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (e) {
      parsed = text;
    }

    if (!resp.ok) {
      const msg = parsed && (parsed.error || parsed.message) ? String(parsed.error || parsed.message) : `HTTP ${resp.status} ${resp.statusText}`;
      return { data: parsed, error: new Error(msg) };
    }

    return { data: parsed, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}
