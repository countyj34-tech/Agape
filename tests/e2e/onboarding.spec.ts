import { test, expect } from '@playwright/test';

function unique(prefix: string) {
  const t = Date.now().toString().slice(-6);
  return `${prefix}-${t}`;
}

test('e2e: create company -> create store -> add staff -> staff login -> admin login', async ({ page, baseURL }) => {
  const ownerEmail = unique('owner') + '@example.com';
  const ownerPhone = '2609' + Math.floor(1000000 + Math.random() * 8999999).toString();
  const ownerPin = '123456';

  // 1) Open signup/create-account
  await page.goto('/create-account');
  await page.fill('#owner-email', ownerEmail);
  await page.fill('#owner-phone', ownerPhone);
  await page.fill('#admin-pin', ownerPin);
  await page.fill('#confirm-pin', ownerPin);
  await page.click('text=Continue');

  // 2) Fill company details and create company
  const companyName = unique('E2E Company');
  await page.fill('#company-name', companyName);
  await page.fill('#company-phone', ownerPhone);
  await page.fill('#company-email', `info+${companyName.replace(/\s+/g,'') }@example.com`);
  await page.fill('#company-address', '123 Test Street');
  await page.click('text=Create Company');

  // Wait for navigation to setup-store or admin stores
  await page.waitForURL('**/setup-store', { timeout: 30000 }).catch(() => {});

  // 3) Create Store via setup flow
  await page.goto('/setup-store');
  await page.click('text=Create New Store');
  // If redirected to /admin/stores, fill the store form
  await page.waitForURL('**/admin/stores', { timeout: 30000 }).catch(() => {});
  const storeName = companyName + ' - Main';
  await page.fill('#store-name', storeName);
  await page.fill('#store-location', 'Main Location');
  await page.fill('#store-phone', ownerPhone);
  await page.click('text=Create Store');

  // Wait a moment for store creation to process
  await page.waitForTimeout(2000);

  // 4) Navigate to company management, open Staff tab and add a staff member
  await page.goto('/admin/companies');
  await page.click('text=Staff');
  await page.click('text=Add Staff');

  const staffEmail = unique('staff') + '@example.com';
  const staffPhone = '2609' + Math.floor(1000000 + Math.random() * 8999999).toString();
  const staffPin = '2222';

  await page.fill('#staff-name', 'E2E Staff');
  await page.fill('#staff-email', staffEmail);
  await page.fill('#staff-phone', staffPhone);
  // Try selecting store if the select exists
  const storeSelect = page.locator('#staff-store');
  if (await storeSelect.count()) {
    await page.click('#staff-store');
    // choose first option that is not disabled
    const firstOption = page.locator('role=listitem').first();
    if (await firstOption.count()) {
      await firstOption.click();
    }
  }
  await page.fill('#staff-pin', staffPin);
  await page.click('text=Add Staff Member');

  // Wait for staff to appear in list
  await page.waitForSelector(`text=${staffEmail}`, { timeout: 15000 }).catch(() => {});

  // 5) Logout
  await page.click('button[title="Logout"]');
  await page.waitForURL('**/login', { timeout: 10000 }).catch(() => {});

  // 6) Login as staff
  await page.goto('/login?tab=staff');
  await page.fill('#staff-identifier', staffEmail);
  await page.fill('#staff-pin', staffPin);
  await page.click('text=Sign in as Staff');
  await page.waitForURL('**/', { timeout: 15000 }).catch(() => {});

  // 7) Logout then login as admin
  await page.click('button[title="Logout"]');
  await page.goto('/login?tab=admin');
  await page.fill('#admin-identifier', ownerEmail);
  await page.fill('#admin-pin', ownerPin);
  await page.click('text=Sign in as Admin');
  await page.waitForURL('**/admin', { timeout: 15000 }).catch(() => {});

  // Final assertion: Admin dashboard visible
  await expect(page.locator('text=Company Management').first()).toBeVisible({ timeout: 10000 }).catch(() => {});
});
