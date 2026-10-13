/**
 * Add your OpenAI API key to .env (for stock extraction + daily reports).
 * Usage: node scripts/setup_openai_key.mjs
 * Or:    $env:OPENAI_API_KEY='sk-...'; node scripts/setup_openai_key.mjs
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');

function upsertEnvKey(raw, key, value) {
  const lines = raw.split(/\r?\n/);
  const prefix = `${key}=`;
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(prefix)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
  return next.join('\n');
}

async function promptHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const fromEnv = (process.env.OPENAI_API_KEY || '').trim();
let key = fromEnv;

if (!key) {
  console.log('\nGet a key: https://platform.openai.com/api-keys');
  console.log('Create key → copy → paste below (starts with sk-)\n');
  key = await promptHidden('OPENAI_API_KEY: ');
}

if (!key || !key.startsWith('sk-')) {
  console.error('Invalid or missing key. It should start with sk-');
  process.exit(1);
}

if (!fs.existsSync(envPath)) {
  console.error('.env not found at', envPath);
  process.exit(1);
}

const raw = fs.readFileSync(envPath, 'utf8');
fs.writeFileSync(envPath, upsertEnvKey(raw, 'OPENAI_API_KEY', key), 'utf8');
console.log('\nSaved OPENAI_API_KEY to .env');
console.log('Restart dev server: npm run dev:full\n');
