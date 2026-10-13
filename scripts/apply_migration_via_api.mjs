/**
 * Apply SQL migration using Supabase Management API (requires SUPABASE_ACCESS_TOKEN).
 */
import fs from 'fs';
import path from 'path';

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

function extractProjectRef(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    return '';
  }
}

async function runQuery(projectRef, accessToken, sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(typeof body === 'object' ? JSON.stringify(body) : String(body));
  }
  return body;
}

(async () => {
  const migrationPath = path.resolve(
    process.cwd(),
    process.argv[2] || 'supabase-migrations/20260709_stock_reconciliation.sql'
  );

  if (!fs.existsSync(migrationPath)) {
    console.error('Migration file not found:', migrationPath);
    process.exit(2);
  }

  const envPath = path.resolve(process.cwd(), '.env');
  const env = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
  const projectRef =
    process.env.SUPABASE_PROJECT_REF ||
    extractProjectRef(env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '');
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!projectRef || !accessToken) {
    console.error('Need SUPABASE_ACCESS_TOKEN and project ref (VITE_SUPABASE_URL or SUPABASE_PROJECT_REF).');
    process.exit(2);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  console.log('Applying migration to project:', projectRef);

  try {
    const result = await runQuery(projectRef, accessToken, sql);
    console.log('Migration applied successfully.');
    if (result) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already exists') || message.includes('duplicate')) {
      console.log('Migration partially exists already (safe to ignore if table/policies exist).');
      process.exit(0);
    }
    console.error('Migration failed:', message);
    process.exit(1);
  }
})();
