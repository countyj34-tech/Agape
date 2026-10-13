import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(45000);

await page.addInitScript(() => {
  localStorage.setItem('mthunzi_activation_status', 'true');
  localStorage.setItem('mthunzi_activation_key', 'industry-check');
});

const results = [];
function record(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function openMenu() {
  await page.getByRole('button', { name: 'Menu' }).click();
}

async function goMenu(linkName) {
  await openMenu();
  const t0 = Date.now();
  await page.getByRole('link', { name: linkName, exact: true }).click();
  return Date.now() - t0;
}

try {
  await page.goto(`${BASE}/login?tab=admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#admin-identifier');
  await page.fill('#admin-identifier', 'mthunzilabs@gmail.com');
  await page.fill('#admin-pin', '$Afro2470');
  await page.getByRole('button', { name: /Sign in as Admin/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });

  // Start on Admin
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Cloud Sync', { timeout: 20000 });

  // Soft leave Admin → Reports (must change HEADER, not just URL)
  let ms = await goMenu('Reports (EOD)');
  await page.waitForURL('**/reports**', { timeout: 10000 });
  await page.waitForFunction(() => {
    const h = document.querySelector('header h1');
    return h && /report/i.test(h.textContent || '');
  }, { timeout: 8000 });
  record('Admin → Reports soft nav', true, `${ms}ms header=Reports`);

  // Reports → Sales
  ms = await goMenu('Sales (Today)');
  await page.waitForURL('**/sales**', { timeout: 10000 });
  await page.waitForFunction(() => {
    const h = document.querySelector('header h1');
    return h && /sales/i.test(h.textContent || '');
  }, { timeout: 8000 });
  record('Reports → Sales soft nav', true, `${ms}ms`);

  // Sales → POS
  ms = await goMenu('Point of Sale');
  await page.waitForURL((u) => u.pathname === '/', { timeout: 10000 });
  await page.waitForTimeout(500);
  const splash = await page.getByText('Initializing Mthunzi POS').isVisible().catch(() => false);
  record('Sales → POS soft nav', !splash, `${ms}ms splash=${splash}`);

  // POS → Admin via settings gear if present, else menu
  const gear = page.getByRole('button', { name: 'Admin' });
  if (await gear.count()) {
    const t0 = Date.now();
    await gear.click();
    await page.waitForURL('**/admin**', { timeout: 10000 });
    await page.waitForSelector('text=Cloud Sync', { timeout: 15000 });
    record('POS → Admin gear', true, `${Date.now() - t0}ms`);
  } else {
    ms = await goMenu('Dashboard');
    await page.waitForURL('**/admin**', { timeout: 10000 });
    await page.waitForSelector('text=Cloud Sync', { timeout: 15000 });
    record('POS → Admin menu', true, `${ms}ms`);
  }

  // Leave admin again via menu (critical soft path)
  ms = await goMenu('Expenses');
  await page.waitForURL('**/expenses**', { timeout: 10000 });
  await page.waitForFunction(() => {
    const body = document.body.innerText;
    return !body.includes('Cloud Sync') || /expense/i.test(document.querySelector('header h1')?.textContent || '');
  }, { timeout: 8000 });
  const header = await page.locator('header h1').innerText().catch(() => '');
  record('Admin → Expenses soft nav', !/admin/i.test(header), `${ms}ms header="${header}"`);

  // Hard refresh must not be required: navigate without reload
  const softOnly = results.every((r) => r.ok);
  record('No refresh required for page changes', softOnly);

  if (!softOnly) throw new Error('One or more navigation checks failed');
  console.log('INDUSTRY NAV CHECK: PASS');
} catch (e) {
  console.error('INDUSTRY NAV CHECK: FAIL', e.message, page.url());
  process.exitCode = 1;
} finally {
  await browser.close();
}
