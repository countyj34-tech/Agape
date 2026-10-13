/**
 * Apply stock reconciliation migration to remote Supabase Postgres.
 *
 * Option A (recommended):
 *   set SUPABASE_DB_PASSWORD=your-database-password
 *   node scripts/apply_stock_reconciliation_migration.mjs
 *
 * Option B:
 *   set PG_CONN=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
 *   node scripts/apply_stock_reconciliation_migration.mjs
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

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
    const host = new URL(supabaseUrl).hostname;
    return host.split('.')[0];
  } catch {
    return '';
  }
}

(async () => {
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase-migrations/20260709_stock_reconciliation.sql'
  );
  if (!fs.existsSync(migrationPath)) {
    console.error('Migration file not found:', migrationPath);
    process.exit(2);
  }

  const envPath = path.resolve(process.cwd(), '.env');
  const env = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
  const supabaseUrl = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const projectRef = process.env.SUPABASE_PROJECT_REF || extractProjectRef(supabaseUrl);

  if (process.env.PG_CONN) {
    const result = spawnSync('npx', ['supabase', 'db', 'query', '--db-url', process.env.PG_CONN, '-f', migrationPath], {
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });
    process.exit(result.status ?? 1);
  }

  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  if (!dbPassword) {
    console.error('Missing database credentials.');
    console.error('');
    console.error('Set one of:');
    console.error('  SUPABASE_DB_PASSWORD   (from Supabase Dashboard → Project Settings → Database)');
    console.error('  PG_CONN                (full postgres connection string)');
    console.error('');
    console.error('Then run:');
    console.error('  node scripts/apply_stock_reconciliation_migration.mjs');
    process.exit(2);
  }

  if (!projectRef) {
    console.error('Could not determine Supabase project ref from VITE_SUPABASE_URL');
    process.exit(2);
  }

  const regions = (process.env.SUPABASE_DB_REGIONS || 'eu-west-3,eu-central-1,us-east-1,ap-southeast-1,us-west-1').split(',');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  const poolerFile = path.resolve(process.cwd(), 'supabase/.temp/pooler-url');
  const poolerTemplate = fs.existsSync(poolerFile)
    ? fs.readFileSync(poolerFile, 'utf8').trim()
    : `postgresql://postgres.${projectRef}@aws-1-eu-west-3.pooler.supabase.com:5432/postgres`;

  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.error('Missing pg package. Run: npm install');
    process.exit(1);
  }

  const { Client } = pg.default ?? pg;
  let lastError = null;

  const connectionAttempts = [
    poolerTemplate.includes('@')
      ? poolerTemplate.replace(
          /postgresql:\/\/postgres(\.[A-Za-z0-9-]+)?@/,
          `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@`
        )
      : null,
    ...regions.map(
      (region) =>
        `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-${region.trim()}.pooler.supabase.com:6543/postgres`
    ),
    ...regions.map(
      (region) =>
        `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-1-${region.trim()}.pooler.supabase.com:5432/postgres`
    ),
  ].filter(Boolean);

  for (const connectionString of connectionAttempts) {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

    try {
      console.log('Trying database connection...');
      await client.connect();
      await client.query(sql);
      await client.end();
      console.log('Migration applied successfully.');
      process.exit(0);
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }

  console.error('Failed to apply migration on all attempted connections.');
  if (lastError) {
    console.error(lastError.message || lastError);
  }
  console.error('');
  console.error('Tip: copy the exact connection string from Supabase Dashboard → Database → Connection string');
  console.error('and set PG_CONN before running this script.');
  process.exit(1);
})();
