import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(30000);

await page.addInitScript(() => {
  localStorage.setItem('mthunzi_activation_status', 'true');
  localStorage.setItem('mthunzi_activation_key', 'hard-nav');
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

  await page.locator('header button').first().click();
  await page.getByRole('button', { name: 'Sales (Today)', exact: true }).click();
  await page.waitForURL('**/sales**', { timeout: 20000 });
  console.log('PASS Sales', page.url());

  await page.locator('header button').first().click();
  await page.getByRole('button', { name: 'Reports (EOD)', exact: true }).click();
  await page.waitForURL('**/reports**', { timeout: 20000 });
  console.log('PASS Reports', page.url());

  await page.locator('header button').first().click();
  await page.getByRole('button', { name: 'Point of Sale', exact: true }).click();
  await page.waitForFunction(() => location.pathname === '/', { timeout: 20000 });
  console.log('PASS POS', page.url());
  console.log('ALL PASS');
} catch (e) {
  console.error('FAIL', e.message, page.url());
  process.exitCode = 1;
} finally {
  await browser.close();
}
