import { useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useParams } from 'react-router-dom';

function getStoreId() {
  const params = new URLSearchParams(window.location.search);
  const urlStoreId = params.get('storeID');
  return urlStoreId || localStorage.getItem('mthunzi_store_id') || '';
}

export function useStoreClient() {
  const { storeID } = useParams();
  const currentStoreId = storeID || getStoreId();

  // Proxy to auto-attach .eq('store_id', currentStoreId) to all queries
  const client = useMemo(() => {
    function wrapQuery() {
      return (table) => {
        const query = supabase.from(table);
        return {
          select: (...args) => query.select(...args).eq('store_id', currentStoreId),
          insert: (values, opts) => query.insert(values, opts).eq('store_id', currentStoreId),
          update: (values, opts) => query.update(values, opts).eq('store_id', currentStoreId),
          delete: (opts) => query.delete(opts).eq('store_id', currentStoreId),
        };
      };
    }
    return { from: wrapQuery() };
  }, [currentStoreId]);

  return client;
}
