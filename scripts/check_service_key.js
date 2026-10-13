const fs = require('fs');
const outLines = [];
const origLog = console.log.bind(console);
console.log = (...args) => {
  try {
    origLog(...args);
  } catch (e) {
    // ignore
  }
  try {
    outLines.push(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
  } catch (e) {
    // ignore
  }
};

function parseDotEnv(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
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
  } catch (e) {
    return {};
  }
}

const parsed = parseDotEnv('.env');
const key = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || parsed.VITE_SUPABASE_SERVICE_ROLE_KEY || parsed.SUPABASE_SERVICE_ROLE_KEY;
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || parsed.VITE_SUPABASE_URL || parsed.SUPABASE_URL;

function mask(s) {
  if (!s) return s;
  if (s.length <= 12) return s;
  return s.slice(0, 6) + '...' + s.slice(-6);
}

if (!key) {
  console.log('SERVICE_ROLE_KEY: MISSING');
  console.log('VITE_SUPABASE_URL:', url ? url : 'MISSING');
  process.exit(0);
}

console.log('SERVICE_ROLE_KEY:', mask(key));
console.log('VITE_SUPABASE_URL:', url || 'MISSING');

const parts = key.split('.');
console.log('Key format parts:', parts.length, parts.length === 3 ? '(looks like JWT)' : '(not JWT-like)');
if (parts.length === 3) {
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
    const snippet = {
      iss: payload.iss || payload.iss?.toString?.(),
      ref: payload.ref || payload.project_id || undefined,
      role: payload.role || payload.rol || payload.r || undefined,
      iat: payload.iat,
      exp: payload.exp,
    };
    console.log('Token payload snippet:', snippet);
  } catch (e) {
    // ignore
  }
}

// Also print whether Node sees the env var directly
console.log('process.env.VITE_SUPABASE_SERVICE_ROLE_KEY present:', !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);
console.log('process.env.SUPABASE_SERVICE_ROLE_KEY present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

// Check file-level exact match from .env (unmasked) length only
if (parsed.VITE_SUPABASE_SERVICE_ROLE_KEY) {
  console.log('.env VITE key length:', parsed.VITE_SUPABASE_SERVICE_ROLE_KEY.length);
}
if (parsed.VITE_SUPABASE_URL) {
  console.log('.env VITE URL host:', (() => { try { return new URL(parsed.VITE_SUPABASE_URL).host } catch { return parsed.VITE_SUPABASE_URL } })());
}

// write captured output to a file for the runner to read
try {
  const outPath = 'scripts/check_service_key_output.txt';
  fs.writeFileSync(outPath, outLines.join('\n'), 'utf8');
} catch (e) {
  // ignore
}
