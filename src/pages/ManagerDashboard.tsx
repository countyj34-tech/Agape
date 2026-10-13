import React, { useEffect, useState } from 'react';
import { useStoreClient } from '@/hooks/useStoreClient';

  const { from } = useStoreClient();
  const [totalSales, setTotalSales] = useState(0);

  useEffect(() => {
    // Initial fetch
    from('sales').select('amount').then(({ data }) => {
      setTotalSales(data?.reduce((sum, sale) => sum + (sale.amount || 0), 0));
    });

    // Realtime subscription (pseudo, see note below)
    // Replace with actual supabase channel subscription if needed
    // This is a placeholder for the pattern
    // If you have a custom subscribe method, use it here
    // Otherwise, use the supabase channel as before, but filter by store_id

    // Example (if you have a subscribe method):
    // const channel = from('sales').select('*').subscribe?.((payload) => {
    //   if (payload.eventType === 'INSERT') {
    //     setTotalSales((prev) => prev + (payload.new.amount || 0));
    //   }
    // });

    // Cleanup (if using a channel):
    // return () => { if (channel && channel.unsubscribe) channel.unsubscribe(); };
  }, [from]);

  return (
    <div>
      <h2>Manager Dashboard</h2>
      <div>Total Sales: {totalSales}</div>
    </div>
  );
}
