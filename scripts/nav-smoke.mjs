import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';

const SALES = [
  ['Point of Sale', '/'],
  ['Sales (Today)', '/sales'],
  ['Reports (EOD)', '/reports'],
  ['Daily Audit', '/inventory-audit'],
  ['Customer Book', '/customers'],
  ['Expenses', '/expenses'],
  ['User Manual', '/help'],
];

const DIRECT = ['/', '/sales', '/reports', '/inventory-audit', '/customers', '/expenses', '/help', '/checkout', '/admin'];

const results = [];
function log(msg) {
  console.log(msg);
  results.push(msg);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);

await page.addInitScript(() => {
  localStorage.setItem('mthunzi_activation_status', 'true');
  localStorage.setItem('mthunzi_activation_key', 'e2e-nav-key');
  localStorage.setItem('mthunzi_activation_lock_enabled', 'false');
  // Do NOT pre-set master/admin session — we need a real login so company exists in Dexie.
});

async function ensureLoggedIn() {
  await page.goto(`${BASE}/login?tab=admin`, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => {
    await page.goto(`${BASE}/login?tab=admin`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  });

  // Already inside app?
  if (!page.url().includes('/login') && !page.url().includes('/activate')) {
    log(`Already in app -> ${page.url()}`);
    return;
  }

  // Wait for either login form or an already-authenticated redirect.
  const identifier = page.locator('#admin-identifier');
  const visible = await identifier.isVisible().catch(() => false);
  if (!visible) {
    await page.waitForTimeout(2000);
  }

  if (await identifier.isVisible().catch(() => false)) {
    log('Filling admin login…');
    await identifier.fill('mthunzilabs@gmail.com');
    await page.fill('#admin-pin', '$Afro2470');
    await page.getByRole('button', { name: /Sign in as Admin/i }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
    log(`LOGIN OK -> ${page.url()}`);
    return;
  }

  log(`Login form not shown; current URL ${page.url()}`);
}

try {
  log('== LOGIN ==');
  await ensureLoggedIn();

  // Land on POS
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);
  if (page.url().includes('/login')) {
    await ensureLoggedIn();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);
  }
  log(`POS URL -> ${page.url()}`);

  log('== DIRECT ROUTES ==');
  for (const route of DIRECT) {
    const t0 = Date.now();
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(600);
    const ms = Date.now() - t0;
    const path = new URL(page.url()).pathname;
    const ok = route === '/' ? path === '/' : path.startsWith(route);
    log(`${ok ? 'PASS' : 'FAIL'} direct ${route} => ${path} (${ms}ms)`);
  }

  log('== SIDE MENU CLICKS ==');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) throw new Error('Still on login — cannot test menu');

  for (const [label, path] of SALES) {
    const t0 = Date.now();

    // Open hamburger
    const menuButtons = page.locator('header button');
    await menuButtons.first().click();
    await page.getByText('Mthunzi-POS', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });

    const btn = page.getByRole('button', { name: label, exact: true });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();

    await page.waitForFunction(
      (expected) => {
        const p = location.pathname;
        if (expected === '/') return p === '/';
        return p === expected || p.startsWith(`${expected}/`);
      },
      path,
      { timeout: 8000 }
    );

    const ms = Date.now() - t0;
    log(`PASS menu ${label} => ${page.url()} (${ms}ms)`);
  }

  log('== ALL DONE ==');
} catch (e) {
  log(`ERROR: ${e?.message || e}`);
  log(`AT URL: ${page.url()}`);
  const html = await page.content().catch(() => '');
  writeFileSync('nav-test-fail.html', html.slice(0, 50000), 'utf8');
  await page.screenshot({ path: 'nav-test-fail.png', fullPage: true }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  writeFileSync('nav-test-results.txt', results.join('\n'), 'utf8');
  await browser.close();
}
