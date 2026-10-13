import { supabase } from './supabase';
import { useStore } from '@/contexts/StoreContext';

export function useStoreSupabaseClient() {
  const { currentStoreId } = useStore();

  function from(table: string) {
    return supabase.from(table).eq('store_id', currentStoreId || '__invalid__');
  }

  // Optionally, wrap other methods as needed
  return { from };
}
