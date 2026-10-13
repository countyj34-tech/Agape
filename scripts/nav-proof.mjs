import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';
mkdirSync('nav-proof', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(30000);

await page.addInitScript(() => {
  localStorage.setItem('mthunzi_activation_status', 'true');
  localStorage.setItem('mthunzi_activation_key', 'proof-key');
});

console.log('goto login...');
await page.goto(`${BASE}/login?tab=admin`, { waitUntil: 'commit', timeout: 60000 });
await page.waitForSelector('#admin-identifier', { timeout: 30000 });
await page.fill('#admin-identifier', 'mthunzilabs@gmail.com');
await page.fill('#admin-pin', '$Afro2470');
await page.getByRole('button', { name: /Sign in as Admin/i }).click();
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
console.log('login ok', page.url());

await page.goto(`${BASE}/sales`, { waitUntil: 'commit', timeout: 60000 });
await page.waitForTimeout(2000);

await page.locator('header button').first().click();
await page.getByText('Mthunzi-POS', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
await page.screenshot({ path: 'nav-proof/01-menu-open.png' });
console.log('menu open');

await page.getByRole('button', { name: 'Reports (EOD)', exact: true }).click();
await page.waitForURL('**/reports**', { timeout: 8000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'nav-proof/03-reports.png' });
console.log('reports', page.url());

await page.locator('header button').first().click();
await page.getByText('Mthunzi-POS', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
await page.getByRole('button', { name: 'Sales (Today)', exact: true }).click();
await page.waitForURL('**/sales**', { timeout: 8000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'nav-proof/02-sales.png' });
console.log('sales', page.url());

await page.locator('header button').first().click();
await page.getByText('Mthunzi-POS', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
await page.getByRole('button', { name: 'Point of Sale', exact: true }).click();
await page.waitForFunction(() => location.pathname === '/', { timeout: 8000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'nav-proof/04-pos.png' });
console.log('pos', page.url());

await browser.close();
console.log('PROOF DONE');
