import { useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCart } from '@/contexts/CartContext';
import { dexieDb, getProductByBarcode, getAllProducts, getAllCategories } from '@/lib/db';
import { getStockStatus } from '@/types/pos';
import type { Product, Category } from '@/types/pos';
import {
  Plus,
  Minus,
  ShoppingCart,
  Trash2,
  AlertTriangle,
  BarChart3,
  Coffee,
  Cookie,
  Home,
  Heart,
  Milk,
  Package,
  LayoutGrid,
  List,
  Bell,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useStore } from '@/contexts/StoreContext';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { useNavigate } from 'react-router-dom';
import { posNavigate } from '@/lib/posNavigate';
import { toast } from 'sonner';
import { BarcodeScannerDialog } from '@/components/pos/BarcodeScannerDialog';
import { RollingNumber } from '@/components/ui/rolling-number';
import PayoutDialog from '@/components/pos/PayoutDialog';
import { PosProductCard } from '@/components/pos/PosProductCard';
import { ProductImage, ProductImageBackground } from '@/components/ProductImage';
import { syncToVantage } from '@/lib/vantageSync';
import { computeSalesTax } from '@/lib/taxEngine';
import { useCustomerDisplayPublisher } from '@/hooks/useCustomerDisplayPublisher';
import { type CustomerDisplaySnapshot } from '@/lib/customerDisplay';

// Icon mapping for categories
const iconMap: Record<string, typeof Package> = {
  Coffee,
  Cookie,
  Home,
  Heart,
  Milk,
  Package,
};

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export default function POSPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(60);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const v = localStorage.getItem('pos:viewMode');
    return v === 'list' ? 'list' : 'grid';
  });

  const [recentAddId, setRecentAddId] = useState<string | null>(null);
  const recentAddTimerRef = useRef<number | null>(null);
  const [auditSyncing, setAuditSyncing] = useState(false);

  const [unitChoiceOpen, setUnitChoiceOpen] = useState(false);
  const [unitChoiceProduct, setUnitChoiceProduct] = useState<Product | null>(null);
  const [payoutOpen, setPayoutOpen] = useState(false);

  const { state, addItem, removeItem, updateQuantity, clearCart, itemCount, persistCartNow } = useCart();
  const { settings, company } = useSupabaseAuth();
  const { currentStoreId, currentStore, isGlobalView } = useStore();
  const navigate = useNavigate();

  const debouncedSearch = useDebouncedValue(searchQuery, 200);
  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();
  const { addNotification } = useNotification();
  const singleItemMarginPercent = settings?.singleItemMarginPercent ?? 0;

  // Mirror the live cart to the customer-facing display (second screen).
  const customerDisplaySnapshot = useMemo<CustomerDisplaySnapshot>(() => {
    const salesTax = computeSalesTax({
      settings,
      subtotal: state.subtotal,
      discount: state.discount,
    });
    return {
      type: 'cart-snapshot',
      status: 'active',
      storeName: currentStore?.name || settings?.shopName || 'Store',
      logoUrl: company?.logoUrl || undefined,
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
      itemCount,
      subtotalText: formatCurrency(state.subtotal),
      discountAmount: state.discount,
      discountText: formatCurrency(state.discount),
      taxLabel: salesTax.label,
      taxAmount: salesTax.taxAmount,
      taxText: formatCurrency(salesTax.taxAmount),
      totalText: formatCurrency(salesTax.totalWithTax),
      updatedAt: Date.now(),
    };
  }, [
    state.items,
    state.subtotal,
    state.discount,
    itemCount,
    settings,
    currentStore?.name,
    company?.logoUrl,
    formatCurrency,
  ]);

  useCustomerDisplayPublisher(customerDisplaySnapshot);

  const todayKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  const { startOfToday, endOfToday } = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { startOfToday: start, endOfToday: end };
  }, []);

  const todaySales = useLiveQuery(
    () => {
      const base = dexieDb.sales
        .where('createdAt')
        .between(startOfToday, endOfToday, true, true);

      if (isGlobalView) return base.toArray();
      return base.filter((s) => s.storeId === currentStoreId).toArray();
    },
    [currentStoreId, isGlobalView, startOfToday.getTime(), endOfToday.getTime()]
  );
  const todayRevenue = useMemo(
    () => (todaySales ?? []).reduce((sum, s) => sum + (s.total ?? 0), 0),
    [todaySales]
  );
  const todayTxCount = todaySales?.length ?? 0;

  const liveProducts = useLiveQuery(() => getAllProducts(currentStoreId), [currentStoreId]);
  const liveCategories = useLiveQuery(() => getAllCategories(currentStoreId), [currentStoreId]);
  const [products, setProducts] = useState<Product[] | undefined>(undefined);
  const [categories, setCategories] = useState<Category[] | undefined>(undefined);
  const productsPrimedRef = useRef(false);

  // Debounce catalog refresh so stock syncs don't freeze the grid mid-tap.
  useEffect(() => {
    productsPrimedRef.current = false;
    setProducts(undefined);
  }, [currentStoreId]);

  useEffect(() => {
    if (!liveProducts) return;
    if (!productsPrimedRef.current) {
      productsPrimedRef.current = true;
      setProducts(liveProducts);
      return;
    }
    const timer = window.setTimeout(() => setProducts(liveProducts), 150);
    return () => window.clearTimeout(timer);
  }, [liveProducts]);

  useEffect(() => {
    if (!liveCategories) return;
    setCategories(liveCategories);
  }, [liveCategories]);

  // Load data
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      // Demo seeding removed — skip demo data population
      setLoading(false);
    }
    loadData();
  }, []);

  // Pending orders are handled on Sales — do not attach cloud listeners on POS.
  useEffect(() => {
    if (window.location.hash === '#pending-orders') {
      window.history.replaceState(null, '', window.location.pathname);
      navigate('/sales');
    }
  }, [navigate]);

  // Filter products
  const filteredProducts = useMemo(() => {
    let result = products ?? [];

    if (selectedCategory) {
      result = result.filter((p) => p.categoryIds.includes(selectedCategory));
    }

    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.barcode.includes(debouncedSearch)
      );
    }

    return result;
  }, [products, selectedCategory, debouncedSearch]);

  // Reset lazy-loading when filter changes
  useEffect(() => {
    setVisibleCount(60);
  }, [selectedCategory, debouncedSearch]);

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleCount),
    [filteredProducts, visibleCount]
  );

  const priceLabelByProductId = useMemo(() => {
    const map = new Map<string, string>();
    for (const product of filteredProducts) {
      map.set(product.id, formatCurrency(product.sellingPrice));
    }
    return map;
  }, [filteredProducts, formatCurrency]);

  // Lazy-load more when reaching bottom
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    if (visibleCount >= filteredProducts.length) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => Math.min(filteredProducts.length, c + 60));
        }
      },
      { root: null, rootMargin: '400px', threshold: 0 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [filteredProducts.length, visibleCount]);

  // Barcode scan handler
  const handleBarcodeScan = useCallback(async () => {
    setScannerOpen(true);
  }, [addItem]);

  const bumpAddFx = useCallback((productId: string) => {
    setRecentAddId(productId);
    if (recentAddTimerRef.current) window.clearTimeout(recentAddTimerRef.current);
    recentAddTimerRef.current = window.setTimeout(() => setRecentAddId(null), 700);
  }, []);

  const handleDetectedBarcode = useCallback(
    async (barcode: string) => {
      const product = await getProductByBarcode(barcode, currentStoreId);
      if (product) {
        if (product.stock <= 0) {
          toast.error(`${product.name} is out of stock`);
          return;
        }
        addItem(product);
        bumpAddFx(product.id);
      } else {
        toast.error('Product not found');
      }
    },
    [addItem, bumpAddFx, currentStoreId]
  );

  const handleUnitChoice = (mode: 'box' | 'single') => {
    const product = unitChoiceProduct;
    if (!product) return;

    const unitsPerBulk = Math.max(1, product.unitsPerBulk ?? 1);
    const baseUnitPrice = product.sellingPrice / unitsPerBulk;
    const unitPrice =
      mode === 'single'
        ? baseUnitPrice * (1 + singleItemMarginPercent / 100)
        : baseUnitPrice;
    const quantity = mode === 'single' ? 1 : unitsPerBulk;

    addItem(product, quantity, Number(unitPrice.toFixed(2)));
    bumpAddFx(product.id);

    setUnitChoiceOpen(false);
    setUnitChoiceProduct(null);
  };

  // Checkout — save cart locally, then open payment screen. Never wait on cloud.
  const handleCheckout = () => {
    if (state.items.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    try {
      persistCartNow();
    } catch {
      /* ignore */
    }
    posNavigate(navigate, '/checkout');
  };

  const handleAuditSync = useCallback(async () => {
    if (auditSyncing) return;

    setAuditSyncing(true);
    try {
      await syncToVantage(todaySales ?? []);
    } finally {
      setAuditSyncing(false);
    }
  }, [auditSyncing, todaySales]);

  const cartQtyByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of state.items) {
      map.set(item.product.id, (map.get(item.product.id) || 0) + item.quantity);
    }
    return map;
  }, [state.items]);

  const defaultLineByProductId = useMemo(() => {
    const map = new Map<string, { lineId: string; quantity: number }>();
    for (const item of state.items) {
      const unit = item.unitPrice ?? item.product.sellingPrice;
      if (unit === item.product.sellingPrice && !map.has(item.product.id)) {
        map.set(item.product.id, { lineId: item.lineId, quantity: item.quantity });
      }
    }
    return map;
  }, [state.items]);

  const getItemQuantityInCart = (productId: string): number => cartQtyByProductId.get(productId) || 0;

  const shouldPromptUnitChoice = useCallback((product: Product) => {
    const unitsPerBulk = product.unitsPerBulk ?? 1;
    const stockUnit = product.stockUnit ?? 'individual';
    return unitsPerBulk > 1 && stockUnit === 'individual';
  }, []);

  const addWithUnitChoiceIfNeeded = useCallback(
    (product: Product) => {
      if (shouldPromptUnitChoice(product)) {
        setUnitChoiceProduct(product);
        setUnitChoiceOpen(true);
        return;
      }
      addItem(product);
      bumpAddFx(product.id);
    },
    [addItem, bumpAddFx, shouldPromptUnitChoice]
  );

  const incrementProduct = useCallback(
    (product: Product) => {
      addItem(product);
      bumpAddFx(product.id);
    },
    [addItem, bumpAddFx]
  );

  const getProductTotalInCart = (productId: string): number =>
    state.items
      .filter((i) => i.product.id === productId)
      .reduce((sum, i) => sum + (i.unitPrice ?? i.product.sellingPrice) * i.quantity, 0);

  return (
    <>
    <AppShell
      showSearch
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      onBarcodeClick={handleBarcodeScan}
      onCartClick={() => setCartOpen(true)}
    >
      <div className="flex flex-col gap-4 px-3 md:px-4 md:flex-row w-full overflow-x-hidden">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Today's summary */}
          <section>
            <Card className="border-primary/20 bg-primary/5">
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Today</p>
                  <div className="flex items-baseline gap-2">
                    <RollingNumber
                      value={todayRevenue}
                      format={(v) => formatCurrency(v)}
                      className="text-lg font-bold"
                    />
                    <span className="text-xs text-muted-foreground">({todayTxCount} tx)</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => navigate(`/sales?date=${encodeURIComponent(todayKey)}`)}
                >
                  <BarChart3 className="h-4 w-4" />
                  Sales
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden md:inline-flex"
                  onClick={() => void handleAuditSync()}
                  disabled={auditSyncing}
                  title={auditSyncing ? 'Syncing audit data' : 'Manual Audit Sync'}
                >
                  {auditSyncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Bell className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </Card>
          </section>

          {/* Categories */}
          <section>
          <div className="flex gap-2 overflow-x-auto pb-2 touch-scroll">
            <Button
              variant={selectedCategory === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(null)}
              className="shrink-0"
            >
              All
            </Button>
            {(categories ?? []).map((cat) => {
              const Icon = iconMap[cat.icon] || Package;
              return (
                <Button
                  key={cat.id}
                  variant={selectedCategory === cat.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(cat.id)}
                  className="shrink-0 gap-2"
                >
                  <Icon className="h-4 w-4" />
                  {cat.name}
                </Button>
              );
            })}
          </div>
          </section>

          {/* View Toggle */}
          <div className="flex items-center justify-end gap-2">
            <div className="flex items-center gap-2">
            <Button
              variant={viewMode === 'list' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => {
                setViewMode('list');
                localStorage.setItem('pos:viewMode', 'list');
              }}
              title="List view"
            >
              <List className="h-5 w-5" />
            </Button>
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => {
                setViewMode('grid');
                localStorage.setItem('pos:viewMode', 'grid');
              }}
              title="Grid view"
            >
              <LayoutGrid className="h-5 w-5" />
            </Button>
            </div>
          </div>

          {/* Product Grid */}
          <section className="flex-1">
          {loading || !products || !categories ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Card key={i} className="h-32 animate-pulse bg-muted" />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-lg font-medium text-muted-foreground">No products found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery ? 'Try a different search term' : 'Add products in the admin panel'}
              </p>
            </div>
          ) : (
            <div
              className={cn(
                viewMode === 'list'
                  ? 'grid grid-cols-1 gap-2 w-full max-w-full'
                  : 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 items-stretch w-full max-w-full'
              )}
            >
              {visibleProducts.map((product) => {
                const defaultLine = defaultLineByProductId.get(product.id);
                return (
                  <PosProductCard
                    key={product.id}
                    product={product}
                    quantityInCart={getItemQuantityInCart(product.id)}
                    viewMode={viewMode}
                    priceLabel={priceLabelByProductId.get(product.id) ?? formatCurrency(product.sellingPrice)}
                    needsUnitChoice={shouldPromptUnitChoice(product)}
                    showAddFx={recentAddId === product.id}
                    onAdd={addWithUnitChoiceIfNeeded}
                    onIncrement={incrementProduct}
                    onDecrement={updateQuantity}
                    defaultLineId={defaultLine?.lineId ?? null}
                    defaultLineQty={defaultLine?.quantity ?? 0}
                  />
                );
              })}
            </div>
          )}
            {!loading && filteredProducts.length > visibleCount && (
              <div ref={loadMoreRef} className="h-10" />
            )}
          </section>

          {/* Floating Cart Summary (mobile only) */}
          {itemCount > 0 && (
            <div className="fixed left-3 right-3 z-40 md:hidden" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4.5rem)' }}>
                <Button
                  size="lg"
                  onClick={() => setCartOpen(true)}
                  className="w-full gap-3 shadow-lg"
                >
                <ShoppingCart className="h-5 w-5" />
                <span className="flex-1 text-left">
                  {itemCount} item{itemCount !== 1 ? 's' : ''}
                </span>
                <RollingNumber
                  value={state.total}
                  format={(v) => formatCurrency(v)}
                  className="font-bold"
                />
              </Button>
            </div>
          )}
        </div>

        {/* Cart Sidebar (md+) — pin Checkout actions so they stay clickable */}
        <aside className="hidden w-full max-w-sm shrink-0 md:block">
          <Card className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden">
            <div className="shrink-0 border-b p-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                <p className="font-semibold">Cart</p>
                <span className="text-sm text-muted-foreground">({itemCount})</span>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {state.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Your cart is empty</p>
              ) : (
                <div className="space-y-3">
                  {state.items.map((item) => (
                    <div
                      key={item.lineId}
                      className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-2xl bg-primary/10">
                          <ProductImage
                            productId={item.product.id}
                            localImageUrl={item.product.imageUrl || item.product.image}
                            storeId={item.product.storeId}
                            alt={item.product.name}
                            className="h-full w-full object-cover"
                            placeholderText={item.product.name.charAt(0).toUpperCase()}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{item.product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatCurrency(item.unitPrice ?? item.product.sellingPrice)} each
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(item.lineId)}
                          className="shrink-0 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => updateQuantity(item.lineId, item.quantity - 1)}
                            className="h-8 w-8"
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => updateQuantity(item.lineId, item.quantity + 1)}
                            disabled={getItemQuantityInCart(item.product.id) >= item.product.stock}
                            className="h-8 w-8"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-sm font-semibold">
                          {formatCurrency((item.unitPrice ?? item.product.sellingPrice) * item.quantity)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {state.items.length > 0 && (
              <div className="relative z-20 shrink-0 space-y-3 border-t bg-background p-4">
                <div className="flex items-center justify-between text-lg font-bold">
                  <span>Total</span>
                  <RollingNumber value={state.total} format={(v) => formatCurrency(v)} />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPayoutOpen(true)}
                    className="flex-1"
                  >
                    Payout
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => clearCart()}
                    className="flex-1"
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCheckout();
                    }}
                    className="relative z-20 flex-1"
                  >
                    Checkout
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </aside>

      </div>

      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onDetected={handleDetectedBarcode}
      />

      <AlertDialog open={unitChoiceOpen} onOpenChange={setUnitChoiceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sell how?</AlertDialogTitle>
            <AlertDialogDescription>
              {unitChoiceProduct?.name}
              {unitChoiceProduct?.unitsPerBulk
                ? ` — Whole box (${unitChoiceProduct.unitsPerBulk}) or single piece?`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setUnitChoiceProduct(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => handleUnitChoice('single')}>
              Single Piece
            </AlertDialogAction>
            <AlertDialogAction onClick={() => handleUnitChoice('box')}>
              Whole Box
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cart Sheet (mobile only) */}
      <div className="md:hidden">
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
          <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Cart ({itemCount} items)
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto py-4">
            {state.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ShoppingCart className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">Your cart is empty</p>
              </div>
            ) : (
              <div className="space-y-3">
                {state.items.map((item) => (
                  <Card key={item.lineId} className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-primary/10">
                        <ProductImage
                          productId={item.product.id}
                          localImageUrl={item.product.imageUrl || item.product.image}
                          storeId={item.product.storeId}
                          alt={item.product.name}
                          className="h-full w-full object-cover"
                          placeholderText={item.product.name.charAt(0).toUpperCase()}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug">{item.product.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(item.unitPrice ?? item.product.sellingPrice)} each
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(item.lineId)}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-2 py-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => updateQuantity(item.lineId, item.quantity - 1)}
                          className="h-8 w-8"
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-10 text-center font-semibold">{item.quantity}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => updateQuantity(item.lineId, item.quantity + 1)}
                          disabled={getItemQuantityInCart(item.product.id) >= item.product.stock}
                          className="h-8 w-8"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatCurrency((item.unitPrice ?? item.product.sellingPrice) * item.quantity)}</p>
                        <p className="text-xs text-muted-foreground">Total</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {state.items.length > 0 && (
            <SheetFooter className="flex-col gap-3 border-t pt-4">
              <div className="flex items-center justify-between text-lg font-bold">
                <span>Total</span>
                <RollingNumber value={state.total} format={(v) => formatCurrency(v)} />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    clearCart();
                    setCartOpen(false);
                  }}
                  className="flex-1"
                >
                  Clear
                </Button>
                <Button
                  onClick={() => {
                    setCartOpen(false);
                    handleCheckout();
                  }}
                  className="flex-1"
                >
                  Checkout
                </Button>
              </div>
            </SheetFooter>
          )}
          </SheetContent>
        </Sheet>
      </div>
    </AppShell>

      <PayoutDialog open={payoutOpen} onOpenChange={setPayoutOpen} />
    </>
  );
}
