import fs from 'fs';

const envFile = '.env';
let env = '';
if (fs.existsSync(envFile)) env = fs.readFileSync(envFile, 'utf8');
function getEnv(key) {
  const re = new RegExp('^' + key + '=(.*)$', 'm');
  const m = env.match(re);
  if (m && m[1]) return m[1].trim();
  return process.env[key] || '';
}

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL');
const ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY');
if (!SUPABASE_URL) {
  console.error('Missing VITE_SUPABASE_URL');
  process.exit(1);
}

const url = SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/admin-signup';
const payload = {
  email: 'diag-ui-' + Date.now() + '@example.com',
  pin: '000000',
  fullName: 'Diag UI',
  companyName: 'Diag UI Co',
  companyPhone: '0123456789'
};

(async () => {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ANON_KEY ? { Authorization: `Bearer ${ANON_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    console.log('URL:', url);
    console.log('Status:', resp.status, resp.statusText);
    console.log('Response body:');
    console.log(text);
    if (!resp.ok) process.exit(2);
    process.exit(0);
  } catch (err) {
    console.error('Fetch error:', err);
    process.exit(3);
  }
})();
