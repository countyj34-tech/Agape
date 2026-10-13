import { supabase, isSupabaseConfigured } from './supabase';
import { dexieDb } from './db';

export async function syncUnsyncedSales() {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, skipping syncUnsyncedSales');
    return;
  }

  const unsynced = await dexieDb.sales.where({ is_synced: false }).toArray();
  for (const sale of unsynced) {
    try {
      const { error } = await supabase.from('sales').insert([sale]);
      if (!error) {
        await dexieDb.sales.update(sale.id, { is_synced: true });
      } else {
        console.error('Failed to sync sale to Supabase:', error);
      }
    } catch (err) {
      console.error('Network/server error while syncing sale:', err);
      // Network/server error, will retry
    }
  }
}

export function startSyncService() {
  async function trySync() {
    await syncUnsyncedSales();
    setTimeout(trySync, 30000); // Retry every 30s
  }
  trySync();
  window.addEventListener('online', syncUnsyncedSales);
}
