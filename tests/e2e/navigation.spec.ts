import { test, expect } from '@playwright/test';

const SALES_LINKS = [
  { label: 'Point of Sale', path: '/' },
  { label: 'Sales (Today)', path: '/sales' },
  { label: 'Reports (EOD)', path: '/reports' },
  { label: 'Daily Audit', path: '/inventory-audit' },
  { label: 'Customer Book', path: '/customers' },
  { label: 'Expenses', path: '/expenses' },
  { label: 'User Manual', path: '/help' },
] as const;

async function unlockSession(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('mthunzi_activation_status', 'true');
    localStorage.setItem('mthunzi_activation_key', 'e2e-test-key');
    localStorage.setItem('mthunzi_admin_authenticated', 'true');
    localStorage.setItem('mthunzi_master_session', 'true');
  });

  await page.goto('/login?tab=admin');
  await page.fill('#admin-identifier', 'mthunzilabs@gmail.com');
  await page.fill('#admin-pin', '$Afro2470');
  await page.getByRole('button', { name: /Sign in as Admin/i }).click();

  // POS or admin is fine after unlock
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30000 });
}

async function openSideMenu(page: import('@playwright/test').Page) {
  // Header hamburger (Menu icon button)
  const menuBtn = page.locator('header button').first();
  await menuBtn.click();
  await expect(page.getByRole('heading', { name: 'Mthunzi-POS' })).toBeVisible({ timeout: 5000 });
}

test('navigation: side menu Sales links open instantly', async ({ page }) => {
  const results: { label: string; path: string; ok: boolean; finalUrl: string; ms: number; error?: string }[] = [];

  await unlockSession(page);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  for (const link of SALES_LINKS) {
    const started = Date.now();
    try {
      await openSideMenu(page);
      await page.getByRole('button', { name: link.label, exact: true }).click();

      await page.waitForURL((url) => {
        if (link.path === '/') return url.pathname === '/';
        return url.pathname === link.path || url.pathname.startsWith(`${link.path}/`);
      }, { timeout: 8000 });

      const ms = Date.now() - started;
      const finalUrl = page.url();
      // Must feel instant — under 3s including sheet open
      expect(ms).toBeLessThan(3000);
      results.push({ label: link.label, path: link.path, ok: true, finalUrl, ms });
    } catch (e) {
      results.push({
        label: link.label,
        path: link.path,
        ok: false,
        finalUrl: page.url(),
        ms: Date.now() - started,
        error: (e as Error).message,
      });
      throw e;
    }
  }

  console.log('\n=== NAVIGATION RESULTS ===');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.label} -> ${r.path} (${r.ms}ms) ${r.finalUrl}`);
  }
});

test('navigation: direct URL routes load', async ({ page }) => {
  await unlockSession(page);

  const routes = ['/', '/sales', '/reports', '/inventory-audit', '/customers', '/expenses', '/help', '/checkout'];
  for (const route of routes) {
    const started = Date.now();
    await page.goto(route);
    await page.waitForLoadState('domcontentloaded');
    const ms = Date.now() - started;
    expect(page.url()).toContain(route === '/' ? 'localhost' : route);
    // Page should not stay forever on BootSplash
    const splash = page.locator('text=Loading');
    if (await splash.isVisible().catch(() => false)) {
      await expect(splash).toBeHidden({ timeout: 15000 });
    }
    console.log(`ROUTE OK ${route} (${ms}ms) -> ${page.url()}`);
  }
});
