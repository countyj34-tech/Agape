import React, { useEffect, useState } from 'react';
import { useStoreClient } from '@/hooks/useStoreClient';

export default function ManagerDashboard() {
  const { from } = useStoreClient();
  const [totalSales, setTotalSales] = useState(0);

  useEffect(() => {
    let active = true;

    from('sales')
      .select('amount')
      .then(({ data }) => {
        if (!active) return;
        const total = data?.reduce((sum, sale: any) => sum + (sale.amount || 0), 0) ?? 0;
        setTotalSales(total);
      })
      .catch(() => {
        if (active) setTotalSales(0);
      });

    return () => {
      active = false;
    };
  }, [from]);

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold">Manager Dashboard</h2>
      <div className="mt-2">Total Sales: {totalSales}</div>
    </div>
  );
}
