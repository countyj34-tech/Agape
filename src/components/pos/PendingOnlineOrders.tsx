import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '@/contexts/StoreContext';
import {
  getPendingOnlineOrders,
  refreshPendingOnlineOrdersFromCloud,
  subscribeToPendingOrders,
  updateOnlineOrderStatus,
  isPendingOnlineOrderStatus,
  syncProductStockViaPipeline,
  deductStockInSupabase,
} from '@/lib/onlineOrders';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { completeSaleAtomic, dexieDb } from '@/lib/db';
import { createSaleWithSync } from '@/lib/sync';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import type { OnlineOrder } from '@/types/pos';
import { generateReceiptNumber } from '@/types/pos';
import {
  Clock,
  Check,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Phone,
  User,
  Package,
  Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNotification } from '@/contexts/NotificationContext';
import { openWhatsAppLink, generateOrderSummary, buildWhatsAppLink, notifyViaWhatsApp } from '@/lib/whatsappIntegration';

interface PendingOnlineOrdersProps {
  onOrderCount?: (count: number) => void;
}

function linePrice(item: OnlineOrder['items'][number]): number {
  return Number((item as any).priceAtOrder ?? (item as any).unitPrice ?? 0) || 0;
}

export function PendingOnlineOrders({ onOrderCount }: PendingOnlineOrdersProps) {
  const { addNotification } = useNotification();
  const { currentStore } = useStore();
  const { settings } = useSupabaseAuth();
  const { currencySymbol } = useCurrencyFormatter();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);

  const loadPendingOrders = useCallback(async (fromCloud = false) => {
    if (!currentStore) return;

    setLoading(true);
    try {
      const pendingOrders = fromCloud
        ? await refreshPendingOnlineOrdersFromCloud(currentStore.id)
        : await getPendingOnlineOrders(currentStore.id);
      setOrders(pendingOrders);
      onOrderCount?.(pendingOrders.length);
    } catch (error) {
      console.error('Error loading pending orders:', error);
      toast.error('Failed to load pending orders');
    } finally {
      setLoading(false);
    }
  }, [currentStore, onOrderCount]);

  useEffect(() => {
    void loadPendingOrders(true);
    // Poll live Supabase regularly so remote WhatsApp orders appear on this POS.
    const interval = window.setInterval(() => void loadPendingOrders(true), 15000);
    return () => window.clearInterval(interval);
  }, [loadPendingOrders]);

  useEffect(() => {
    if (!currentStore) return;

    const unsubscribe = subscribeToPendingOrders(
      currentStore.id,
      (newOrder) => {
        setOrders((prev) => {
          if (prev.some((o) => o.id === newOrder.id)) return prev;
          return [newOrder, ...prev];
        });
        onOrderCount?.(orders.length + 1);
        addNotification({
          type: 'order',
          message: `New order #${newOrder.orderNumber} from ${newOrder.customerName}!`,
          data: newOrder,
        });
        toast.success(`New order #${newOrder.orderNumber} from ${newOrder.customerName}!`, {
          duration: 8000,
        });
        try {
          const audio = new Audio('/sounds/order-alert.mp3');
          audio.play().catch(() => undefined);
        } catch {
          /* ignore */
        }
      },
      (updatedOrder) => {
        if (!isPendingOnlineOrderStatus(updatedOrder.status)) {
          setOrders((prev) => prev.filter((o) => o.id !== updatedOrder.id));
          return;
        }
        setOrders((prev) =>
          prev.map((order) => (order.id === updatedOrder.id ? updatedOrder : order))
        );
      }
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [currentStore, onOrderCount, addNotification, orders.length]);

  const sendReceiptToCustomer = async (order: OnlineOrder) => {
    const itemsText = order.items
      .map((item) => {
        const unit = linePrice(item);
        return `${item.productName} × ${item.quantity} = ${currencySymbol}${(unit * item.quantity).toFixed(2)}`;
      })
      .join('\n');

    const receiptMessage =
      `*Order Receipt - ${order.orderNumber}*\n\n` +
      `Customer: ${order.customerName}\n` +
      `Phone: ${order.customerPhone}\n` +
      `Date: ${new Date(order.createdAt).toLocaleString()}\n\n` +
      `*Items:*\n${itemsText}\n\n` +
      `Subtotal: ${currencySymbol}${Number(order.subtotal).toFixed(2)}\n` +
      `${order.discount > 0 ? `Discount: -${currencySymbol}${Number(order.discount).toFixed(2)}\n` : ''}` +
      `${order.deliveryFee > 0 ? `Delivery: ${currencySymbol}${Number(order.deliveryFee).toFixed(2)}\n` : ''}` +
      `*Total: ${currencySymbol}${Number(order.total).toFixed(2)}*\n\n` +
      `Payment confirmed — thank you!\n` +
      `${
        order.deliveryType === 'delivery'
          ? 'Your order will be delivered to the provided address.'
          : 'Please collect your order from the store.'
      }`;

    if (order.customerPhone) {
      await notifyViaWhatsApp(order.customerPhone, receiptMessage);
    }
  };

  /** Confirm payment: create sale + deduct stock (local + Supabase) + receipt + WhatsApp */
  const completeOrderSale = async (order: OnlineOrder) => {
    if (!currentStore || !settings) {
      throw new Error('Store or settings not ready');
    }

    const saleItems = order.items
      .filter((i) => i.productId && i.quantity > 0)
      .map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: linePrice(i),
      }));

    if (saleItems.length === 0) {
      throw new Error('Order has no valid items');
    }

    const sale = await completeSaleAtomic({
      items: saleItems,
      discount: order.discount || 0,
      paymentMethod: 'mobile',
      amountReceived: order.total,
      amountPaid: order.total,
      customerName: order.customerName,
      mobileProvider: order.mobileProvider,
      mobileReference: order.paymentTransactionId || order.orderNumber,
      receiptNumber: generateReceiptNumber(),
    });

    await createSaleWithSync(sale);

    // Push stock to real Supabase (pipeline service-role + direct fallback)
    try {
      const stockUpdates = (sale.items || []).map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }));
      const cloudStockOk = await deductStockInSupabase(stockUpdates);
      if (!cloudStockOk) {
        // Still try absolute stock levels via pipeline
        const absolute = [];
        for (const item of sale.items || []) {
          const product = await dexieDb.products.get(item.productId);
          if (product) absolute.push({ productId: item.productId, stock: product.stock });
        }
        if (absolute.length) await syncProductStockViaPipeline(absolute);
      }
    } catch (e) {
      console.warn('Cloud stock sync failed (sale still recorded locally):', e);
    }

    const staffId = settings.assignedStoreId || settings.id;
    await updateOnlineOrderStatus(order.id, 'COMPLETED', staffId, {
      paymentStatus: 'PAID',
      completedSaleId: sale.id,
    });

    return sale;
  };

  const handleVerifyAndComplete = async () => {
    if (!selectedOrder) return;

    setIsVerifying(true);
    try {
      const sale = await completeOrderSale(selectedOrder);

      setOrders((prev) => prev.filter((o) => o.id !== selectedOrder.id));
      onOrderCount?.(Math.max(0, orders.length - 1));
      setShowVerifyDialog(false);

      toast.success(`Order #${selectedOrder.orderNumber} confirmed — stock updated & receipt recorded`);

      try {
        await sendReceiptToCustomer(selectedOrder);
      } catch (e) {
        console.warn('WhatsApp receipt open failed:', e);
      }

      navigate(`/receipt/${sale.id}`, { state: { sale } });
      setSelectedOrder(null);
    } catch (error) {
      console.error('Error completing order:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to complete order');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleContactCustomer = (order: OnlineOrder) => {
    const summary = generateOrderSummary(
      order.orderNumber,
      order.customerName,
      order.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        priceAtOrder: linePrice(i),
      })),
      order.total,
      currencySymbol
    );
    const message = `Hi ${order.customerName}, regarding your order #${order.orderNumber}\n\n${summary}`;
    if (order.customerPhone) {
      openWhatsAppLink(buildWhatsAppLink(order.customerPhone, message));
    }
  };

  const handleApprovePayment = async (order: OnlineOrder) => {
    setSelectedOrder(order);
    setIsVerifying(true);
    try {
      const sale = await completeOrderSale(order);
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      toast.success(`Payment approved for #${order.orderNumber}`);
      await sendReceiptToCustomer(order);
      navigate(`/receipt/${sale.id}`, { state: { sale } });
    } catch (error) {
      console.error('Error approving payment:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to approve payment');
    } finally {
      setIsVerifying(false);
      setSelectedOrder(null);
    }
  };

  const handleRejectPayment = async (order: OnlineOrder) => {
    if (!settings) return;

    try {
      const success = await updateOnlineOrderStatus(order.id, 'PENDING', settings.assignedStoreId || settings.id, {
        paymentStatus: 'UNPAID',
      });

      if (success) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? { ...o, status: 'PENDING', needsPaymentApproval: false, paymentStatus: 'UNPAID' }
              : o
          )
        );
        toast.success(`Payment rejected for order #${order.orderNumber}.`);
      } else {
        toast.error('Failed to reject payment');
      }
    } catch (error) {
      console.error('Error rejecting payment:', error);
      toast.error('An error occurred while rejecting the payment');
    }
  };

  if (loading && orders.length === 0) {
    return (
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="pt-6 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking online orders…
        </CardContent>
      </Card>
    );
  }

  if (orders.length === 0) {
    return (
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="pt-6">
          <div className="text-center py-6">
            <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No pending online orders</p>
            <p className="text-sm text-gray-500 mt-1">Orders placed by customers will appear here</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id} className="border-l-4 border-l-amber-500 hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-semibold">{order.orderNumber}</CardTitle>
                    <Badge
                      variant="outline"
                      className={`${
                        order.needsPaymentApproval
                          ? 'bg-orange-50 text-orange-800 border-orange-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {order.needsPaymentApproval ? (
                        <>
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Needs Approval
                        </>
                      ) : (
                        <>
                          <Clock className="h-3 w-3 mr-1" />
                          Pending
                        </>
                      )}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    <User className="inline h-4 w-4 mr-1" />
                    {order.customerName}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-xl font-bold text-amber-600">
                    {currencySymbol}
                    {Number(order.total).toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(order.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {order.deliveryType === 'delivery' && (
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-start gap-2">
                    <Truck className="h-4 w-4 text-blue-600 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-blue-900">Delivery Order</p>
                      <p className="text-xs text-blue-700">{order.deliveryAddress}</p>
                      {order.deliveryFee > 0 && (
                        <p className="text-xs text-blue-700 mt-1">
                          Delivery Fee: {currencySymbol}
                          {Number(order.deliveryFee).toFixed(2)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                {order.items.slice(0, 3).map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span className="text-gray-700">
                      {item.productName} × {item.quantity}
                    </span>
                    <span className="font-medium">
                      {currencySymbol}
                      {(linePrice(item) * item.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
                {order.items.length > 3 && (
                  <p className="text-xs text-gray-500 py-1">+{order.items.length - 3} more items</p>
                )}
              </div>

              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600 flex-1">{order.customerPhone}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleContactCustomer(order)}
                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                >
                  Message
                </Button>
              </div>

              <Badge variant="secondary" className="text-xs w-fit">
                {order.source === 'ONLINE'
                  ? 'Online Store'
                  : order.source === 'WHATSAPP_LINK'
                    ? 'WhatsApp'
                    : 'In-Store'}
              </Badge>

              <div className="flex gap-2">
                {order.needsPaymentApproval ? (
                  <>
                    <Button
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleApprovePayment(order)}
                      disabled={isVerifying}
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Approve Payment
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
                      onClick={() => handleRejectPayment(order)}
                      disabled={isVerifying}
                    >
                      <AlertTriangle className="h-4 w-4 mr-2" />
                      Reject
                    </Button>
                  </>
                ) : (
                  <Button
                    className="w-full bg-white text-blue-600 border border-blue-600 hover:bg-blue-50"
                    onClick={() => {
                      setSelectedOrder(order);
                      setShowVerifyDialog(true);
                    }}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Confirm Payment
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showVerifyDialog} onOpenChange={setShowVerifyDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Confirm Payment</DialogTitle>
            <DialogDescription>
              Confirm payment received. This will deduct stock from Supabase, record a sale receipt, and open WhatsApp for the customer.
            </DialogDescription>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-600 uppercase font-semibold">Order Number</p>
                    <p className="text-2xl font-bold text-blue-600 mt-1">{selectedOrder.orderNumber}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 uppercase font-semibold">Total Amount</p>
                    <p className="text-2xl font-bold text-blue-600 mt-1">
                      {currencySymbol}
                      {Number(selectedOrder.total).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-3">
                <p className="text-xs text-gray-600 uppercase font-semibold mb-2">Customer</p>
                <p className="font-semibold">{selectedOrder.customerName}</p>
                <p className="text-sm text-gray-600">{selectedOrder.customerPhone}</p>
              </div>

              <div className="border rounded-lg p-3">
                <p className="text-xs text-gray-600 uppercase font-semibold mb-3">Order Items</p>
                <div className="space-y-2">
                  {selectedOrder.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-sm pb-2 border-b last:border-0">
                      <div>
                        <p className="font-medium">{item.productName}</p>
                        <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          {currencySymbol}
                          {linePrice(item).toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {currencySymbol}
                          {(linePrice(item) * item.quantity).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-900">Stock + receipt will update now</p>
                  <p className="text-xs text-amber-800 mt-1">
                    Completing this order deducts inventory locally and in Supabase, and saves a receipt under Sales.
                  </p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowVerifyDialog(false)} disabled={isVerifying}>
              Cancel
            </Button>
            <Button
              onClick={handleVerifyAndComplete}
              disabled={isVerifying}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Complete Order
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
