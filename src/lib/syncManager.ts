import { supabase, isSupabaseConfigured } from './supabase';
import { dexieDb } from './db';

// Save a sale locally, try to sync to Supabase, and queue for retry if needed
export async function saveSale(sale: any) {
  // Save locally first
  const localId = await dexieDb.sales.add({ ...sale, is_synced: false });

  // If Supabase not configured, skip remote attempt
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, queued sale locally', localId);
    return localId;
  }

  // Try to sync to Supabase immediately
  try {
    const { error } = await supabase.from('sales').insert([{ ...sale, id: localId }]);
    if (!error) {
      await dexieDb.sales.update(localId, { is_synced: true, lastSyncedAt: new Date() });
    } else {
      console.error('Failed to sync sale to Supabase:', error);
      addToSyncQueue(localId);
    }
  } catch (err) {
    console.error('Error syncing sale to Supabase:', err);
    addToSyncQueue(localId);
  }

  return localId;
}

function addToSyncQueue(localId: number) {
  // For now, leave is_synced: false and let syncSales() handle retry logic
  // Optionally implement a dedicated queue table in IndexedDB in future
}

export async function syncSales() {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, skipping syncSales');
    return;
  }

  const unsyncedSales = await dexieDb.sales.where({ is_synced: false }).toArray();
  for (const sale of unsyncedSales) {
    try {
      const { error } = await supabase.from('sales').insert([sale]);
      if (!error) {
        await dexieDb.sales.update(sale.id, { is_synced: true, lastSyncedAt: new Date() });
      } else {
        console.error('Failed to sync sale to Supabase:', error);
      }
    } catch (err) {
      console.error('Error syncing sale to Supabase:', err);
    }
  }
}

export function startSyncManager() {
  window.addEventListener('online', syncSales);
  setInterval(syncSales, 10000); // Try every 10s
}
