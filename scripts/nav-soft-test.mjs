import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(30000);

await page.addInitScript(() => {
  localStorage.setItem('mthunzi_activation_status', 'true');
  localStorage.setItem('mthunzi_activation_key', 'soft-nav');
});

try {
  await page.goto(`${BASE}/login?tab=admin`, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForSelector('#admin-identifier');
  await page.fill('#admin-identifier', 'mthunzilabs@gmail.com');
  await page.fill('#admin-pin', '$Afro2470');
  await page.getByRole('button', { name: /Sign in as Admin/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);

  const t0 = Date.now();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Expenses', exact: true }).click();
  await page.waitForURL('**/expenses**', { timeout: 8000 });
  const ms = Date.now() - t0;

  const splash = await page.getByText('Initializing Mthunzi POS').isVisible().catch(() => false);
  console.log(`Expenses in ${ms}ms splash=${splash} url=${page.url()}`);
  if (splash) throw new Error('Boot splash appeared during soft nav');
  if (ms > 2500) throw new Error(`Too slow: ${ms}ms`);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Sales (Today)', exact: true }).click();
  await page.waitForURL('**/sales**', { timeout: 8000 });
  const splash2 = await page.getByText('Initializing Mthunzi POS').isVisible().catch(() => false);
  if (splash2) throw new Error('Boot splash on second nav');
  console.log('PASS soft nav', page.url());
} catch (e) {
  console.error('FAIL', e.message, page.url());
  process.exitCode = 1;
} finally {
  await browser.close();
}
