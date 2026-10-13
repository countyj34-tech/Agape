import fs from 'fs/promises';
import path from 'path';

async function run() {
  const cwd = process.cwd();
  const src = path.join(cwd, 'scripts', 'admin_signup_no_cleanup_response.json');
  const dst = path.join(cwd, 'scripts', 'admin_signup_response.json');
  try {
    const raw = await fs.readFile(src, 'utf8');
    const d = JSON.parse(raw);
    const out = { result: { data: d.body, error: null }, payload: d.payload };
    await fs.writeFile(dst, JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote', dst);
  } catch (e) {
    console.error('Failed to convert:', e.message || e);
    process.exit(1);
  }
}

run();
