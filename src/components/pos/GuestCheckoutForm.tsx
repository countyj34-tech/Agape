import React, { useState, useMemo, useEffect } from 'react';
import { deliveryCarriers, getDeliveryFee, ZAMBIA_PROVINCES, provinceLabel } from '@/lib/deliveryFee';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { useCart } from '@/contexts/CartContext';
import { useStore } from '@/contexts/StoreContext';
import { type SupabaseStore } from '@/lib/supabase';
import { RollingNumber } from '@/components/ui/rolling-number';
import { createOnlineOrder } from '@/lib/onlineOrders';
import { generateWhatsAppOrderLink, isValidPhoneNumber, openWhatsAppLink, copyToClipboard, formatPhoneToE164, generateOrderSummary, buildWhatsAppLink } from '@/lib/whatsappIntegration';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { processPayment } from '@/lib/paymentGateway';
import { PhoneIcon, User, MessageCircle, ArrowLeft, Loader2, Truck, MapPin, CreditCard, Smartphone, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface GuestCheckoutFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOrderCreated?: (orderId: string) => void;
  store?: SupabaseStore | null;
  storeId?: string | null;
}

export function GuestCheckoutForm({ open, onOpenChange, onOrderCreated, store, storeId }: GuestCheckoutFormProps) {
  const { state: cartState, clearCart } = useCart();
  const { loading: storeLoading, refreshStores } = useStore();
  const { settings } = useSupabaseAuth();
  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState(0);
  
  // Delivery options
  const [deliveryType, setDeliveryType] = useState<'collect' | 'delivery'>('collect');
  const [deliveryFee, setDeliveryFee] = useState('0');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [selectedCarrier, setSelectedCarrier] = useState('Yango');
  const [selectedProvince, setSelectedProvince] = useState('Lusaka');
  const [shopOwnerDelivery, setShopOwnerDelivery] = useState(false);
  const [paymentCategory, setPaymentCategory] = useState<'mobile' | 'card' | 'bank' | ''>('mobile');
  const [mobileProvider, setMobileProvider] = useState<'mtn' | 'airtel' | 'zamtel' | 'zedmobile' | ''>('');
  const [mobileMoneyPhone, setMobileMoneyPhone] = useState('');
  const [mobileReference, setMobileReference] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  const configuredPaymentNumber = useMemo(() => {
    const activeStore = store;
    if (!activeStore) return '';
    if (mobileProvider && activeStore.payment_numbers?.[mobileProvider]) {
      return activeStore.payment_numbers[mobileProvider];
    }
    if (activeStore.phone) return activeStore.phone;
    return settings?.shopPhone ?? '';
  }, [store, mobileProvider, settings?.shopPhone]);

  const computedDeliveryFee = useMemo(() => {
    if (deliveryType !== 'delivery') return 0;
    return getDeliveryFee(
      shopOwnerDelivery ? 'ShopOwner' : selectedCarrier,
      selectedProvince,
      shopOwnerDelivery,
      store?.location_name || 'Lusaka',
      deliveryAddress.split(',')[0]?.trim() || selectedProvince
    );
  }, [
    deliveryType,
    selectedCarrier,
    selectedProvince,
    shopOwnerDelivery,
    store?.location_name,
    deliveryAddress,
  ]);

  useEffect(() => {
    setDeliveryFee(String(computedDeliveryFee));
  }, [computedDeliveryFee]);

  const totalWithDelivery = cartState.total + (deliveryType === 'delivery' ? computedDeliveryFee : 0);

  const errors = useMemo(() => {
    const errs: Record<string, string> = {};

    if (customerName.trim() === '') {
      errs.name = 'Name is required';
    }

    const phoneProvided =
      customerPhone.trim() !== '' ||
      (paymentCategory === 'mobile' && mobileMoneyPhone.trim() !== '');
    if (!phoneProvided) {
      errs.phone = 'Phone number is required';
    } else {
      const phoneToValidate = customerPhone.trim() || mobileMoneyPhone.trim();
      if (!isValidPhoneNumber(phoneToValidate)) {
        errs.phone = 'Please enter a valid phone number';
      }
    }

    if (cartState.items.length === 0) {
      errs.cart = 'Cart is empty';
    }

    if (deliveryType === 'delivery') {
      if (!deliveryAddress.trim()) errs.deliveryAddress = 'Delivery address is required';
      if (!selectedProvince) errs.province = 'Select a province';
      if (!shopOwnerDelivery && !selectedCarrier) errs.carrier = 'Select a carrier';
    }

    if (!paymentCategory) {
      errs.paymentCategory = 'Select a payment method';
    }
    if (paymentCategory === 'mobile' && !mobileProvider) {
      errs.mobileProvider = 'Select a mobile provider';
    }
    if (paymentCategory === 'card' && customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) {
      errs.email = 'Enter a valid email for card receipts';
    }
    return errs;
  }, [
    customerName,
    customerPhone,
    cartState.items.length,
    deliveryType,
    deliveryAddress,
    selectedProvince,
    selectedCarrier,
    shopOwnerDelivery,
    paymentCategory,
    mobileProvider,
    mobileMoneyPhone,
    customerEmail,
  ]);

  const isValid = Object.keys(errors).length === 0;



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValid) {
      const firstError = Object.values(errors)[0] || 'Please fill in all fields';
      toast.error(firstError);
      return;
    }

    const orderStoreId = store?.id || storeId;
    if (!orderStoreId) {
      console.error('GuestCheckoutForm: store information is not available');
      toast.error('Shop information not loaded. Please retry.');
      return;
    }

    setIsSubmitting(true);

    // Snapshot cart before clearing — WhatsApp message needs line items
    const cartSnapshot = {
      items: cartState.items.map((item) => ({
        productName: item.product.name,
        quantity: item.quantity,
        priceAtOrder: Number(item.product.sellingPrice) || 0,
      })),
      subtotal: cartState.subtotal,
      discount: cartState.discount,
      total: totalWithDelivery,
    };

    try {
      const order = await createOnlineOrder(
        orderStoreId,
        customerName,
        customerPhone.trim() || mobileMoneyPhone.trim(),
        cartState.items,
        cartState.subtotal,
        cartState.discount,
        'ONLINE',
        deliveryType,
        parseFloat(deliveryFee || '0'),
        deliveryType === 'delivery' ? `${deliveryAddress} (${provinceLabel(selectedProvince)})` : undefined,
        (paymentCategory === 'card' ? 'bank' : paymentCategory || 'mobile') as 'mobile' | 'bank',
        (mobileProvider || undefined) as 'mtn' | 'airtel' | 'zamtel' | 'zedmobile' | undefined,
        paymentCategory === 'card' ? 'Pesapal Card' : paymentCategory === 'bank' ? 'Bank Transfer' : '',
        mobileReference || undefined,
        true
      );

      if (!order) {
        toast.error('Failed to create order in the cloud. Please try again.');
        setIsSubmitting(false);
        return;
      }

      const phoneToUse = mobileMoneyPhone.trim() || customerPhone;

      // Card → real Pesapal redirect (direct checkout)
      if (paymentCategory === 'card') {
        try {
          const paymentResult = await processPayment({
            orderId: order.id,
            orderNumber: order.orderNumber,
            amount: parseFloat(totalWithDelivery.toString()),
            currency: 'ZMW',
            customerName,
            customerPhone: phoneToUse,
            gateway: 'pesapal',
            metadata: {
              email: customerEmail.trim() || undefined,
              callbackUrl: `${window.location.origin}${window.location.pathname}?paid=1&order=${order.id}`,
            },
          });

          try {
            localStorage.setItem('last_online_order_id', order.id);
            localStorage.setItem('last_online_order_phone', order.customerPhone || customerPhone);
            localStorage.setItem('last_online_order_snapshot', JSON.stringify(cartSnapshot));
          } catch {
            /* ignore */
          }

          if (paymentResult.success && paymentResult.redirectUrl) {
            toast.success('Opening secure card checkout…');
            clearCart();
            window.location.href = paymentResult.redirectUrl;
            return;
          }

          toast.message(
            paymentResult.message ||
              'Card gateway not configured yet. Order is on the shop POS — pay and staff will confirm.',
            { duration: 6000 }
          );
        } catch (err) {
          console.warn('Card checkout skipped:', err);
          toast.message('Order saved. Pay at the shop or try card again once Pesapal keys are set.');
        }
      }

      // Mobile money — request-to-pay when APIs exist; otherwise manual confirm on POS
      if (paymentCategory === 'mobile' && mobileProvider) {
        try {
          const paymentResult = await processPayment({
            orderId: order.id,
            orderNumber: order.orderNumber,
            amount: parseFloat(totalWithDelivery.toString()),
            currency: 'ZMW',
            customerName,
            customerPhone: phoneToUse,
            gateway: mobileProvider as any,
            metadata: {
              targetNumber: configuredPaymentNumber,
              mobileReference,
            },
          });
          if (paymentResult.success && paymentResult.redirectUrl) {
            try {
              localStorage.setItem('last_online_order_id', order.id);
              localStorage.setItem('last_online_order_phone', order.customerPhone || customerPhone);
            } catch {
              /* ignore */
            }
            toast.info('Opening mobile money checkout… Order is waiting on the shop POS.', {
              duration: 4000,
            });
            clearCart();
            setTimeout(() => {
              window.location.href = paymentResult.redirectUrl!;
            }, 1000);
            return;
          }
          if (paymentResult.manualConfirm) {
            toast.message(paymentResult.message || 'Pay the shop number; staff will confirm on POS.', {
              duration: 5000,
            });
          }
        } catch (err) {
          console.warn('Mobile money initiation skipped:', err);
        }
      }

      try {
        localStorage.setItem('last_online_order_id', order.id);
        localStorage.setItem('last_online_order_phone', order.customerPhone || customerPhone);
        localStorage.setItem('last_online_order_snapshot', JSON.stringify(cartSnapshot));
      } catch {
        /* ignore */
      }

      setOrderId(order.id);
      setOrderNumber(order.orderNumber);
      setConfirmedTotal(cartSnapshot.total);
      setShowConfirmation(true);
      clearCart();
      onOrderCreated?.(order.id);
      toast.success(
        paymentCategory === 'bank'
          ? 'Order placed. Complete bank transfer, then shop will confirm on POS.'
          : 'Order sent to the shop. Confirm on WhatsApp, then await payment confirmation.'
      );

      const shopPhone = store?.phone || configuredPaymentNumber || settings?.shopPhone || '';
      if (shopPhone && isValidPhoneNumber(shopPhone)) {
        try {
          localStorage.setItem('shop_phone', shopPhone);
        } catch {
          /* ignore */
        }
        const summary = generateOrderSummary(
          order.orderNumber,
          customerName,
          cartSnapshot.items,
          cartSnapshot.total,
          currencySymbol
        );
        const richLink = buildWhatsAppLink(
          shopPhone,
          `Hi! I've placed an order.\n\n${summary}\n\nPhone: ${customerPhone || phoneToUse}\nPayment: ${
            paymentCategory === 'card' ? 'Card' : paymentCategory === 'bank' ? 'Bank transfer' : mobileProvider?.toUpperCase() || 'Mobile'
          }\nDelivery: ${
            deliveryType === 'delivery'
              ? `${deliveryAddress} (${provinceLabel(selectedProvince)})`
              : 'Collect in store'
          }`
        );
        openWhatsAppLink(richLink);
      }
    } catch (error) {
      console.error('Error creating order:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create order');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWhatsAppRedirect = () => {
    if (!store || !orderId || !orderNumber) return;

    let snapshotItems = cartState.items.map((item) => ({
      productName: item.product.name,
      quantity: item.quantity,
      priceAtOrder: Number(item.product.sellingPrice) || 0,
    }));
    let snapshotTotal = cartState.total;
    try {
      const raw = localStorage.getItem('last_online_order_snapshot');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.items) && parsed.items.length) snapshotItems = parsed.items;
        if (typeof parsed.total === 'number') snapshotTotal = parsed.total;
      }
    } catch {
      /* ignore */
    }

    const shopPhone = store.phone || configuredPaymentNumber || settings?.shopPhone || '';
    const summary = generateOrderSummary(
      orderNumber,
      customerName,
      snapshotItems,
      snapshotTotal,
      currencySymbol
    );
    const link = shopPhone
      ? buildWhatsAppLink(
          shopPhone,
          `Hi! I've placed an order.\n\n${summary}\n\nPhone: ${customerPhone}\nPlease confirm.`
        )
      : generateWhatsAppOrderLink(shopPhone, orderNumber, customerName, snapshotTotal, currencySymbol);

    openWhatsAppLink(link);

    setTimeout(() => {
      setShowConfirmation(false);
      onOpenChange(false);
      setCustomerName('');
      setCustomerPhone('');
      setOrderId(null);
      setOrderNumber(null);
    }, 1000);
  };

  const handleClose = () => {
    if (!isSubmitting) {
      // always clear confirmation flag so sheet resets on next open
      setShowConfirmation(false);
      onOpenChange(false);
      setCustomerName('');
      setCustomerPhone('');
    }
  };

  // Confirmation screen
  if (showConfirmation && orderId && orderNumber) {
    return (
      <Sheet open={open} onOpenChange={handleClose}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Order Confirmed! ✅</SheetTitle>
          </SheetHeader>
          <div className="py-6 space-y-4">
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-6">
                <div className="text-center space-y-2">
                  <p className="text-sm text-gray-600">Your Order Number</p>
                  <p className="text-3xl font-bold text-green-600">{orderNumber}</p>
                  <p className="text-sm text-gray-600 mt-2">
                    Total:{' '}
                    <span className="font-semibold">
                      {formatCurrency(confirmedTotal || cartState.total)}
                    </span>
                  </p>
                  {(confirmedTotal || cartState.total) === 0 && (
                    <p className="text-sm text-red-600 font-semibold mt-2">Warning: Order total is zero. Please check your cart items and prices.</p>
                  )}
                  {/* Receipt link removed for marketplace side */}
                </div>
              </CardContent>
            </Card>
            <Separator />
            <div className="space-y-3">
              <p className="text-sm font-medium">Next Steps:</p>
              <ol className="space-y-2 text-sm list-decimal list-inside">
                <li>Click "Message on WhatsApp" below</li>
                <li>Confirm your order details with our staff</li>
                <li>We'll notify you when your order is ready</li>
              </ol>
            </div>
            <Separator />
            <Button
              onClick={handleWhatsAppRedirect}
              className="w-full bg-green-500 hover:bg-green-600"
              size="lg"
            >
              <MessageCircle className="mr-2 h-5 w-5" />
              Message on WhatsApp
            </Button>
            <Button
              onClick={handleClose}
              variant="outline"
              className="w-full"
            >
              <ArrowLeft className="mr-2 h-5 w-5" />
              Back to Shop
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Main form
  return (
    <Sheet open={open && !showConfirmation} onOpenChange={handleClose}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Guest Checkout</SheetTitle>
        </SheetHeader>
        {/* Inline store loading / error banner */}
        {(!store || storeLoading) && (
          <div className="p-3 bg-yellow-50 border-l-4 border-yellow-400 rounded mb-4 mx-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium">Shop data not ready</p>
                <p className="text-xs text-muted-foreground">The shop information is still loading — checkout will be disabled until it's ready.</p>
              </div>
              <div className="ml-4">
                <Button size="sm" onClick={() => { void refreshStores(); }} disabled={storeLoading}>Retry</Button>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="py-6 space-y-6">
          {/* Cart Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cartState.items.map((item) => (
                <div key={item.lineId} className="flex justify-between text-sm">
                  <span>
                    {item.product.name} × {item.quantity}
                  </span>
                  <span className="font-medium">
                    {formatCurrency((item.unitPrice ?? item.product.sellingPrice) * item.quantity)}
                  </span>
                </div>
              ))}

              <Separator />

              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span>{formatCurrency(cartState.subtotal)}</span>
              </div>

              {cartState.discount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount</span>
                  <span>-{formatCurrency(cartState.discount)}</span>
                </div>
              )}

              <Separator />

              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <RollingNumber value={cartState.total} format={formatCurrency} />
              </div>
            </CardContent>
          </Card>

          {/* Customer Info */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="name" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Your Name
              </Label>
              <Input
                id="name"
                type="text"
                placeholder="Enter your name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                disabled={isSubmitting}
                className={errors.name ? 'border-red-500' : ''}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>

            <div>
              <Label htmlFor="phone" className="flex items-center gap-2">
                <PhoneIcon className="h-4 w-4" />
                Phone Number
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="260971234567 or +260971234567"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                disabled={isSubmitting}
                className={errors.phone ? 'border-red-500' : ''}
              />
              <p className="text-xs text-gray-500 mt-1">We'll use this to confirm your order on WhatsApp</p>
              {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
            </div>
          </div>

          {/* Delivery Options */}
          <div className="space-y-4">
            <div>
              <Label className="text-base font-medium">Delivery Option</Label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <Button
                  type="button"
                  variant={deliveryType === 'collect' ? 'default' : 'outline'}
                  onClick={() => setDeliveryType('collect')}
                  className="flex flex-col items-center gap-2 h-auto py-4"
                >
                  <MapPin className="h-5 w-5" />
                  <span className="text-sm">Collect at Store</span>
                </Button>
                <Button
                  type="button"
                  variant={deliveryType === 'delivery' ? 'default' : 'outline'}
                  onClick={() => setDeliveryType('delivery')}
                  className="flex flex-col items-center gap-2 h-auto py-4"
                >
                  <Truck className="h-5 w-5" />
                  <span className="text-sm">Home Delivery</span>
                </Button>
              </div>
            </div>

            {deliveryType === 'delivery' && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="deliveryAddress">Delivery Address</Label>
                  <Input
                    id="deliveryAddress"
                    type="text"
                    placeholder="Street, area, landmark"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    disabled={isSubmitting}
                    className={errors.deliveryAddress ? 'border-red-500' : ''}
                  />
                  {errors.deliveryAddress && (
                    <p className="text-xs text-red-500 mt-1">{errors.deliveryAddress}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="province">Province</Label>
                  <select
                    id="province"
                    value={selectedProvince}
                    onChange={(e) => setSelectedProvince(e.target.value)}
                    disabled={isSubmitting}
                    className={cn(
                      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                      errors.province && 'border-red-500'
                    )}
                  >
                    {ZAMBIA_PROVINCES.map((prov) => (
                      <option key={prov.id} value={prov.id}>
                        {prov.label}
                      </option>
                    ))}
                  </select>
                  {errors.province && <p className="text-xs text-red-500 mt-1">{errors.province}</p>}
                </div>
                <div>
                  <Label htmlFor="carrier">Carrier</Label>
                  <select
                    id="carrier"
                    value={selectedCarrier}
                    onChange={(e) => setSelectedCarrier(e.target.value)}
                    disabled={isSubmitting || shopOwnerDelivery}
                    className={cn(
                      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                      errors.carrier && 'border-red-500'
                    )}
                  >
                    {deliveryCarriers.map((carrier) => (
                      <option key={carrier.name} value={carrier.name}>
                        {carrier.name} — {formatCurrency(carrier.provinces[selectedProvince as keyof typeof carrier.provinces] || 0)}
                      </option>
                    ))}
                  </select>
                  {errors.carrier && <p className="text-xs text-red-500 mt-1">{errors.carrier}</p>}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="shopOwnerDelivery"
                    checked={shopOwnerDelivery}
                    onChange={() => setShopOwnerDelivery((v) => !v)}
                    disabled={isSubmitting}
                  />
                  <Label htmlFor="shopOwnerDelivery">Shop owner delivers (same city — K10)</Label>
                </div>
                <div className="rounded-lg border bg-slate-50 px-3 py-2 text-sm">
                  Delivery to <strong>{provinceLabel(selectedProvince)}</strong>:{' '}
                  <strong>{formatCurrency(computedDeliveryFee)}</strong>
                </div>
              </div>
            )}
          </div>

          {/* Payment Method Selection */}
          <div className="space-y-4">
            <div>
              <Label className="text-base font-medium">Payment Method</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setPaymentCategory('mobile')}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                    paymentCategory === 'mobile'
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                      : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  <Smartphone className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Mobile Money</p>
                    <p className="text-xs text-muted-foreground">MTN · Airtel · Zamtel</p>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setPaymentCategory('card');
                    setMobileProvider('');
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                    paymentCategory === 'card'
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                      : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  <CreditCard className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Card</p>
                    <p className="text-xs text-muted-foreground">Visa · Mastercard</p>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setPaymentCategory('bank');
                    setMobileProvider('');
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                    paymentCategory === 'bank'
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                      : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  <Building2 className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">Bank Transfer</p>
                    <p className="text-xs text-muted-foreground">Pay then confirm</p>
                  </div>
                </button>
              </div>
              {errors.paymentCategory && (
                <p className="text-xs text-red-500 mt-1">{errors.paymentCategory}</p>
              )}
            </div>

            {paymentCategory === 'card' && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                <p className="text-sm font-medium text-blue-900">Pay by card (secure checkout)</p>
                <p className="text-xs text-blue-800">
                  After you place the order, you will be redirected to complete card payment. The shop still confirms on POS.
                </p>
                <div>
                  <Label htmlFor="customerEmail">Email (optional)</Label>
                  <Input
                    id="customerEmail"
                    type="email"
                    placeholder="you@email.com"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    disabled={isSubmitting}
                    className={errors.email ? 'border-red-500' : ''}
                  />
                  {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
                </div>
              </div>
            )}

            {paymentCategory === 'bank' && (
              <div className="rounded-xl border bg-slate-50 p-4 space-y-2 text-sm">
                <p className="font-medium">Bank transfer</p>
                <p className="text-muted-foreground">
                  Place the order, then transfer the total to the shop. Send proof on WhatsApp so staff can confirm on POS.
                </p>
                <p>
                  Shop phone:{' '}
                  <strong>{store?.phone || settings?.shopPhone || 'Ask shop on WhatsApp'}</strong>
                </p>
              </div>
            )}

            {paymentCategory === 'mobile' && (
              <div>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {(['mtn', 'airtel', 'zamtel', 'zedmobile'] as const).map((prov) => (
                    <Button
                      key={prov}
                      type="button"
                      variant={mobileProvider === prov ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setMobileProvider(prov)}
                      disabled={isSubmitting}
                    >
                      {prov.toUpperCase()}
                    </Button>
                  ))}
                </div>
                {errors.mobileProvider && (
                  <p className="text-xs text-red-500 mt-1">{errors.mobileProvider}</p>
                )}
                {mobileProvider && (
                  <div className="mt-4 space-y-3 rounded-lg border bg-gray-50 p-4">
                    <div>
                      <p className="text-sm font-medium">Pay to ({mobileProvider.toUpperCase()})</p>
                      <p className="mt-1 text-lg font-semibold">
                        {(store?.payment_numbers && mobileProvider
                          ? store.payment_numbers[mobileProvider]
                          : undefined) ||
                          store?.phone ||
                          settings?.shopPhone ||
                          'N/A'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={async () => {
                          const num =
                            (store?.payment_numbers && mobileProvider
                              ? store.payment_numbers[mobileProvider]
                              : undefined) ||
                            store?.phone ||
                            settings?.shopPhone ||
                            '';
                          if (!num) return toast.error('No payment number available');
                          const ok = await copyToClipboard(num);
                          if (ok) toast.success('Payment number copied');
                          else toast.error('Unable to copy');
                        }}
                      >
                        Copy number
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const num =
                            (store?.payment_numbers && mobileProvider
                              ? store.payment_numbers[mobileProvider]
                              : undefined) ||
                            store?.phone ||
                            settings?.shopPhone ||
                            '';
                          if (!num) return toast.error('No payment number available');
                          const phoneFormatted = formatPhoneToE164(num);
                          const itemsText = cartState.items
                            .map((i) => `${i.product.name} x${i.quantity}`)
                            .join(', ');
                          const refText = mobileReference ? `\nReference: ${mobileReference}` : '';
                          const message = encodeURIComponent(
                            `Hi ${store?.name || 'Shop'}, I have sent ${formatCurrency(totalWithDelivery)} via ${mobileProvider.toUpperCase()} to ${num}.${refText}\n\nMy name: ${customerName || 'N/A'}\nMy phone: ${customerPhone || 'N/A'}\nItems: ${itemsText}\n\nPlease confirm; I will attach a payment screenshot.`
                          );
                          openWhatsAppLink(`https://wa.me/${phoneFormatted.replace('+', '')}?text=${message}`);
                        }}
                      >
                        Message on WhatsApp
                      </Button>
                    </div>
                    <div>
                      <Label htmlFor="mobileMoneyPhone">Paying from (phone)</Label>
                      <Input
                        id="mobileMoneyPhone"
                        type="tel"
                        placeholder="097xxxxxxx"
                        value={mobileMoneyPhone || customerPhone}
                        onChange={(e) => setMobileMoneyPhone(e.target.value)}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div>
                      <Label htmlFor="mobileReference">Payment reference (optional)</Label>
                      <Input
                        id="mobileReference"
                        type="text"
                        placeholder="Transaction ID / reference"
                        value={mobileReference}
                        onChange={(e) => setMobileReference(e.target.value)}
                        disabled={isSubmitting}
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Send money to the number above, then place order. Staff confirm on POS.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Updated Total with Delivery */}
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="pt-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatCurrency(cartState.subtotal)}</span>
                </div>
                {cartState.discount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount</span>
                    <span>-{formatCurrency(cartState.discount)}</span>
                  </div>
                )}
                {deliveryType === 'delivery' && parseFloat(deliveryFee || '0') > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Delivery Fee</span>
                    <span>{formatCurrency(parseFloat(deliveryFee || '0'))}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <RollingNumber value={totalWithDelivery} format={formatCurrency} />
                </div>
              </div>
            </CardContent>
          </Card>

          <SheetFooter className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || isSubmitting || !store || storeLoading}
              className="flex-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {paymentCategory === 'card' ? 'Opening card checkout…' : 'Creating Order...'}
                </>
              ) : paymentCategory === 'card' ? (
                'Pay with Card'
              ) : (
                'Place Order'
              )}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
