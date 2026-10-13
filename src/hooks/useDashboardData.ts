import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';

export function useDashboardData() {
  const { currentStoreId } = useStore();
  const [sales, setSales] = useState<any[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!currentStoreId) return;
    const channel = supabase
      .channel('dashboard-sales')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `store_id=eq.${currentStoreId}` }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setSales((prev) => [payload.new, ...prev]);
          setTotal((prev) => prev + (payload.new.amount || 0));
          toast.success('New sale received!');
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentStoreId]);

  return { sales, total };
}
