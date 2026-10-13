import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { getDeviceStoreId, setDeviceStoreId, type SupabaseStore } from '@/lib/supabase';
import { toast } from 'sonner';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { canAccessStoreLimitedView } from '@/lib/permissions';
import { dexieDb, backfillLegacyStoreIds } from '@/lib/db';

interface StoreContextValue {
  currentStoreId: string;
  currentStore: SupabaseStore | null;
  /** True when the special Global View (all stores) is active. */
  isGlobalView: boolean;
  stores: SupabaseStore[];
  loading: boolean;
  error: string | null;
  setCurrentStoreId: (storeId: string) => void;
  refreshStores: () => Promise<void>;
}

export const StoreContext = createContext<StoreContextValue | undefined>(undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<SupabaseStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Restore currentStoreId from settings if available, otherwise use device storage
  const [currentStoreId, setCurrentStoreIdState] = useState<string>(() => {
    const deviceStoreId = getDeviceStoreId();
    const assignedStoreId = localStorage.getItem('mthunzi_assigned_store_id');
    return assignedStoreId || deviceStoreId;
  });
  const { settings } = useSupabaseAuth();

  useEffect(() => {
    if (settings?.assignedStoreId && canAccessStoreLimitedView(settings.userRole)) {
      setCurrentStoreIdState(settings.assignedStoreId);
      setDeviceStoreId(settings.assignedStoreId);
    }
  }, [settings?.assignedStoreId, settings?.userRole]);

  useEffect(() => {
    if (!currentStoreId || currentStoreId === '__all__') return;
    setDeviceStoreId(currentStoreId);
  }, [currentStoreId]);

  async function loadLocalStores(): Promise<SupabaseStore[]> {
    const localStores = await dexieDb.stores.toArray();
    const allowAutoSeed = localStorage.getItem('mthunzi_allow_auto_seed') !== 'false';

    if (localStores.length === 0 && allowAutoSeed) {
      const id = getDeviceStoreId();
      const nowIso = new Date().toISOString();
      const fallback: SupabaseStore = {
        id,
        name: settings?.shopName || 'Main Store',
        location_name: settings?.shopAddress || undefined,
        category: undefined,
        address: settings?.shopAddress || undefined,
        phone: settings?.shopPhone || undefined,
        currency: settings?.currency || 'ZMW',
        currency_symbol: settings?.currencySymbol || 'K',
        owner_id: undefined,
        created_at: nowIso,
        updated_at: nowIso,
      };
      await dexieDb.stores.put(fallback);
      return [fallback];
    }

    return localStores;
  }

  // Local Dexie only on boot — never block the POS waiting for Supabase.
  async function loadStoresFromLocalAndSupabase(_companyId?: string, _assignedStoreId?: string): Promise<SupabaseStore[]> {
    return loadLocalStores();
  }

  const loadStores = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Defer legacy backfill so store list appears instantly on boot.
      const runBackfill = () => void backfillLegacyStoreIds().catch(() => undefined);
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(runBackfill, { timeout: 15000 });
      } else {
        window.setTimeout(runBackfill, 3000);
      }

      // Load stores from local database and merge with Supabase
      let mergedStores = await loadStoresFromLocalAndSupabase(settings?.companyId || undefined, settings?.assignedStoreId || undefined);

      // Basic front-end scoping: if the user is a store-limited staff member and has an assignedStoreId,
      // only expose that store. Owners and managers see only stores belonging to their assigned company.
      if (settings?.assignedStoreId && canAccessStoreLimitedView(settings.userRole)) {
        mergedStores = mergedStores.filter((s) => s.id === settings.assignedStoreId);
      } else if (settings?.companyId) {
        const scoped = mergedStores.filter((s) => {
          return (s as any).companyId === settings.companyId || (s as any).company_id === settings.companyId;
        });
        // Offline-first: keep local stores if they lack company_id tags (common on terminals).
        if (scoped.length > 0) mergedStores = scoped;
      }

      // Hide the global demo store if the user has created their own actual stores
      const hasRealStore = mergedStores.some((s) => s.id !== '00000000-0000-0000-0000-000000000001');
      if (hasRealStore) {
        mergedStores = mergedStores.filter((s) => s.id !== '00000000-0000-0000-0000-000000000001');
      }

      setStores(mergedStores);

      // If currentStoreId is not present in the loaded list, default to the first store
      const hasCurrent = mergedStores.some((s) => s.id === currentStoreId);
      if (!hasCurrent && mergedStores.length > 0) {
        const firstId = mergedStores[0].id;
        setCurrentStoreIdState(firstId);
        setDeviceStoreId(firstId);
      }

      // Cloud product sync is manual/admin-only. Never auto-run on POS boot.
    } catch (e) {
      console.error('Failed to load stores:', e);
      try {
        const localStores = await loadLocalStores();
        setStores(localStores);
        setError(null);
      } catch (fallbackError) {
        console.error('Failed to load fallback local stores:', fallbackError);
        setError('Unable to load stores');
      }
    } finally {
      setLoading(false);
    }
  }, [settings?.userRole, settings?.assignedStoreId, settings?.shopName, settings?.shopAddress, settings?.shopPhone, settings?.currency, settings?.currencySymbol]);

  useEffect(() => {
    void loadStores();
  }, [loadStores]);

  // Supabase realtime disabled on POS terminals — keeps Add/Checkout/Pay offline-fast.
  // Online-order alerts belong on Sales/Admin, not competing with the cashier.

  const setCurrentStoreId = useCallback(
    (storeId: string) => {
      // If this user is a store-limited staff member, prevent switching away.
      if (settings?.assignedStoreId && canAccessStoreLimitedView(settings.userRole) && storeId !== settings.assignedStoreId) {
        toast.error('You are assigned to a single store and cannot switch.', { duration: 2000 });
        return;
      }

      setCurrentStoreIdState(storeId);
      setDeviceStoreId(storeId);
      toast.success('Switched store', { duration: 1500 });
      // Product sync is manual/admin-only — never on store switch during POS use.
    },
    [settings?.userRole, settings?.assignedStoreId]
  );

  const currentStore = useMemo(
    () => stores.find((s) => s.id === currentStoreId) ?? null,
    [stores, currentStoreId]
  );

  const value: StoreContextValue = {
    currentStoreId,
    currentStore,
    isGlobalView: currentStoreId === '__all__',
    stores,
    loading,
    error,
    setCurrentStoreId,
    refreshStores: loadStores,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return ctx;
}
