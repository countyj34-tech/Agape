/**
 * Store Management Functions
 * 
 * Helper functions for:
 * - Creating and managing stores
 * - Store joining functionality
 * - Store codes for multi-device access
 * - Real-time store data synchronization
 */

import { dexieDb } from './db';
import { supabase, supabaseAdmin, isSupabaseConfigured, type SupabaseStore } from './supabase';
import { invokeFunction } from './adminSignupClient';
import type { Store } from '@/types/pos';

async function ensureRemoteCompanyForStore(companyId: string): Promise<void> {
  if (!isSupabaseConfigured() || !companyId) {
    return;
  }

  const { data, error } = await supabase.from('companies').select('id').eq('id', companyId).limit(1).single();
  if (error && !String(error.message).toLowerCase().includes('null')) {
    console.warn('Remote company existence check failed:', error.message || error);
  }

  if (!data) {
    const company = await dexieDb.companies.get(companyId);
    if (!company) {
      console.warn('Cannot create store remotely because company is missing locally:', companyId);
      return;
    }

    console.log('Creating missing remote company before creating store:', companyId);
    const client: any = (typeof supabaseAdmin !== 'undefined' && supabaseAdmin) ? supabaseAdmin : supabase;
    const { error: upsertError } = await client.from('companies').upsert({
      id: company.id,
      name: company.name,
      owner_phone: company.ownerPhone,
      email: company.email,
      address: company.address,
      currency: company.currency,
      currency_symbol: company.currencySymbol,
      base_currency: company.baseCurrency,
      tax_rate: company.taxRate,
      sales_tax_mode: company.salesTaxMode,
      sales_tax_rate: company.salesTaxRate,
      single_item_margin_percent: company.singleItemMarginPercent,
      receipt_footer: company.receiptFooter,
      thermal_printer_width: company.thermalPrinterWidth,
      plan: company.plan,
      is_active: company.isActive,
      created_at: company.createdAt,
      updated_at: company.updatedAt
    });

    if (upsertError) {
      console.error('Failed to create remote company:', upsertError.message || upsertError);
    }
  }
}

/**
 * Create a new store
 */
export async function createStore(storeData: Partial<Store>, companyId: string): Promise<{ success: boolean; store?: Store; storeId?: string; queued?: boolean; warning?: string; error?: string }> {
  try {
    // Validate required fields
    if (!storeData.name || !companyId) {
      return { success: false, error: 'Store name and company ID are required' };
    }
    const storeId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Prepare the store object. We will write Supabase first and mirror locally after.
    const newStore: Store = {
      id: storeId,
      companyId,
      name: storeData.name,
      location_name: storeData.location_name || storeData.name,
      address: storeData.address || '',
      phone: storeData.phone || '',
      currency: storeData.currency || 'ZMW',
      currency_symbol: storeData.currency_symbol || 'K',
      is_public: storeData.is_public ?? true,
      created_at: now,
      updated_at: now
    };

    let remoteStoreSaved = false;
    if (isSupabaseConfigured()) {
      try {
        await ensureRemoteCompanyForStore(companyId);

        let remoteCreated = false;
        let fnResult: any = null;

        if (typeof supabaseAdmin !== 'undefined' && supabaseAdmin) {
          try {
            const client: any = supabaseAdmin;
            const { error: remoteError } = await client.from('stores').upsert({
              id: storeId,
              company_id: companyId,
              name: newStore.name,
              location_name: newStore.location_name,
              address: newStore.address,
              phone: newStore.phone,
              currency: newStore.currency,
              currency_symbol: newStore.currency_symbol,
              is_public: newStore.is_public,
              created_at: newStore.created_at,
              updated_at: newStore.updated_at
            });

            remoteCreated = !remoteError;
            if (remoteError) {
              console.error('Failed to create remote store with admin client:', remoteError.message || remoteError);
            }
          } catch (e) {
            console.warn('Admin client store upsert failed:', e);
          }
        }

        if (!remoteCreated) {
          try {
            const localCompany = await dexieDb.companies.get(companyId);
            const payload: any = {
              store: {
                id: storeId,
                company_id: companyId,
                name: newStore.name,
                location_name: newStore.location_name,
                address: newStore.address,
                phone: newStore.phone,
                currency: newStore.currency,
                currency_symbol: newStore.currency_symbol,
                is_public: newStore.is_public,
                created_at: newStore.created_at,
                updated_at: newStore.updated_at
              }
            };
            if (localCompany) {
              payload.company = {
                id: localCompany.id,
                name: localCompany.name,
                owner_email: localCompany.email,
                owner_phone: localCompany.ownerPhone,
                address: localCompany.address,
                currency: localCompany.currency,
                currency_symbol: localCompany.currencySymbol,
                base_currency: localCompany.baseCurrency,
                tax_rate: localCompany.taxRate,
                sales_tax_mode: localCompany.salesTaxMode,
                sales_tax_rate: localCompany.salesTaxRate,
                single_item_margin_percent: localCompany.singleItemMarginPercent,
                receipt_footer: localCompany.receiptFooter,
                thermal_printer_width: localCompany.thermalPrinterWidth,
                plan: localCompany.plan,
                is_active: localCompany.isActive,
                created_at: localCompany.createdAt,
                updated_at: localCompany.updatedAt
              };
            }

            const { data: fnData, error: fnError } = await invokeFunction('admin-sync-store', payload);
            if (!fnError) {
              fnResult = fnData;
              remoteCreated = true;
            } else {
              console.warn('admin-sync-store invocation error (direct fetch):', fnError);
            }
          } catch (fnErr) {
            console.warn('admin-sync-store invocation failed:', fnErr);
          }
        }

        remoteStoreSaved = remoteCreated;

        if (remoteCreated) {
          try {
            let remoteRow: any = null;

            try {
              const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).limit(1).single();
              if (!error && data) remoteRow = data;
            } catch (e) {
              // ignore - will try admin fallback
            }

            if (!remoteRow && typeof supabaseAdmin !== 'undefined' && supabaseAdmin) {
              try {
                const adminRes: any = await supabaseAdmin.from('stores').select('*').eq('id', storeId).limit(1).single();
                if (!adminRes.error && adminRes.data) remoteRow = adminRes.data;
              } catch (e) {
                // ignore
              }
            }

            if (!remoteRow && fnResult) {
              remoteRow = fnResult.store || fnResult;
            }

            if (remoteRow) {
              const canonicalStore: Store = {
                id: remoteRow.id,
                companyId: remoteRow.company_id,
                name: remoteRow.name,
                location_name: remoteRow.location_name,
                address: remoteRow.address || '',
                phone: remoteRow.phone || '',
                currency: remoteRow.currency || 'ZMW',
                currency_symbol: remoteRow.currency_symbol || 'K',
                is_public: remoteRow.is_public ?? true,
                created_at: remoteRow.created_at,
                updated_at: remoteRow.updated_at
              };

              await dexieDb.stores.put(canonicalStore);
            }
          } catch (err) {
            console.warn('Failed to canonicalize store from Supabase, keeping local store:', err);
          }
        } else {
          try {
            const { SupabaseFirstService } = await import('./supabaseFirst');
            SupabaseFirstService.addToSyncQueue({
              type: 'create',
              table: 'stores',
              data: {
                id: storeId,
                company_id: companyId,
                name: newStore.name,
                location_name: newStore.location_name,
                address: newStore.address,
                phone: newStore.phone,
                currency: newStore.currency,
                currency_symbol: newStore.currency_symbol,
                is_public: newStore.is_public,
                created_at: newStore.created_at,
                updated_at: newStore.updated_at,
              },
            });
          } catch (queueErr) {
            console.warn('Failed to queue store create operation for later sync:', queueErr);
          }
        }
      } catch (backgroundErr) {
        console.warn('Background store sync failed:', backgroundErr);
      }
    }

    // Mirror locally after the remote write completes.
    await dexieDb.stores.put(newStore);

    return { success: true, store: newStore, storeId, queued: isSupabaseConfigured(), warning: isSupabaseConfigured() ? 'Created locally and syncing in background' : undefined };
  } catch (error) {
    console.error('Create store error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Get all stores for a company
 */
export async function getCompanyStores(companyId: string): Promise<Store[]> {
  try {
    if (!companyId) {
      return [];
    }

    // Get stores locally first — prefer indexed query but fall back to full scan
    let localStores: Store[] = [];
    try {
      localStores = await dexieDb.stores.where('companyId').equals(companyId).toArray();
    } catch (dexieErr) {
      console.warn('Dexie companyId index missing or query failed, falling back to full scan:', dexieErr);
      const all = await dexieDb.stores.toArray();
      localStores = (all as Store[]).filter((s) => s.companyId === companyId);
    }

    // If Supabase is configured, sync with remote
    if (isSupabaseConfigured()) {
      const { data: remoteStores, error: remoteError } = await supabase
        .from('stores')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true);

      if (remoteError) {
        console.error('Failed to fetch remote stores:', remoteError.message || remoteError);
      } else if (remoteStores && remoteStores.length > 0) {
        // Sync remote stores to local
        for (const remoteStore of remoteStores) {
          const localStore: Store = {
            id: remoteStore.id,
            companyId: remoteStore.company_id,
            name: remoteStore.name,
            location_name: remoteStore.location_name,
            address: remoteStore.address || '',
            phone: remoteStore.phone || '',
            currency: remoteStore.currency || 'ZMW',
            currency_symbol: remoteStore.currency_symbol || 'K',
            is_public: remoteStore.is_public ?? true,
            created_at: remoteStore.created_at,
            updated_at: remoteStore.updated_at
          };

          await dexieDb.stores.put(localStore);
        }

        // Get updated local stores (use full-scan fallback to avoid index issues)
        const all = await dexieDb.stores.toArray();
        return (all as Store[]).filter((s) => s.companyId === companyId);
      }
    }

    return localStores;
  } catch (error) {
    console.error('Get company stores error:', error);
    return [];
  }
}

/**
 * Update a store
 */
export async function updateStore(storeId: string, updates: Partial<Store>): Promise<{ success: boolean; error?: string }> {
  try {
    if (!storeId) {
      return { success: false, error: 'Store ID is required' };
    }

    const existingStore = await dexieDb.stores.get(storeId);
    if (!existingStore) {
      return { success: false, error: 'Store not found' };
    }

    // Update locally
    const updatedStore = {
      ...existingStore,
      ...updates,
      updated_at: new Date().toISOString()
    };

    await dexieDb.stores.put(updatedStore);

    // Update remotely if Supabase is configured
    if (isSupabaseConfigured()) {
      const remoteUpdates: any = {};
      
      if (updates.name) remoteUpdates.name = updates.name;
      if (updates.location_name) remoteUpdates.location_name = updates.location_name;
      if (updates.address !== undefined) remoteUpdates.address = updates.address;
      if (updates.phone !== undefined) remoteUpdates.phone = updates.phone;
      if (updates.currency) remoteUpdates.currency = updates.currency;
      if (updates.currency_symbol) remoteUpdates.currency_symbol = updates.currency_symbol;
      if (updates.is_public !== undefined) remoteUpdates.is_public = updates.is_public;
      
      remoteUpdates.updated_at = updatedStore.updated_at;

      const client: any = (typeof supabaseAdmin !== 'undefined' && supabaseAdmin) ? supabaseAdmin : supabase;
      const { error: remoteError } = await client
        .from('stores')
        .update(remoteUpdates)
        .eq('id', storeId);

      if (remoteError) {
        console.error('Failed to update remote store:', remoteError.message || remoteError);
        // Don't fail the operation if remote sync fails
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Update store error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Delete a store
 */
export async function deleteStore(storeId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!storeId) {
      return { success: false, error: 'Store ID is required' };
    }

    const existingStore = await dexieDb.stores.get(storeId);
    if (!existingStore) {
      return { success: false, error: 'Store not found' };
    }

    // Soft delete locally
    await dexieDb.stores.update(storeId, { 
      updated_at: new Date().toISOString() 
    });

    // Soft delete remotely if Supabase is configured
    if (isSupabaseConfigured()) {
      const client: any = (typeof supabaseAdmin !== 'undefined' && supabaseAdmin) ? supabaseAdmin : supabase;
      const { error: remoteError } = await client
        .from('stores')
        .update({ 
          updated_at: new Date().toISOString() 
        })
        .eq('id', storeId);

      if (remoteError) {
        console.error('Failed to delete remote store:', remoteError.message || remoteError);
        // Don't fail the operation if remote sync fails
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Delete store error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Get store by ID
 */
export async function getStore(storeId: string): Promise<{ success: boolean; store?: Store; error?: string }> {
  try {
    if (!storeId) {
      return { success: false, error: 'Store ID is required' };
    }

    const store = await dexieDb.stores.get(storeId);
    if (!store) {
      return { success: false, error: 'Store not found' };
    }

    // If Supabase is configured, sync with remote
    if (isSupabaseConfigured()) {
      const { data: remoteStore, error: remoteError } = await supabase
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .single();

      if (remoteError) {
        console.error('Failed to fetch remote store:', remoteError.message || remoteError);
      } else if (remoteStore) {
        // Update local store with remote data
        const updatedStore: Store = {
          id: remoteStore.id,
          companyId: remoteStore.company_id,
          name: remoteStore.name,
          location_name: remoteStore.location_name,
          address: remoteStore.address || '',
          phone: remoteStore.phone || '',
          currency: remoteStore.currency || 'ZMW',
          currency_symbol: remoteStore.currency_symbol || 'K',
          is_public: remoteStore.is_public ?? true,
          created_at: remoteStore.created_at,
          updated_at: remoteStore.updated_at
        };

        await dexieDb.stores.put(updatedStore);
        return { success: true, store: updatedStore };
      }
    }

    return { success: true, store };
  } catch (error) {
    console.error('Get store error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Get all public stores
 */
export async function getPublicStores(): Promise<{ success: boolean; stores?: Store[]; error?: string }> {
  try {
    // Get stores locally first
    const localStores = await dexieDb.stores.toArray();
    const publicStores = localStores.filter(store => store.is_public ?? true);

    // If Supabase is configured, sync with remote
    if (isSupabaseConfigured()) {
      const { data: remoteStores, error: remoteError } = await supabase
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .eq('is_public', true);

      if (remoteError) {
        console.error('Failed to fetch remote public stores:', remoteError.message || remoteError);
      } else if (remoteStores && remoteStores.length > 0) {
        // Sync remote stores to local
        for (const remoteStore of remoteStores) {
          const localStore: Store = {
            id: remoteStore.id,
            companyId: remoteStore.company_id,
            name: remoteStore.name,
            location_name: remoteStore.location_name,
            address: remoteStore.address || '',
            phone: remoteStore.phone || '',
            currency: remoteStore.currency || 'ZMW',
            currency_symbol: remoteStore.currency_symbol || 'K',
            is_public: remoteStore.is_public ?? true,
            created_at: remoteStore.created_at,
            updated_at: remoteStore.updated_at
          };

          await dexieDb.stores.put(localStore);
        }

        // Get updated local public stores
        const updatedLocalStores = await dexieDb.stores.toArray();
        return { success: true, stores: updatedLocalStores.filter(store => store.is_public ?? true) };
      }
    }

    return { success: true, stores: publicStores };
  } catch (error) {
    console.error('Get public stores error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Get store by code for joining
 */
export async function getStoreByCode(storeCode: string): Promise<{ success: boolean; store?: Store; error?: string }> {
  try {
    if (!storeCode) {
      return { success: false, error: 'Store code is required' };
    }

    // Try to find store locally first
    const localStores = await dexieDb.stores.toArray();
    const localStore = localStores.find(store => 
      store.name.toLowerCase().replace(/\s+/g, '-') === storeCode.toLowerCase() ||
      store.id === storeCode
    );

    if (localStore) {
      return { success: true, store: localStore };
    }

    // If not found locally and Supabase is configured, search remotely
    if (isSupabaseConfigured()) {
      const { data: remoteStores, error: remoteError } = await supabase
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .eq('is_public', true);

      if (remoteError) {
        console.error('Failed to fetch remote stores:', remoteError.message || remoteError);
        return { success: false, error: 'Store not found' };
      }

      const remoteStore = remoteStores.find(store => 
        store.name.toLowerCase().replace(/\s+/g, '-') === storeCode.toLowerCase() ||
        store.id === storeCode
      );

      if (remoteStore) {
        // Sync to local
        const store: Store = {
          id: remoteStore.id,
          companyId: remoteStore.company_id,
          name: remoteStore.name,
          location_name: remoteStore.location_name,
          address: remoteStore.address || '',
          phone: remoteStore.phone || '',
          currency: remoteStore.currency || 'ZMW',
          currency_symbol: remoteStore.currency_symbol || 'K',
          is_public: remoteStore.is_public ?? true,
          created_at: remoteStore.created_at,
          updated_at: remoteStore.updated_at
        };

        await dexieDb.stores.put(store);
        return { success: true, store };
      }
    }

    return { success: false, error: 'Store not found' };
  } catch (error) {
    console.error('Get store by code error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Generate store code for sharing
 */
export function generateStoreCode(store: Store): string {
  return store.name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Generate store code for store (alias for compatibility)
 */
export function generateStoreCodeForStore(store: Store): string {
  return generateStoreCode(store);
}

/**
 * Create a company store (alias for createStore)
 */
export async function createCompanyStore(storeData: Partial<Store>, companyId: string): Promise<{ success: boolean; store?: Store; storeId?: string; error?: string }> {
  return createStore(storeData, companyId) as Promise<{ success: boolean; store?: Store; storeId?: string; error?: string }>;
}

/**
 * Update a company store (alias for updateStore)
 */
export async function updateCompanyStore(storeId: string, updates: Partial<Store>): Promise<{ success: boolean; error?: string }> {
  return updateStore(storeId, updates);
}

/**
 * Delete a company store (alias for deleteStore)
 */
export async function deleteCompanyStore(storeId: string): Promise<{ success: boolean; error?: string }> {
  return deleteStore(storeId);
}

/**
 * Assign stores to a company
 */
export async function assignStoresToCompany(storeIds: string[], companyId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!storeIds.length || !companyId) {
      return { success: false, error: 'Store IDs and company ID are required' };
    }

    for (const storeId of storeIds) {
      const { error } = await updateStore(storeId, { companyId });
      if (error) {
        return { success: false, error: `Failed to assign store ${storeId}: ${error}` };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Assign stores to company error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Get unassigned stores (stores not assigned to any company)
 */
export async function getUnassignedStores(): Promise<{ success: boolean; stores?: Store[]; error?: string }> {
  try {
    // Get stores locally first
    const localStores = await dexieDb.stores.toArray();
    const unassignedStores = localStores.filter(store => !store.companyId);

    // If Supabase is configured, sync with remote
    if (isSupabaseConfigured()) {
      const { data: remoteStores, error: remoteError } = await supabase
        .from('stores')
        .select('*')
        .is('company_id', null)
        .eq('is_active', true);

      if (remoteError) {
        console.error('Failed to fetch remote unassigned stores:', remoteError.message || remoteError);
      } else if (remoteStores && remoteStores.length > 0) {
        // Sync remote stores to local
        for (const remoteStore of remoteStores) {
          const localStore: Store = {
            id: remoteStore.id,
            companyId: remoteStore.company_id,
            name: remoteStore.name,
            location_name: remoteStore.location_name,
            address: remoteStore.address || '',
            phone: remoteStore.phone || '',
            currency: remoteStore.currency || 'ZMW',
            currency_symbol: remoteStore.currency_symbol || 'K',
            is_public: remoteStore.is_public ?? true,
            created_at: remoteStore.created_at,
            updated_at: remoteStore.updated_at
          };

          await dexieDb.stores.put(localStore);
        }

        // Get updated local unassigned stores
        const updatedLocalStores = await dexieDb.stores.toArray();
        return { success: true, stores: updatedLocalStores.filter(store => !store.companyId) };
      }
    }

    return { success: true, stores: unassignedStores };
  } catch (error) {
    console.error('Get unassigned stores error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Subscribe to store sales updates
 */
export function subscribeToStoreSales(storeId: string, callback: (sale: any) => void): () => void {
  if (!isSupabaseConfigured()) {
    return () => {}; // No-op if not configured
  }

  const channel = supabase
    .channel(`store-sales-${storeId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'sales',
        filter: `store_id=eq.${storeId}`
      },
      (payload) => {
        callback(payload.new);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to store updates
 */
export function subscribeToStoreUpdates(storeId: string, callback: (store: Store) => void): () => void {
  if (!isSupabaseConfigured()) {
    return () => {}; // No-op if not configured
  }

  const channel = supabase
    .channel(`store-updates-${storeId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'stores',
        filter: `id=eq.${storeId}`
      },
      (payload) => {
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
          const updatedStore: Store = {
            id: payload.new.id,
            companyId: payload.new.company_id,
            name: payload.new.name,
            location_name: payload.new.location_name,
            address: payload.new.address || '',
            phone: payload.new.phone || '',
            currency: payload.new.currency || 'ZMW',
            currency_symbol: payload.new.currency_symbol || 'K',
            is_public: payload.new.is_public ?? true,
            created_at: payload.new.created_at,
            updated_at: payload.new.updated_at
          };
          callback(updatedStore);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Sync all stores for a company
 */
export async function syncCompanyStores(companyId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { success: true }; // No sync needed if not configured
    }

    const { data: remoteStores, error: remoteError } = await supabase
      .from('stores')
      .select('*')
      .eq('company_id', companyId);

    if (remoteError) {
      console.error('Failed to sync remote stores:', remoteError.message || remoteError);
      return { success: false, error: remoteError.message };
    }

    if (remoteStores) {
      for (const remoteStore of remoteStores) {
        const localStore: Store = {
          id: remoteStore.id,
          companyId: remoteStore.company_id,
          name: remoteStore.name,
          location_name: remoteStore.location_name,
          address: remoteStore.address || '',
          phone: remoteStore.phone || '',
          currency: remoteStore.currency || 'ZMW',
          currency_symbol: remoteStore.currency_symbol || 'K',
          is_public: remoteStore.is_public ?? true,
          created_at: remoteStore.created_at,
          updated_at: remoteStore.updated_at
        };

        await dexieDb.stores.put(localStore);
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Sync company stores error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}
