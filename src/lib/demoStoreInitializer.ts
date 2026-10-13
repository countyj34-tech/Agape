/**
 * Demo Store Initialization
 * Handles showing the Mthunzi demo store on first run
 * The demo store is automatically hidden when user creates their own store
 */

import { dexieDb } from './db';
import { supabase, isSupabaseConfigured } from './supabase';
import type { SupabaseStore } from './supabase';

export const DEMO_STORE_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Initialize demo Mthunzi store on first app run
 * Called from App.tsx via DemoStoreBootstrap
 */
export async function initializeDemoStore(): Promise<boolean> {
  try {
    // Check if this is the first run (no stores exist in Dexie)
    const existingStores = await dexieDb.stores.toArray();
    if (existingStores.length > 0) {
      // Stores already exist, no need to initialize demo
      return false;
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // Create demo store locally
    const demoStore: SupabaseStore = {
      id: DEMO_STORE_ID,
      name: 'Mthunzi Demo Store',
      location_name: 'Demo Location',
      category: 'demo',
      address: '123 Main Street',
      phone: '+260123456789',
      currency: 'ZMW',
      currency_symbol: 'K',
      owner_id: undefined,
      created_at: nowIso,
      updated_at: nowIso,
    };

    await dexieDb.stores.put(demoStore);
    console.log('✓ Demo store initialized locally');

    // Try to sync to Supabase (non-blocking) — only if user is authenticated
    if (isSupabaseConfigured()) {
      try {
        const { data: userResponse } = await supabase.auth.getUser();
        if (userResponse?.user?.id) {
          // User is authenticated, safe to sync
          await supabase.from('stores').upsert(demoStore, { onConflict: 'id' });
          console.log('✓ Demo store synced to Supabase');
        } else {
          console.log('ℹ Demo store will work offline until you sign in');
        }
      } catch (error) {
        console.warn('Failed to sync demo store to Supabase (offline mode):', error);
        // Not a critical error - demo store will work locally
      }
    }
    return true;
  } catch (error) {
    console.error('Failed to initialize demo store:', error);
    return false;
  }
}

/**
 * Check if there are any user-created (non-demo) stores
 */
export async function hasUserStores(): Promise<boolean> {
  const stores = await dexieDb.stores.toArray();
  return stores.some((s) => s.id !== DEMO_STORE_ID);
}

/**
 * Remove demo store and its data
 * Call this after user successfully creates their own store
 */
export async function removeDemoStoreAndData(): Promise<void> {
  try {
    // Remove demo store
    await dexieDb.stores.delete(DEMO_STORE_ID);
    console.log('✓ Demo store removed locally');

    // Remove demo products and categories
    const demoProducts = await dexieDb.products
      .where('storeId')
      .equals(DEMO_STORE_ID)
      .toArray();

    const demoProductIds = demoProducts.map((p) => p.id);
    if (demoProductIds.length > 0) {
      await dexieDb.products.bulkDelete(demoProductIds);
      console.log(`✓ Removed ${demoProductIds.length} demo products`);
    }

    const demoCategories = await dexieDb.categories
      .where('storeId')
      .equals(DEMO_STORE_ID)
      .toArray();

    const demoCategoryIds = demoCategories.map((c) => c.id);
    if (demoCategoryIds.length > 0) {
      await dexieDb.categories.bulkDelete(demoCategoryIds);
      console.log(`✓ Removed ${demoCategoryIds.length} demo categories`);
    }

    // Also remove from Supabase if configured
    if (isSupabaseConfigured()) {
      try {
        // Delete demo products
        if (demoProductIds.length > 0) {
          await supabase.from('products').delete().in('id', demoProductIds);
        }

        // Delete demo categories
        if (demoCategoryIds.length > 0) {
          await supabase.from('categories').delete().in('id', demoCategoryIds);
        }

        // Delete demo store
        await supabase.from('stores').delete().eq('id', DEMO_STORE_ID);
        console.log('✓ Demo store and data removed from Supabase');
      } catch (error) {
        console.warn('Failed to remove demo data from Supabase:', error);
      }
    }
  } catch (error) {
    console.error('Failed to remove demo store and data:', error);
  }
}

/**
 * Remove all demo store data from local Dexie only.
 * Use this for permanently clearing seeded demo content without touching Supabase.
 */
export async function removeDemoStoreAndDataLocalOnly(): Promise<void> {
  try {
    const demoProducts = await dexieDb.products.where('storeId').equals(DEMO_STORE_ID).toArray();
    const demoProductIds = demoProducts.map((p) => p.id);
    if (demoProductIds.length > 0) {
      await dexieDb.products.bulkDelete(demoProductIds);
      console.log(`✓ Removed ${demoProductIds.length} demo products locally`);
    }

    const demoCategories = await dexieDb.categories.where('storeId').equals(DEMO_STORE_ID).toArray();
    const demoCategoryIds = demoCategories.map((c) => c.id);
    if (demoCategoryIds.length > 0) {
      await dexieDb.categories.bulkDelete(demoCategoryIds);
      console.log(`✓ Removed ${demoCategoryIds.length} demo categories locally`);
    }

    const removedStore = await dexieDb.stores.get(DEMO_STORE_ID);
    if (removedStore) {
      await dexieDb.stores.delete(DEMO_STORE_ID);
      console.log('✓ Removed demo store locally');
    }
  } catch (error) {
    console.error('Failed to remove demo store and data locally:', error);
  }
}

/**
 * Check if a store is the demo store
 */
export function isDemoStore(storeId: string): boolean {
  return storeId === DEMO_STORE_ID;
}
