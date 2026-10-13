/**
 * One-shot setup WITHOUT Supabase dashboard login:
 * 1. Verify API connectivity (service role)
 * 2. Create storage bucket for reconciliation backups (no SQL migration needed)
 * 3. Provision master user (super_admin)
 *
 * Usage:
 *   MASTER_EMAIL=mthunzilabs@gmail.com MASTER_PASSWORD='your-password' npm run setup:stock-reconciliation
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'child_process';

const BUCKET = 'stock-reconciliation-sessions';

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
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('.env not found');
    process.exit(2);
  }
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  const url = env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(2);
  }

  console.log('Step 1: Testing Supabase API...');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: companies, error: companiesError } = await admin.from('companies').select('id,name').limit(3);
  if (companiesError) {
    console.error('Cannot reach Supabase API:', companiesError.message);
    console.error('');
    console.error('Check internet connection and .env keys. Dashboard login is NOT required for this step.');
    process.exit(1);
  }
  console.log(`  OK — found ${companies?.length ?? 0} companies in cloud`);

  console.log('Step 2: Ensuring storage bucket for reconciliation backups...');
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = (buckets || []).some((b) => b.name === BUCKET);
  if (!exists) {
    const { error: bucketError } = await admin.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
    });
    if (bucketError && !String(bucketError.message).toLowerCase().includes('already exists')) {
      console.warn('  Bucket create warning:', bucketError.message);
    } else {
      console.log(`  Created bucket: ${BUCKET}`);
    }
  } else {
    console.log(`  Bucket already exists: ${BUCKET}`);
  }

  console.log('Step 3: Provisioning master user...');
  const masterEmail = process.env.MASTER_EMAIL || 'mthunzilabs@gmail.com';
  const masterPassword = process.env.MASTER_PASSWORD;
  if (!masterPassword) {
    console.warn('  Skipped — set MASTER_PASSWORD to create/update super_admin login.');
    console.warn('  Example: $env:MASTER_PASSWORD=\'YourPassword\'; npm run setup:stock-reconciliation');
  } else {
    const result = spawnSync(
      process.execPath,
      ['scripts/provision_master_user.mjs'],
      {
        stdio: 'inherit',
        env: { ...process.env, MASTER_EMAIL: masterEmail, MASTER_PASSWORD: masterPassword },
        cwd: process.cwd(),
      }
    );
    if (result.status !== 0) {
      console.error('Master user provisioning failed.');
      process.exit(result.status ?? 1);
    }
  }

  console.log('');
  console.log('Setup complete (no dashboard login required).');
  console.log('');
  console.log('What works now:');
  console.log('  • AI Stock Processing stores sessions locally (Dexie) — always works');
  console.log('  • Cloud backup uses Storage bucket if SQL table is missing');
  console.log('  • Login to the APP at /login?tab=admin with your master email + password');
  console.log('');
  console.log('Optional later: run SQL migration in dashboard when you recover access,');
  console.log('or set SUPABASE_DB_PASSWORD and run: node scripts/apply_stock_reconciliation_migration.mjs');
})();
