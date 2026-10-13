import { dexieDb, getSettings } from '@/lib/db';
import type { Company, Settings, Store } from '@/types/pos';

export async function restoreOfflineLocalSession(currentSettings?: Settings | null): Promise<{
  success: boolean;
  company: Company | null;
  store: Store | null;
  settings: Settings | null;
}> {
  try {
    const settings = (currentSettings ?? (await getSettings()) ?? null) as Settings | null;
    const companyId = settings?.companyId || '';
    const assignedStoreId = settings?.assignedStoreId || '';

    const allCompanies = await dexieDb.companies.toArray();
    const allStores = await dexieDb.stores.toArray();

    let company: Company | null = null;
    if (companyId) {
      company = allCompanies.find((entry) => String(entry.id) === String(companyId)) || null;
    }
    if (!company && allCompanies.length > 0) {
      company = allCompanies[0] || null;
    }

    let store: Store | null = null;
    if (assignedStoreId) {
      store = allStores.find((entry) => String(entry.id) === String(assignedStoreId)) || null;
    }
    if (!store && company) {
      store = allStores.find((entry) => String((entry as any).companyId || (entry as any).company_id) === String(company.id)) || null;
    }
    if (!store && allStores.length > 0) {
      store = allStores[0] || null;
    }

    if (!company && !store) {
      return { success: false, company: null, store: null, settings: settings ?? null };
    }

    const nextSettings: Settings = {
      ...(settings ?? {
        id: 'main',
        shopName: 'Mthunzi Store',
        shopAddress: '',
        shopPhone: '',
        currency: 'ZMW',
        currencySymbol: 'K',
        baseCurrency: 'ZMW',
        plan: 'free',
        userRole: 'staff',
        assignedStoreId: null,
        taxRate: 0,
        salesTaxMode: 'none',
        salesTaxRate: 0,
        singleItemMarginPercent: 0,
        receiptFooter: 'Thank you for shopping with us!',
        thermalPrinterWidth: '80mm',
        adminPin: null,
        pinSetupComplete: false,
        eodAutoPromptEnabled: true,
        eodClosingTime: '18:00',
        auditSyncEnabled: false,
        auditOpeningTime: '08:00',
        auditClosingTime: '18:00',
        activationLockEnabled: true,
        isActivated: true,
        activationKey: '',
        autoWhatsAppEnabled: false,
        autoWhatsAppNumber: '',
        autoWhatsAppMethod: 'web',
        autoWhatsAppWebhookUrl: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      companyId: company?.id || settings?.companyId || '',
      assignedStoreId: store?.id || settings?.assignedStoreId || null,
      userRole: settings?.userRole || 'owner',
      pinSetupComplete: settings?.pinSetupComplete ?? true,
      isActivated: settings?.isActivated ?? true,
      updatedAt: new Date(),
    };

    return {
      success: true,
      company,
      store,
      settings: nextSettings,
    };
  } catch {
    return { success: false, company: null, store: null, settings: (await getSettings()) ?? null };
  }
}
