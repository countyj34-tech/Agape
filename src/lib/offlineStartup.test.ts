import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreOfflineLocalSession } from './offlineStartup';
import { dexieDb } from './db';
import { pullProductsFromSupabase } from './sync';
import { supabase } from './supabase';

describe('restoreOfflineLocalSession', () => {
  beforeEach(async () => {
    await dexieDb.companies.clear();
    await dexieDb.stores.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('restores the local company and store when internet is unavailable', async () => {
    await dexieDb.companies.put({
      id: 'company-1',
      name: 'Mthunzi Shop',
      ownerPhone: '+260955000000',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await dexieDb.stores.put({
      id: 'store-1',
      companyId: 'company-1',
      company_id: 'company-1',
      name: 'Main Store',
      currency: 'ZMW',
      currency_symbol: 'K',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    const result = await restoreOfflineLocalSession({
      companyId: 'company-1',
      assignedStoreId: 'store-1',
      userRole: 'owner',
    } as any);

    expect(result.company?.id).toBe('company-1');
    expect(result.store?.id).toBe('store-1');
  });

  it('pulls products by company when the device store id is stale', async () => {
    const companyId = 'company-1';
    const productRow = {
      id: 'product-9',
      name: 'Milk',
      barcode: '123',
      store_id: 'store-actual',
      company_id: companyId,
      price: 25,
      cost_price: 18,
      stock_quantity: 10,
      low_stock_threshold: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const query = {
      eq: vi.fn((field: string, value: string) => {
        if (field === 'store_id' && value === 'stale-store') {
          return { data: [], error: null };
        }
        if (field === 'company_id' && value === companyId) {
          return { data: [productRow], error: null };
        }
        return { data: [], error: null };
      }),
    } as any;

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: vi.fn().mockReturnValue(query),
    } as any);

    localStorage.setItem('mthunzi_device_company_id', companyId);
    localStorage.setItem('mthunzi_store_id', 'stale-store');

    const products = await pullProductsFromSupabase('stale-store');

    expect(products).toHaveLength(1);
    expect(products[0].id).toBe('product-9');
    expect(products[0].storeId).toBe('store-actual');
  });
});
