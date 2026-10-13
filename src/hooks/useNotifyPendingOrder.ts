import { toast } from 'sonner';
import { useCallback } from 'react';
import { useNotification } from '@/contexts/NotificationContext';

export function useNotifyPendingOrder() {
  const { addNotification } = useNotification();

  const notifyPendingOrder = useCallback((order: any) => {
    try {
      const id = order.order_number || order.orderNumber || order.id;
      const message = `New order #${id}`;
      addNotification({ type: 'order', message, data: order });

      toast(message, {
        action: {
          label: 'View Orders',
          onClick: () => {
            // Navigate to POS and open pending orders panel using hash
            window.location.href = '/pos#pending-orders';
          },
        },
        duration: 8000,
      });
    } catch (e) {
      console.warn('notifyPendingOrder failed', e);
    }
  }, [addNotification]);

  return notifyPendingOrder;
}

export default useNotifyPendingOrder;
