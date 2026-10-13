import { dexieDb, getSettings, saveSettings } from '@/lib/db';
import type { Company, Settings, Store } from '@/types/pos';

export const MASTER_EMAIL = 'mthunzilabs@gmail.com';
export const MASTER_PASSWORD = '$Afro2470';
export const MASTER_SESSION_KEY = 'mthunzi_master_session';
const OFFLINE_COMPANY_NAME = 'Mthunzi Labs Master';

export function isMasterSessionActive(): boolean {
  try {
    return localStorage.getItem(MASTER_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setMasterSessionActive(): void {
  try {
    localStorage.setItem(MASTER_SESSION_KEY, 'true');
    localStorage.setItem('mthunzi_admin_authenticated', 'true');
    localStorage.setItem('mthunzi_activation_status', 'true');
  } catch {
    // ignore
  }
}

export function clearMasterSession(): void {
  try {
    localStorage.removeItem(MASTER_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function isOfflineMasterCredentials(emailOrPhone: string, pin: string): boolean {
  const email = (emailOrPhone || '').trim().toLowerCase();
  const password = (pin || '').trim();
  return email === MASTER_EMAIL && password === MASTER_PASSWORD;
}

async function findOrCreateLocalCompany(): Promise<Company> {
  const all = await dexieDb.companies.toArray();
  const existing =
    all.find((c) => (c.email || '').toLowerCase() === MASTER_EMAIL) ||
    all.find((c) => c.name === OFFLINE_COMPANY_NAME);

  if (existing) return existing;

  const company: Company = {
    id: crypto.randomUUID(),
    name: OFFLINE_COMPANY_NAME,
    email: MASTER_EMAIL,
    ownerPin: '247000',
    currency: 'ZMW',
    currencySymbol: 'K',
    baseCurrency: 'ZMW',
    plan: 'free',
    userRole: 'super_admin',
    assignedStoreId: null,
    taxRate: 0,
    salesTaxMode: 'none',
    salesTaxRate: 0,
    singleItemMarginPercent: 0,
    receiptFooter: '',
    thermalPrinterWidth: '58mm',
    adminPin: null,
    pinSetupComplete: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await dexieDb.companies.put(company);
  return company;
}

async function findOrCreateLocalStore(company: Company): Promise<Store> {
  const allStores = await dexieDb.stores.toArray();
  const existing = allStores.find((s) => s.companyId === company.id);
  if (existing) return existing;

  const store: Store = {
    id: crypto.randomUUID(),
    companyId: company.id,
    name: `${company.name} - Main Store`,
    location_name: 'Master Workspace',
    address: '',
    phone: '',
    currency: company.currency || 'ZMW',
    currency_symbol: company.currencySymbol || 'K',
    is_public: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await dexieDb.stores.put(store);
  return store;
}

/**
 * Local-only master unlock when Supabase is unreachable.
 * Creates a local company/store if needed and grants super_admin.
 * Does not call Supabase APIs (avoids network hangs).
 */
export async function unlockOfflineMaster(): Promise<{
  success: boolean;
  company: Company | null;
  store: Store | null;
  settings: Settings;
  error?: string;
}> {
  try {
    const company = await findOrCreateLocalCompany();
    const store = await findOrCreateLocalStore(company);

    company.assignedStoreId = store.id;
    company.userRole = 'super_admin';
    company.updatedAt = new Date();
    await dexieDb.companies.put(company);

    const existing = (await getSettings()) as Settings;
    const updatedSettings: Settings = {
      ...existing,
      companyId: company.id,
      shopName: company.name,
      currency: company.currency || existing.currency || 'ZMW',
      currencySymbol: company.currencySymbol || existing.currencySymbol || 'K',
      userRole: 'super_admin',
      assignedStoreId: store.id,
      pinSetupComplete: true,
      isActivated: true,
      activationLockEnabled: false,
      updatedAt: new Date(),
    };

    await saveSettings(updatedSettings);

    setMasterSessionActive();

    return {
      success: true,
      company,
      store,
      settings: updatedSettings,
    };
  } catch (error) {
    return {
      success: false,
      company: null,
      store: null,
      settings: (await getSettings()) as Settings,
      error: error instanceof Error ? error.message : 'Offline master unlock failed',
    };
  }
}
