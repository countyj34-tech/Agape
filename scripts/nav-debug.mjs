import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8080';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(30000);

await page.addInitScript(() => {
  localStorage.setItem('mthunzi_activation_status', 'true');
  localStorage.setItem('mthunzi_activation_key', 'nav-debug');
});

const logs = [];
const log = (m) => {
  console.log(m);
  logs.push(m);
};

async function dumpLocks(label) {
  const info = await page.evaluate(() => {
    const body = document.body;
    const overlays = Array.from(document.querySelectorAll('[data-radix-dialog-overlay], [data-state]')).map((el) => ({
      tag: el.tagName,
      state: el.getAttribute('data-state'),
      pe: getComputedStyle(el).pointerEvents,
      z: getComputedStyle(el).zIndex,
      cls: el.className?.toString?.().slice(0, 120),
    }));
    return {
      url: location.href,
      bodyPe: body.style.pointerEvents,
      bodyOverflow: body.style.overflow,
      bodyComputedPe: getComputedStyle(body).pointerEvents,
      scrollLocked: body.getAttribute('data-scroll-locked'),
      overlays: overlays.filter((o) => o.pe !== 'none' || o.state === 'open').slice(0, 20),
      openDialogs: document.querySelectorAll('[role="dialog"][data-state="open"]').length,
    };
  });
  log(`${label}: ${JSON.stringify(info)}`);
  return info;
}

try {
  await page.goto(`${BASE}/login?tab=admin`, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForSelector('#admin-identifier', { timeout: 20000 });
  await page.fill('#admin-identifier', 'mthunzilabs@gmail.com');
  await page.fill('#admin-pin', '$Afro2470');
  await page.getByRole('button', { name: /Sign in as Admin/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 45000 });
  log(`login -> ${page.url()}`);

  await page.goto(`${BASE}/`, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForTimeout(2000);
  await dumpLocks('POS ready');

  // Open menu and click Sales via Link
  await page.locator('header button').first().click();
  await page.waitForTimeout(400);
  await dumpLocks('menu open');
  await page.getByRole('link', { name: 'Sales (Today)' }).click();
  await page.waitForTimeout(800);
  await dumpLocks('after Sales click');
  log(`url after sales: ${page.url()}`);

  // Try clicking Reports from menu without refresh
  await page.locator('header button').first().click();
  await page.waitForTimeout(400);
  const clicked = await page.getByRole('link', { name: 'Reports (EOD)' }).click({ timeout: 5000 }).then(() => true).catch((e) => e.message);
  log(`Reports click result: ${clicked}`);
  await page.waitForTimeout(800);
  await dumpLocks('after Reports click');
  log(`url after reports: ${page.url()}`);

  // Check if hamburger still works
  const menuClick = await page.locator('header button').first().click({ timeout: 3000 }).then(() => 'ok').catch((e) => e.message);
  log(`hamburger after nav: ${menuClick}`);
  await dumpLocks('final');
} catch (e) {
  log(`ERROR: ${e.message}`);
  await page.screenshot({ path: 'nav-debug-fail.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync('nav-debug-results.txt', logs.join('\n'), 'utf8');
  await browser.close();
}
