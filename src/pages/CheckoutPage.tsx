import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useCart } from '@/contexts/CartContext';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { completeSaleAtomic, upsertDailySummaryForDate, dexieDb } from '@/lib/db';
import { createSaleWithSync } from '@/lib/sync';
import { generateReceiptNumber } from '@/types/pos';
import type { Sale, SaleItem } from '@/types/pos';
import { CreditCard, Banknote, Smartphone, Check, ArrowLeft, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { RollingNumber } from '@/components/ui/rolling-number';
import { ProductImage } from '@/components/ProductImage';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePersistentForm } from '@/hooks/usePersistentForm';
import { computeSalesTax } from '@/lib/taxEngine';
import { useStore } from '@/contexts/StoreContext';
import { useCustomerDisplayPublisher } from '@/hooks/useCustomerDisplayPublisher';
import type { CustomerDisplaySnapshot } from '@/lib/customerDisplay';

type PaymentMethod = 'cash' | 'card' | 'mobile' | 'credit';

type CheckoutDraft = {
  paymentMethod?: PaymentMethod;
  payLaterBalance?: boolean;
  customerName?: string;
  mobileProvider?: 'mtn' | 'airtel' | 'zamtel' | 'other';
  mobileReference?: string;
  amountReceivedInput?: string;
  discountInput?: string;
};

function AnimatedCurrency({ value, currencySymbol, className }: { value: number; currencySymbol: string; className?: string }) {
  const mv = useMotionValue(value);

  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.22, ease: 'easeOut' });
    return () => controls.stop();
  }, [mv, value]);

  const text = useTransform(mv, (v) => `${currencySymbol}${Number(v).toFixed(2)}`);
  return <motion.span className={className}>{text}</motion.span>;
}

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { state, clearCart, setDiscount, hydrateFromStorage } = useCart();
  const { settings, company } = useSupabaseAuth();
  const { currentStore } = useStore();
  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();
  const isOnline = useOnlineStatus();
  const [saleCompletedInfo, setSaleCompletedInfo] = useState<{
    totalText: string;
    changeText: string;
  } | null>(null);
  const [cartReady, setCartReady] = useState(() => state.items.length > 0);

  const [checkoutDraft, setCheckoutDraft, clearCheckoutDraft] =
    usePersistentForm<CheckoutDraft>('checkout:sale-draft', () => ({}));

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    () => checkoutDraft.paymentMethod ?? 'cash'
  );
  const [payLaterBalance, setPayLaterBalance] = useState(
    () => checkoutDraft.payLaterBalance ?? false
  );
  const [customerName, setCustomerName] = useState(
    () => checkoutDraft.customerName ?? ''
  );
  const [mobileProvider, setMobileProvider] = useState<
    'mtn' | 'airtel' | 'zamtel' | 'other'
  >(() => checkoutDraft.mobileProvider ?? 'mtn');
  const [mobileReference, setMobileReference] = useState(
    () => checkoutDraft.mobileReference ?? ''
  );
  const [amountReceivedInput, setAmountReceivedInput] = useState(
    () => checkoutDraft.amountReceivedInput ?? ''
  );
  const [discountInput, setDiscountInput] = useState(
    () =>
      checkoutDraft.discountInput ??
      (state.discount > 0 ? state.discount.toFixed(2) : '')
  );
  const [processing, setProcessing] = useState(false);

  const salesTax = useMemo(() => {
    return computeSalesTax({
      settings,
      subtotal: state.subtotal,
      discount: state.discount,
    });
  }, [settings, state.discount, state.subtotal]);

  const totalDue = salesTax.totalWithTax;

  const amountReceivedValue = useMemo(() => {
    const v = parseFloat(amountReceivedInput.replace(/,/g, '.'));
    return Number.isFinite(v) && v > 0 ? v : 0;
  }, [amountReceivedInput]);

  const paidNow = useMemo(() => {
    if (paymentMethod === 'credit') return 0;
    if (amountReceivedValue <= 0) return 0;
    return Math.min(amountReceivedValue, totalDue);
  }, [amountReceivedValue, paymentMethod, totalDue]);

  const balanceDue = useMemo(() => {
    if (paymentMethod === 'credit') return totalDue;
    if (!payLaterBalance) return Math.max(0, totalDue - paidNow);
    return Math.max(0, totalDue - paidNow);
  }, [paymentMethod, payLaterBalance, paidNow, totalDue]);

  const changeToGive = useMemo(() => {
    if (paymentMethod !== 'cash') return 0;
    if (paymentMethod === 'credit') return 0;
    return Math.max(0, amountReceivedValue - totalDue);
  }, [amountReceivedValue, paymentMethod, totalDue]);

  // Keep the customer-facing display in sync through checkout, then show a
  // thank-you screen once the sale is completed.
  const customerDisplaySnapshot = useMemo<CustomerDisplaySnapshot>(() => {
    const storeName = currentStore?.name || settings?.shopName || 'Store';
    const logoUrl = company?.logoUrl || undefined;

    if (saleCompletedInfo) {
      return {
        type: 'cart-snapshot',
        status: 'completed',
        storeName,
        logoUrl,
        items: [],
        itemCount: 0,
        subtotalText: formatCurrency(state.subtotal),
        discountAmount: state.discount,
        discountText: formatCurrency(state.discount),
        taxLabel: salesTax.label,
        taxAmount: salesTax.taxAmount,
        taxText: formatCurrency(salesTax.taxAmount),
        totalText: saleCompletedInfo.totalText,
        changeText: saleCompletedInfo.changeText,
        updatedAt: Date.now(),
      };
    }

    return {
      type: 'cart-snapshot',
      status: 'active',
      storeName,
      logoUrl,
      items: state.items.map((item) => {
        const unit = item.unitPrice ?? item.product.sellingPrice;
        return {
          lineId: item.lineId,
          name: item.product.name,
          quantity: item.quantity,
          unitPriceText: formatCurrency(unit),
          lineTotalText: formatCurrency(unit * item.quantity),
        };
      }),
      itemCount: state.items.reduce((sum, i) => sum + i.quantity, 0),
      subtotalText: formatCurrency(state.subtotal),
      discountAmount: state.discount,
      discountText: formatCurrency(state.discount),
      taxLabel: salesTax.label,
      taxAmount: salesTax.taxAmount,
      taxText: formatCurrency(salesTax.taxAmount),
      totalText: formatCurrency(totalDue),
      updatedAt: Date.now(),
    };
  }, [
    saleCompletedInfo,
    state.items,
    state.subtotal,
    state.discount,
    salesTax,
    totalDue,
    currentStore?.name,
    settings?.shopName,
    company?.logoUrl,
    formatCurrency,
  ]);

  useCustomerDisplayPublisher(customerDisplaySnapshot);

  const canPay = useMemo(() => {
    if (state.items.length === 0) return false;
    if (processing) return false;

    const customerOk = customerName.trim().length > 0;

    if (paymentMethod === 'credit') return customerOk;

    if (balanceDue > 0) {
      if (!customerOk && (payLaterBalance || paymentMethod === 'credit')) return false;
      if (paymentMethod === 'mobile' && paidNow > 0 && mobileReference.trim().length === 0)
        return false;
      return true;
    }

    if (paymentMethod === 'cash') return amountReceivedValue + 1e-9 >= totalDue;
    if (paymentMethod === 'mobile' && mobileReference.trim().length === 0) return false;
    return paidNow + 1e-9 >= totalDue;
  }, [
    amountReceivedValue,
    balanceDue,
    customerName,
    mobileReference,
    paidNow,
    paymentMethod,
    payLaterBalance,
    processing,
    state.items.length,
    totalDue,
  ]);

  // Cash: keep a payable default so Pay isn’t stuck disabled from an empty/stale draft.
  useEffect(() => {
    if (paymentMethod !== 'cash' || payLaterBalance) return;
    if (totalDue <= 0) return;
    setAmountReceivedInput((prev) => {
      const current = parseFloat(String(prev).replace(/,/g, '.'));
      if (Number.isFinite(current) && current + 1e-9 >= totalDue) return prev;
      return totalDue.toFixed(2);
    });
    setCheckoutDraft((prev) => {
      const current = parseFloat(String(prev.amountReceivedInput || '').replace(/,/g, '.'));
      if (Number.isFinite(current) && current + 1e-9 >= totalDue) return prev;
      return { ...prev, amountReceivedInput: totalDue.toFixed(2) };
    });
  }, [paymentMethod, payLaterBalance, setCheckoutDraft, totalDue]);

  useEffect(() => {
    // For non-cash methods, default to exact amount (unless doing Pay Later).
    if (
      paymentMethod !== 'cash' &&
      paymentMethod !== 'credit' &&
      !payLaterBalance &&
      !amountReceivedInput
    ) {
      const v = totalDue.toFixed(2);
      setAmountReceivedInput(v);
      setCheckoutDraft((prev) => ({ ...prev, amountReceivedInput: v }));
    }
    if (paymentMethod === 'credit') {
      if (!payLaterBalance) {
        setPayLaterBalance(true);
        setCheckoutDraft((prev) => ({ ...prev, payLaterBalance: true }));
      }
      setAmountReceivedInput('0');
      setCheckoutDraft((prev) => ({ ...prev, amountReceivedInput: '0' }));
    }
  }, [amountReceivedInput, paymentMethod, payLaterBalance, setCheckoutDraft, totalDue]);

  useEffect(() => {
    if (paymentMethod === 'credit') return;
    if (!payLaterBalance) {
      setCustomerName('');
      setCheckoutDraft((prev) => ({ ...prev, customerName: '' }));
    }
  }, [payLaterBalance, paymentMethod, setCheckoutDraft]);

  const handleDiscountChange = (value: string) => {
    setDiscountInput(value);
    const discount = parseFloat(value) || 0;
    setDiscount(Math.max(0, Math.min(discount, state.subtotal)));
    setCheckoutDraft((prev) => ({ ...prev, discountInput: value }));
  };

  const handleCompleteSale = async () => {
    if (state.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    setProcessing(true);

    try {
      const normalizedCustomerName = customerName.trim();
      if (balanceDue > 0 && !normalizedCustomerName) {
        toast.error('Customer name is required for Pay Later');
        return;
      }
      if (paymentMethod === 'mobile' && paidNow > 0 && mobileReference.trim().length === 0) {
        toast.error('Enter the Mobile Money reference/transaction ID');
        return;
      }

      // Local atomic write only — supermarket terminals must never wait on cloud/print.
      const sale = await completeSaleAtomic({
        items: state.items.map((i) => ({
          productId: i.product.id,
          quantity: i.quantity,
          unitPrice: i.unitPrice ?? i.product.sellingPrice,
        })),
        discount: state.discount,
        paymentMethod,
        amountReceived: amountReceivedValue,
        amountPaid: paidNow,
        balanceDue,
        customerName: balanceDue > 0 ? normalizedCustomerName : undefined,
        mobileProvider: paymentMethod === 'mobile' ? mobileProvider : undefined,
        mobileReference: paymentMethod === 'mobile' ? mobileReference.trim() : undefined,
        receiptNumber: generateReceiptNumber(),
      });

      const saleForReceipt: Sale = sale;
      const paidSnapshot = paidNow;
      const changeSnapshot = changeToGive;
      const totalSnapshot = totalDue;
      const paymentSnapshot = paymentMethod;
      const symbolSnapshot = currencySymbol;
      const settingsSnapshot = settings;
      const businessId = settings?.companyId || company?.id;
      const onlineSnapshot = isOnline;

      setSaleCompletedInfo({
        totalText: formatCurrency(paidSnapshot > 0 ? paidSnapshot : totalSnapshot),
        changeText: formatCurrency(changeSnapshot),
      });

      clearCart();
      clearCheckoutDraft();
      toast.success('Sale completed!');
      navigate(`/receipt/${saleForReceipt.id}`, { state: { sale: saleForReceipt } });

      // Background: summary, sync, ZRA, pole display, printer — never block the cashier.
      void (async () => {
        try {
          const d = new Date(sale.createdAt);
          const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          await upsertDailySummaryForDate(dateKey);
        } catch {
          /* ignore */
        }

        try {
          await createSaleWithSync(sale);
          if (!onlineSnapshot) {
            toast.message('Sale saved offline. Will sync when online.');
          }
        } catch (syncError) {
          console.warn('Background sale sync failed:', syncError);
        }

        if (businessId) {
          try {
            const { submitSaleToZRA } = await import('@/lib/zraApi');
            const invoice = await submitSaleToZRA(businessId, sale);
            if (invoice.enabled) {
              const enriched: Sale = {
                ...sale,
                zraSmartInvoiceEnabled: true,
                zraTpin: invoice.tpin || '',
                zraInvoiceNumber: invoice.invoiceNumber || '',
                zraVerificationCode: invoice.verificationCode || '',
                zraQrCode: invoice.qrCode || '',
              };
              await dexieDb.sales.put(enriched).catch(() => undefined);
            }
          } catch (zraError) {
            console.warn('ZRA Smart Invoice skipped:', zraError);
          }
        }

        try {
          const { customerDisplayService } = await import('@/lib/customerDisplayService');
          customerDisplayService.setCurrencySymbol(symbolSnapshot);
          if (customerDisplayService.getState().kind === 'connected') {
            await customerDisplayService.displayPayment(
              totalSnapshot,
              paidSnapshot > 0 ? paidSnapshot : totalSnapshot
            );
            if (changeSnapshot > 0) {
              await customerDisplayService.displayChange(changeSnapshot);
            } else {
              await customerDisplayService.displayCompleted(totalSnapshot);
            }
          }
        } catch (displayError) {
          console.warn('Customer display update skipped:', displayError);
        }

        try {
          if (!settingsSnapshot) return;
          const { bluetoothPrinterService } = await import('@/lib/bluetoothPrinterService');
          const ready = await bluetoothPrinterService.ensureConnected();
          if (!(ready || bluetoothPrinterService.getState().kind === 'connected')) {
            return;
          }
          if (paymentSnapshot === 'cash') {
            await bluetoothPrinterService.openDrawer(settingsSnapshot).catch(() => undefined);
          }
          await bluetoothPrinterService.printSale(saleForReceipt, settingsSnapshot);
          toast.success('Receipt printed');
        } catch (e) {
          console.warn('Background print failed', e);
          toast.error((e as Error)?.message || 'Failed to print receipt');
        }
      })();
    } catch (error) {
      console.error('Error completing sale:', error);
      toast.error((error as Error)?.message || 'Failed to complete sale');
    } finally {
      setProcessing(false);
    }
  };

  const paymentMethods = [
    { id: 'cash' as const, icon: Banknote, label: 'Cash' },
    { id: 'card' as const, icon: CreditCard, label: 'Card' },
    { id: 'mobile' as const, icon: Smartphone, label: 'Mobile' },
    { id: 'credit' as const, icon: Check, label: 'Pay Later' },
  ];

  const quickCash = [20, 50, 100, 200];

  useEffect(() => {
    // Warm up the Bluetooth printer as soon as checkout opens so Pay can print immediately.
    let cancelled = false;
    void (async () => {
      try {
        const { bluetoothPrinterService } = await import('@/lib/bluetoothPrinterService');
        if (cancelled) return;
        await bluetoothPrinterService.ensureConnected();
      } catch {
        /* printer may not be paired yet — Pay will retry */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Empty cart: leave checkout. Avoid instant bounce during cart hydrate.
  useEffect(() => {
    if (saleCompletedInfo) return;
    if (state.items.length > 0) {
      setCartReady(true);
      return;
    }
    // Recover cart from session after hard navigation.
    const recovered = hydrateFromStorage();
    if (recovered) {
      setCartReady(true);
      return;
    }
    const timer = window.setTimeout(() => {
      navigate('/', { replace: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [hydrateFromStorage, navigate, saleCompletedInfo, state.items.length]);

  if ((!cartReady || state.items.length === 0) && !saleCompletedInfo) {
    return (
      <AppShell title="Checkout" hideNav hideFooter>
        <div className="flex min-h-[40vh] items-center justify-center p-6 text-sm text-muted-foreground">
          Opening checkout…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Checkout" hideNav hideFooter>
      <div className="mx-auto max-w-lg space-y-4 p-4 lg:h-full lg:max-w-none lg:overflow-hidden lg:p-4">
        {/* Back Button */}
        <Button variant="ghost" onClick={() => navigate(-1)} className="gap-2 lg:shrink-0">
          <ArrowLeft className="h-4 w-4" />
          Back to Cart
        </Button>

        {/* Online Status Indicator */}
        {isOnline !== 'online' && (
          <Card className={cn(
            "border-2",
            isOnline === 'offline' ? "border-destructive bg-destructive/10" : "border-yellow-500 bg-yellow-500/10"
          )}>
            <CardContent className="flex items-center gap-2 p-3">
              {isOnline === 'offline' ? (
                <WifiOff className="h-4 w-4 text-destructive" />
              ) : (
                <Wifi className="h-4 w-4 text-yellow-600" />
              )}
              <p className="text-sm font-medium">
                {isOnline === 'offline' 
                  ? 'Offline - Sales will sync when connection returns' 
                  : 'Slow connection detected'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Desktop split layout */}
        <div className="hidden lg:flex lg:h-full lg:overflow-hidden lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-background">
          <div className="flex min-w-0 flex-[3] flex-col border-r border-slate-200">
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Order Summary</p>
                <h2 className="text-2xl font-bold">Review items</h2>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-3">
                {state.items.map((item) => (
                  <div key={item.lineId} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProductImage
                        productId={item.product.id}
                        localImageUrl={item.product.imageUrl}
                        storeId={item.product.storeId}
                        alt={item.product.name}
                        className="h-12 w-12 rounded-xl border border-slate-200 object-cover"
                        showPlaceholder={true}
                        placeholderText="IMG"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {item.product.name}
                        </p>
                        <p className="text-xs text-muted-foreground">× {item.quantity}</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-slate-900">
                      {formatCurrency((item.unitPrice ?? item.product.sellingPrice) * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="shrink-0 border-t border-slate-200 px-6 py-5">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <RollingNumber value={state.subtotal} format={(v) => formatCurrency(v)} />
                </div>

                {/* Discount Input */}
                <div className="space-y-2">
                  <Label htmlFor="discount-desktop">Discount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {currencySymbol}
                    </span>
                    <Input
                      id="discount-desktop"
                      type="number"
                      min="0"
                      max={state.subtotal}
                      step="0.01"
                      value={discountInput}
                      onChange={(e) => handleDiscountChange(e.target.value)}
                      className="pl-8"
                      placeholder="0.00"
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                </div>

                {state.discount > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>Discount</span>
                    <span>-{formatCurrency(state.discount)}</span>
                  </div>
                )}

                {salesTax.rate > 0 && salesTax.taxAmount > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">
                      {salesTax.label} ({salesTax.rate.toFixed(0)}%)
                    </span>
                    <span className="font-medium">{formatCurrency(salesTax.taxAmount)}</span>
                  </div>
                )}

                <Separator />

                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <RollingNumber value={totalDue} format={(v) => formatCurrency(v)} />
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-[2] flex-col overflow-hidden bg-slate-50/30 px-6 py-5">
            <div className="flex h-full flex-col gap-4 overflow-hidden">
              <Card className="shrink-0">
                <CardHeader>
                  <CardTitle>Payment Method</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    {paymentMethods.map((method) => (
                      <Button
                        key={method.id}
                        variant="outline"
                        onClick={() => {
                          setPaymentMethod(method.id);
                          setCheckoutDraft((prev) => ({
                            ...prev,
                            paymentMethod: method.id,
                          }));
                        }}
                        className={cn(
                          'flex h-20 flex-col gap-2',
                          paymentMethod === method.id &&
                            'border-primary bg-primary/10 ring-2 ring-primary'
                        )}
                      >
                        <method.icon className="h-6 w-6" />
                        <span className="text-sm">{method.label}</span>
                      </Button>
                    ))}
                  </div>

                  {paymentMethod !== 'credit' && (
                    <div className="mt-4 flex items-center justify-between gap-3 rounded-md border p-3">
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">Pay later balance</div>
                        <div className="text-xs text-muted-foreground">Allow partial payment and record remaining debt.</div>
                      </div>
                      <Switch
                        checked={payLaterBalance}
                        onCheckedChange={(checked) => {
                          setPayLaterBalance(checked);
                          setCheckoutDraft((prev) => ({
                            ...prev,
                            payLaterBalance: checked,
                          }));
                        }}
                      />
                    </div>
                  )}

                  {(paymentMethod === 'credit' || payLaterBalance) && (
                    <div className="mt-4 space-y-2">
                      <Label htmlFor="customerName-desktop">Customer name</Label>
                      <Input
                        id="customerName-desktop"
                        value={customerName}
                        onChange={(e) => {
                          const v = e.target.value;
                          setCustomerName(v);
                          setCheckoutDraft((prev) => ({ ...prev, customerName: v }));
                        }}
                        placeholder="e.g. Mr. Phiri"
                      />
                    </div>
                  )}

                  {paymentMethod === 'mobile' && (
                    <div className="mt-4 grid gap-3">
                      <div className="grid gap-2">
                        <Label>Mobile Money Provider</Label>
                        <Select
                          value={mobileProvider}
                          onValueChange={(v) => {
                            setMobileProvider(v as any);
                            setCheckoutDraft((prev) => ({
                              ...prev,
                              mobileProvider: v as any,
                            }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mtn">MTN MoMo</SelectItem>
                            <SelectItem value="airtel">Airtel Money</SelectItem>
                            <SelectItem value="zamtel">Zamtel</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="momoRef-desktop">Transaction ID / Reference</Label>
                        <Input
                          id="momoRef-desktop"
                          value={mobileReference}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMobileReference(v);
                            setCheckoutDraft((prev) => ({
                              ...prev,
                              mobileReference: v,
                            }));
                          }}
                          placeholder="Enter MoMo/Airtel reference"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shrink-0">
                <CardHeader>
                  <CardTitle>
                    {paymentMethod === 'cash'
                      ? 'Cash Received'
                      : paymentMethod === 'credit'
                        ? 'Pay Later'
                        : 'Amount Paid Now'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {paymentMethod !== 'credit' ? (
                    <div className="space-y-2">
                      <Label htmlFor="amountReceived-desktop">{paymentMethod === 'cash' ? 'Cash received' : 'Amount paid now'}</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
                          {currencySymbol}
                        </span>
                        <Input
                          id="amountReceived-desktop"
                          inputMode="decimal"
                          type="number"
                          min="0"
                          step="0.01"
                          value={amountReceivedInput}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAmountReceivedInput(v);
                            setCheckoutDraft((prev) => ({
                              ...prev,
                              amountReceivedInput: v,
                            }));
                          }}
                          onFocus={(e) => e.target.select()}
                          className={cn(
                            'h-14 pl-10 text-lg font-bold',
                            'border-2 focus-visible:ring-0 focus-visible:border-primary'
                          )}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This sale will be recorded as credit. The customer will pay later.
                    </p>
                  )}

                  {paymentMethod === 'cash' && (
                    <div className="flex flex-wrap gap-2">
                      {quickCash.map((amt) => (
                        <Button
                          key={amt}
                          type="button"
                          variant="outline"
                          onClick={() => {
                            const v = String(amt);
                            setAmountReceivedInput(v);
                            setCheckoutDraft((prev) => ({
                              ...prev,
                              amountReceivedInput: v,
                            }));
                          }}
                          className="h-10"
                        >
                          {currencySymbol}{amt}
                        </Button>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          const v = totalDue.toFixed(2);
                          setAmountReceivedInput(v);
                          setCheckoutDraft((prev) => ({
                            ...prev,
                            amountReceivedInput: v,
                          }));
                        }}
                        className="h-10"
                      >
                        Exact
                      </Button>
                    </div>
                  )}

                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={`${paymentMethod}-${balanceDue > 0 ? 'balance' : 'change'}-${canPay ? 'ok' : 'pending'}`}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        'rounded-md border p-3',
                        canPay ? 'border-success/40 bg-success/10' : 'border-muted bg-muted/30'
                      )}
                    >
                      <div className="space-y-2">
                        <div className={cn('flex items-center justify-between', canPay ? 'text-success' : 'text-muted-foreground')}>
                          <span className={cn('font-semibold', canPay ? 'text-base' : 'text-sm')}>Paid now</span>
                          <AnimatedCurrency
                            value={paidNow}
                            currencySymbol={currencySymbol}
                            className={cn('text-2xl font-extrabold', canPay ? 'text-success' : '')}
                          />
                        </div>

                        {balanceDue > 0 ? (
                          <div className="flex items-center justify-between text-destructive">
                            <span className="font-semibold">Balance due</span>
                            <AnimatedCurrency
                              value={balanceDue}
                              currencySymbol={currencySymbol}
                              className="text-2xl font-extrabold"
                            />
                          </div>
                        ) : paymentMethod === 'cash' ? (
                          <div className={cn('flex items-center justify-between', canPay ? 'text-success' : 'text-muted-foreground')}>
                            <span className={cn('font-semibold', canPay ? 'text-base' : 'text-sm')}>Change to give</span>
                            {canPay ? (
                              <AnimatedCurrency
                                value={changeToGive}
                                currencySymbol={currencySymbol}
                                className="text-2xl font-extrabold"
                              />
                            ) : (
                              <span className="text-lg font-bold">{currencySymbol}0.00</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </CardContent>
              </Card>

              <div className="mt-auto shrink-0 pb-1">
                <motion.button
                  whileHover={canPay && !processing ? { scale: 1.02 } : {} }
                  animate={
                    canPay && !processing
                      ? {
                          scale: [1, 1.02, 1],
                          boxShadow: [
                            '0 0 0 0 rgba(34,197,94,0.4)',
                            '0 0 0 12px rgba(34,197,94,0)',
                            '0 0 0 0 rgba(34,197,94,0)',
                          ],
                        }
                      : {}
                  }
                  transition={{
                    duration: 1.2,
                    repeat: canPay && !processing ? Infinity : 0,
                    ease: 'easeOut',
                  }}
                  disabled={processing || !canPay}
                  onClick={handleCompleteSale}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-full py-6 text-lg font-semibold shadow-lg transition-all',
                    canPay && !processing
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Check className="h-5 w-5" />
                  {processing ? (
                    'Processing...'
                  ) : (
                    <span className="flex items-center gap-2">
                      {balanceDue > 0 || paymentMethod === 'credit' ? 'Save Sale' : 'Pay'}{' '}
                      <RollingNumber
                        value={paidNow > 0 ? paidNow : totalDue}
                        format={(v) => formatCurrency(v)}
                      />
                    </span>
                  )}
                </motion.button>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile layout */}
        <div className="space-y-4 lg:hidden">
          {/* Order Summary */}
          <Card>
          <CardHeader>
            <CardTitle>Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {state.items.map((item) => (
              <div key={item.lineId} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <ProductImage
                    productId={item.product.id}
                    localImageUrl={item.product.imageUrl}
                    storeId={item.product.storeId}
                    alt={item.product.name}
                    className="h-10 w-10 rounded-lg border border-slate-200 object-cover"
                    showPlaceholder={true}
                    placeholderText="IMG"
                  />
                  <span className="min-w-0 truncate">
                    {item.product.name} × {item.quantity}
                  </span>
                </div>
                <span className="shrink-0 font-medium">
                  {formatCurrency((item.unitPrice ?? item.product.sellingPrice) * item.quantity)}
                </span>
              </div>
            ))}

            <Separator />

            <div className="flex justify-between">
              <span>Subtotal</span>
              <RollingNumber value={state.subtotal} format={(v) => formatCurrency(v)} />
            </div>

            {/* Discount Input */}
            <div className="space-y-2">
              <Label htmlFor="discount">Discount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {currencySymbol}
                </span>
                <Input
                  id="discount"
                  type="number"
                  min="0"
                  max={state.subtotal}
                  step="0.01"
                  value={discountInput}
                  onChange={(e) => handleDiscountChange(e.target.value)}
                  className="pl-8"
                  placeholder="0.00"
                  onFocus={(e) => e.target.select()}
                />
              </div>
            </div>

            {state.discount > 0 && (
              <div className="flex justify-between text-destructive">
                <span>Discount</span>
                <span>-{formatCurrency(state.discount)}</span>
              </div>
            )}

            {salesTax.rate > 0 && salesTax.taxAmount > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  {salesTax.label} ({salesTax.rate.toFixed(0)}%)
                </span>
                <span className="font-medium">{formatCurrency(salesTax.taxAmount)}</span>
              </div>
            )}

            <Separator />

            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <RollingNumber value={totalDue} format={(v) => formatCurrency(v)} />
            </div>
          </CardContent>
        </Card>

        {/* Payment Method */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Method</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {paymentMethods.map((method) => (
                <Button
                  key={method.id}
                  variant="outline"
                  onClick={() => {
                    setPaymentMethod(method.id);
                    setCheckoutDraft((prev) => ({
                      ...prev,
                      paymentMethod: method.id,
                    }));
                  }}
                  className={cn(
                    'flex h-20 flex-col gap-2',
                    paymentMethod === method.id &&
                      'border-primary bg-primary/10 ring-2 ring-primary'
                  )}
                >
                  <method.icon className="h-6 w-6" />
                  <span className="text-sm">{method.label}</span>
                </Button>
              ))}
            </div>

            {paymentMethod !== 'credit' && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Pay later balance</div>
                  <div className="text-xs text-muted-foreground">Allow partial payment and record remaining debt.</div>
                </div>
                <Switch
                  checked={payLaterBalance}
                  onCheckedChange={(checked) => {
                    setPayLaterBalance(checked);
                    setCheckoutDraft((prev) => ({
                      ...prev,
                      payLaterBalance: checked,
                    }));
                  }}
                />
              </div>
            )}

            {(paymentMethod === 'credit' || payLaterBalance) && (
              <div className="mt-4 space-y-2">
                <Label htmlFor="customerName">Customer name</Label>
                <Input
                  id="customerName"
                  value={customerName}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomerName(v);
                    setCheckoutDraft((prev) => ({ ...prev, customerName: v }));
                  }}
                  placeholder="e.g. Mr. Phiri"
                />
              </div>
            )}

            {paymentMethod === 'mobile' && (
              <div className="mt-4 grid gap-3">
                <div className="grid gap-2">
                  <Label>Mobile Money Provider</Label>
                  {/* Provider is also persisted so the user doesn't have to re-select */}
                  <Select
                    value={mobileProvider}
                    onValueChange={(v) => {
                      setMobileProvider(v as any);
                      setCheckoutDraft((prev) => ({
                        ...prev,
                        mobileProvider: v as any,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mtn">MTN MoMo</SelectItem>
                      <SelectItem value="airtel">Airtel Money</SelectItem>
                      <SelectItem value="zamtel">Zamtel</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="momoRef">Transaction ID / Reference</Label>
                  <Input
                    id="momoRef"
                    value={mobileReference}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMobileReference(v);
                      setCheckoutDraft((prev) => ({
                        ...prev,
                        mobileReference: v,
                      }));
                    }}
                    placeholder="Enter MoMo/Airtel reference"
                    autoComplete="off"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Amount Received */}
        <Card>
          <CardHeader>
            <CardTitle>
              {paymentMethod === 'cash'
                ? 'Cash Received'
                : paymentMethod === 'credit'
                  ? 'Pay Later'
                  : 'Amount Paid Now'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {paymentMethod !== 'credit' ? (
              <div className="space-y-2">
                <Label htmlFor="amountReceived">{paymentMethod === 'cash' ? 'Cash received' : 'Amount paid now'}</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
                    {currencySymbol}
                  </span>
                  <Input
                    id="amountReceived"
                    inputMode="decimal"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountReceivedInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAmountReceivedInput(v);
                      setCheckoutDraft((prev) => ({
                        ...prev,
                        amountReceivedInput: v,
                      }));
                    }}
                    onFocus={(e) => e.target.select()}
                    className={cn(
                      'h-14 pl-10 text-lg font-bold',
                      'border-2 focus-visible:ring-0 focus-visible:border-primary'
                    )}
                    placeholder="0.00"
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This sale will be recorded as credit. The customer will pay later.
              </p>
            )}

            {paymentMethod === 'cash' && (
              <div className="flex flex-wrap gap-2">
                {quickCash.map((amt) => (
                  <Button
                    key={amt}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const v = String(amt);
                      setAmountReceivedInput(v);
                      setCheckoutDraft((prev) => ({
                        ...prev,
                        amountReceivedInput: v,
                      }));
                    }}
                    className="h-10"
                  >
                    {currencySymbol}{amt}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const v = totalDue.toFixed(2);
                    setAmountReceivedInput(v);
                    setCheckoutDraft((prev) => ({
                      ...prev,
                      amountReceivedInput: v,
                    }));
                  }}
                  className="h-10"
                >
                  Exact
                </Button>
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${paymentMethod}-${balanceDue > 0 ? 'balance' : 'change'}-${canPay ? 'ok' : 'pending'}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className={cn(
                  'rounded-md border p-3',
                  canPay ? 'border-success/40 bg-success/10' : 'border-muted bg-muted/30'
                )}
              >
                <div className="space-y-2">
                  <div className={cn('flex items-center justify-between', canPay ? 'text-success' : 'text-muted-foreground')}>
                    <span className={cn('font-semibold', canPay ? 'text-base' : 'text-sm')}>Paid now</span>
                    <AnimatedCurrency
                      value={paidNow}
                      currencySymbol={currencySymbol}
                      className={cn('text-2xl font-extrabold', canPay ? 'text-success' : '')}
                    />
                  </div>

                  {balanceDue > 0 ? (
                    <div className="flex items-center justify-between text-destructive">
                      <span className="font-semibold">Balance due</span>
                      <AnimatedCurrency
                        value={balanceDue}
                        currencySymbol={currencySymbol}
                        className="text-2xl font-extrabold"
                      />
                    </div>
                  ) : paymentMethod === 'cash' ? (
                    <div className={cn('flex items-center justify-between', canPay ? 'text-success' : 'text-muted-foreground')}>
                      <span className={cn('font-semibold', canPay ? 'text-base' : 'text-sm')}>Change to give</span>
                      {canPay ? (
                        <AnimatedCurrency
                          value={changeToGive}
                          currencySymbol={currencySymbol}
                          className="text-2xl font-extrabold"
                        />
                      ) : (
                        <span className="text-lg font-bold">{currencySymbol}0.00</span>
                      )}
                    </div>
                  ) : null}
                </div>
              </motion.div>
            </AnimatePresence>
          </CardContent>
        </Card>

        {/* Complete Sale Button */}
        <motion.button
          whileHover={canPay && !processing ? { scale: 1.02 } : {}}
          animate={
            canPay && !processing
              ? {
                  scale: [1, 1.02, 1],
                  boxShadow: [
                    '0 0 0 0 rgba(34,197,94,0.4)',
                    '0 0 0 12px rgba(34,197,94,0)',
                    '0 0 0 0 rgba(34,197,94,0)',
                  ],
                }
              : {}
          }
          transition={{
            duration: 1.2,
            repeat: canPay && !processing ? Infinity : 0,
            ease: 'easeOut',
          }}
          disabled={processing || !canPay}
          onClick={handleCompleteSale}
          className={cn(
            'mt-2 flex w-full items-center justify-center gap-2 rounded-full py-6 text-lg font-semibold shadow-lg transition-all',
            canPay && !processing
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <Check className="h-5 w-5" />
          {processing ? (
            'Processing...'
          ) : (
            <span className="flex items-center gap-2">
              {balanceDue > 0 || paymentMethod === 'credit' ? 'Save Sale' : 'Pay'}{' '}
              <RollingNumber
                value={paidNow > 0 ? paidNow : totalDue}
                format={(v) => formatCurrency(v)}
              />
            </span>
          )}
        </motion.button>
        </div>
      </div>
    </AppShell>
  );
}
