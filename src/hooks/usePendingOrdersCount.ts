import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '@/contexts/StoreContext';
import { dexieDb } from '@/lib/db';
import { isPendingOnlineOrderStatus } from '@/lib/onlineOrders';

export function usePendingOrdersCount(enabled = true) {
  const { currentStore } = useStore();

  const count = useLiveQuery(
    async () => {
      if (!enabled || !currentStore) return 0;
      const rows = await dexieDb.onlineOrders.where('storeId').equals(currentStore.id).toArray();
      return rows.filter((order) => isPendingOnlineOrderStatus(order.status)).length;
    },
    [currentStore?.id, enabled]
  );

  return { count: count ?? 0 };
}
