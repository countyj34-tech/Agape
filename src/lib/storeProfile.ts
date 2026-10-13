import { dexieDb } from '@/lib/db';
import { DEMO_STORE_ID } from '@/lib/demoStoreInitializer';

const STORE_ID_KEYS = ['mthunzi_store_id', 'mthunzi_assigned_store_id'] as const;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export async function hasPersistedStoreProfile(): Promise<boolean> {
  if (!isBrowser()) {
    return false;
  }

  try {
    for (const key of STORE_ID_KEYS) {
      const storeId = localStorage.getItem(key);
      if (!storeId || storeId === DEMO_STORE_ID) continue;

      const localStore = await dexieDb.stores.get(storeId);
      if (localStore && localStore.id !== DEMO_STORE_ID) {
        return true;
      }
    }

    const stores = await dexieDb.stores.toArray();
    return stores.some((store) => store.id !== DEMO_STORE_ID);
  } catch (error) {
    console.warn('Failed to detect persisted store profile:', error);
    return false;
  }
}
