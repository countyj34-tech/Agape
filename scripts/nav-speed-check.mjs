import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(60000);

await page.addInitScript(() => {
  localStorage.setItem('mthunzi_activation_status', 'true');
  localStorage.setItem('mthunzi_activation_key', 'speed-check');
});

const results = [];

function record(label, ms, ok, extra = '') {
  results.push({ label, ms, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${ms}ms ${extra}`.trim());
}

try {
  const boot0 = Date.now();
  await page.goto(`${BASE}/login?tab=admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#admin-identifier', { timeout: 45000 });
  record('Boot login page', Date.now() - boot0, true, page.url());

  await page.fill('#admin-identifier', 'mthunzilabs@gmail.com');
  await page.fill('#admin-pin', '$Afro2470');
  await page.getByRole('button', { name: /Sign in as Admin/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const menuBtn = page.getByRole('button', { name: 'Menu' });

  for (const [label, buttonName, pathPart] of [
    ['Nav Sales', 'Sales (Today)', '/sales'],
    ['Nav Reports', 'Reports (EOD)', '/reports'],
    ['Nav POS', 'Point of Sale', '/'],
  ]) {
    const t0 = Date.now();
    await menuBtn.click();
    await page.getByRole('link', { name: buttonName, exact: true }).click();
    await page.waitForURL((u) => u.pathname === pathPart || (pathPart !== '/' && u.pathname.startsWith(pathPart)), { timeout: 10000 });
    const ms = Date.now() - t0;
    const splash = await page.getByText('Initializing Mthunzi POS').isVisible().catch(() => false);
    const mainText = await page.locator('main').innerText().catch(() => '');
    record(label, ms, ms < 2500 && !splash, splash ? 'splash=true' : `url=${page.url()}`);
    if (pathPart === '/reports' && mainText.includes('Cloud Sync')) {
      console.log('WARN: Admin dashboard content still visible on reports route');
    }
    await page.waitForTimeout(300);
  }

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const addBtn = page.locator('main button').filter({ hasText: /^Add$/ }).first();
  if (await addBtn.count()) {
    const t0 = Date.now();
    await addBtn.click();
    const ms = Date.now() - t0;
    record('POS Add tap feedback', ms, ms < 800);
  } else {
    console.log('SKIP POS Add tap feedback: no products in this store');
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    throw new Error(`${failed.length} check(s) failed`);
  }
  console.log('ALL CHECKS PASSED');
} catch (e) {
  console.error('CHECK FAILED:', e.message, page.url());
  process.exitCode = 1;
} finally {
  await browser.close();
}
