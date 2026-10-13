import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(45000);
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.addInitScript(() => {
  localStorage.setItem('mthunzi_activation_status', 'true');
  localStorage.setItem('mthunzi_activation_key', 'soft-nav');
});

try {
  await page.goto(`${BASE}/login?tab=admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#admin-identifier');
  await page.fill('#admin-identifier', 'mthunzilabs@gmail.com');
  await page.fill('#admin-pin', '$Afro2470');
  await page.getByRole('button', { name: /Sign in as Admin/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const beforeUrl = page.url();
  const beforeText = await page.locator('main').innerText().catch(() => '');
  const menuCount = await page.getByRole('button', { name: 'Menu' }).count();
  console.log('Before:', beforeUrl);
  console.log('Menu buttons:', menuCount);
  console.log('Has Cloud Sync:', beforeText.includes('Cloud Sync'));
  console.log('Body head:', (await page.locator('body').innerText().catch(() => '')).slice(0, 500));
  const errText = await page.locator('details pre').innerText().catch(() => '');
  if (errText) console.log('Runtime error:', errText.slice(0, 1200));

  if (!menuCount) {
    console.log('Console errors:', consoleErrors.slice(0, 5).join('\n'));
    throw new Error('Menu button not found on admin page');
  }

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Reports (EOD)', exact: true }).click();
  await page.waitForURL('**/reports**', { timeout: 20000 });
  await page.waitForSelector('header h1', { timeout: 20000 });
  await page.waitForTimeout(500);

  const afterUrl = page.url();
  const afterText = await page.locator('main').innerText().catch(() => '');
  console.log('After:', afterUrl);
  console.log('Header:', (await page.locator('header h1').innerText().catch(() => '')));
  console.log('Still Cloud Sync:', afterText.includes('Cloud Sync'));
  console.log('Has report content:', /report|eod|shift|sales/i.test(afterText));

  if (afterUrl.includes('/admin') && afterText.includes('Cloud Sync')) {
    throw new Error('Navigation failed: still on Admin Dashboard');
  }
  if (!afterUrl.includes('/reports')) {
    throw new Error(`Expected /reports got ${afterUrl}`);
  }
  const headerTitle = await page.locator('header h1').innerText().catch(() => '');
  if (!/report/i.test(headerTitle)) {
    throw new Error(`Reports screen not shown (header="${headerTitle}")`);
  }
  console.log('PASS admin -> reports');
} catch (e) {
  console.error('FAIL', e.message, page.url());
  process.exitCode = 1;
} finally {
  await browser.close();
}
