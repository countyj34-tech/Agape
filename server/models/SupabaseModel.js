const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(
  /\/$/,
  ''
);
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

function assertConfigured() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    const error = new Error('Supabase service role is not configured on the server');
    error.statusCode = 503;
    throw error;
  }
}

export async function supabaseRest(method, pathWithQuery, body, options = {}) {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer:
        options.prefer ||
        (method === 'POST' || method === 'PATCH'
          ? 'return=representation'
          : 'return=representation'),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(text || `Supabase request failed (${response.status})`);
    error.statusCode = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

export async function getAuthenticatedUser(accessToken) {
  assertConfigured();
  if (!accessToken) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  return response.json();
}
