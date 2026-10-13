import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { useCart } from '@/contexts/CartContext';
import { dexieDb } from '@/lib/db';
import { supabase, isSupabaseConfigured, SupabaseStore } from '@/lib/supabase';
import { getStockStatus } from '@/types/pos';
import type { Product, Category } from '@/types/pos';
import {
  Plus,
  Minus,
  ShoppingCart,
  Trash2,
  AlertTriangle,
  Package,
  LayoutGrid,
  List,
  Home,
  Share2,
  PauseCircle,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { cn } from '@/lib/utils';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { toast } from 'sonner';
import { RollingNumber } from '@/components/ui/rolling-number';
import { ProductImage } from '@/components/ProductImage';
import { GuestCheckoutForm } from '@/components/pos/GuestCheckoutForm';
import { mapSupabaseRowToProduct } from '@/lib/sync';
import {
  fetchStoreHostStatus,
  getCustomerShopMessage,
  isCustomerShopOpen,
  type StoreHostStatus,
} from '@/lib/hostStatus';

interface GuestShopPageProps {
  storeId: string;
}

export default function GuestShopPage({ storeId }: GuestShopPageProps) {
  const { storeID } = useParams<{ storeID: string; slug?: string }>();
  const finalStoreId = storeId || storeID;

  const { state: cartState, addItem, removeItem, updateQuantity } = useCart();
  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();

  // Fetch store info
  const [store, setStore] = useState<SupabaseStore | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);

  // Products and categories
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // UI state
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [storeHostStatus, setStoreHostStatus] = useState<StoreHostStatus | null>(null);

  const shopOrdersOpen = storeHostStatus ? storeHostStatus.shopOpen : true;
  const shopStatusMessage =
    storeHostStatus?.message ||
    getCustomerShopMessage(storeHostStatus?.hostStatus, storeHostStatus?.hostStatusReason);

  // PWA Install Prompt
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  // Load store info, products, and categories
  useEffect(() => {
    const loadStoreInfo = async () => {
      setStoreLoading(true);
      setStore(null);
      setProducts([]);
      setCategories([]);

      try {
        if (!finalStoreId) {
          setStoreLoading(false);
          return;
        }

        let foundStore = null;
        let cloudProducts: Product[] = [];

        // Prefer live Supabase catalog (real source of truth for online shop)
        if (isSupabaseConfigured()) {
          try {
            const { data, error } = await supabase.from('stores').select('*').eq('id', finalStoreId).single();
            if (!error && data) {
              foundStore = data;
              try {
                if (data.phone) localStorage.setItem('shop_phone', String(data.phone));
              } catch {
                /* ignore */
              }
            }

            const { data: prodData, error: prodErr } = await supabase
              .from('products')
              .select('*')
              .eq('store_id', finalStoreId);

            if (!prodErr && prodData) {
              cloudProducts = prodData.map((row: any) => mapSupabaseRowToProduct(row, finalStoreId));
              setProducts(cloudProducts);
            } else if (prodErr) {
              console.warn('Supabase product fetch failed for guest store:', prodErr);
              toast.error('Could not load live products from cloud');
            }

            const { data: catData, error: catErr } = await supabase
              .from('categories')
              .select('*')
              .eq('store_id', finalStoreId);

            if (!catErr && catData) {
              setCategories(
                catData.map((c) => ({
                  id: c.id,
                  name: c.name,
                  icon: c.icon,
                  color: c.color,
                  order: c.display_order,
                  createdAt: new Date(c.created_at),
                }))
              );
            } else if (catErr) {
              console.warn('Supabase category fetch failed for guest store:', catErr);
            }
          } catch (supabaseError) {
            console.log('Supabase lookup failed, trying local DB:', supabaseError);
          }
        }

        // If the store could not be loaded from Supabase, try local Dexie as a fallback
        if (!foundStore) {
          try {
            const localStores = await dexieDb.stores.where('id').equals(finalStoreId).first();
            if (localStores) {
              foundStore = localStores;
            }
          } catch (dbError) {
            console.log('Local DB lookup failed:', dbError);
          }
        }

        // Local Dexie only if cloud returned nothing (same-PC demo)
        if (cloudProducts.length === 0) {
          try {
            const p = await dexieDb.products.where('storeId').equals(foundStore?.id || finalStoreId).toArray();
            if (p.length) setProducts(p);
          } catch (e) {
            console.warn('Local product fallback failed for guest store:', e);
          }
        }

        if (foundStore) {
          setStore(foundStore);
        }

        if (finalStoreId) {
          const host = await fetchStoreHostStatus(finalStoreId);
          if (host) {
            setStoreHostStatus(host);
          } else if (foundStore?.company_id) {
            try {
              const localCompany = await dexieDb.companies.get(String(foundStore.company_id));
              if (localCompany) {
                const open = isCustomerShopOpen(localCompany.hostStatus);
                setStoreHostStatus({
                  hostStatus: localCompany.hostStatus || 'active',
                  hostStatusReason: localCompany.hostStatusReason,
                  shopOpen: open,
                  message: getCustomerShopMessage(
                    localCompany.hostStatus,
                    localCompany.hostStatusReason
                  ),
                  companyName: localCompany.name,
                });
              }
            } catch {
              /* ignore */
            }
          }
        }
      } catch (error) {
        console.error('Failed to load store:', error);
      } finally {
        setStoreLoading(false);
      }
    };

    loadStoreInfo();
  }, [finalStoreId]);

  // Marketplace realtime: listen for product/promotions and order status updates for the customer's recent order
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    if (!finalStoreId) return;

    // Listen for new products for this store (show soft promo in the guest shop)
    const channel = supabase
      .channel('marketplace-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'products' }, (payload: any) => {
        const newRow = payload.new;
        if (!newRow) return;
        if (String(newRow.store_id) !== String(finalStoreId)) return;
        // Small non-intrusive toast for guest
        try {
          toast(`${newRow.name} just added to the shop!`, { duration: 6000 });
        } catch (e) {}
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'online_orders' }, (payload: any) => {
        try {
          const newRow = payload.new;
          const lastOrderId = localStorage.getItem('last_online_order_id');
          if (!lastOrderId) return;
          if (String(newRow.id) !== String(lastOrderId)) return;

          // Notify customer when payment approved/completed (cloud may use delivered/paid lowercase)
          const status = String(newRow.status || '').toUpperCase();
          const payStatus = String(newRow.payment_status || '').toUpperCase();
          if (
            status === 'COMPLETED' ||
            status === 'APPROVED' ||
            status === 'DELIVERED' ||
            status === 'CONFIRMED' ||
            payStatus === 'PAID'
          ) {
            try {
              const audio = new Audio('/sounds/notify.mp3');
              audio.play().catch(() => {});
            } catch {}
            toast.success('Your payment has been approved — we are processing your order.', {
              duration: 10000,
              action: {
                label: 'Call Shop',
                onClick: () => {
                  const phone = newRow.store_phone || (newRow.store?.phone) || (newRow.store_phone ?? null) || localStorage.getItem('shop_phone');
                  if (phone) window.location.href = `tel:${phone}`;
                },
              },
            });
          }
        } catch (e) {
          console.warn('Marketplace online_orders listener error', e);
        }
      })
      .subscribe();

    return () => {
      try { channel.unsubscribe(); } catch (e) {}
    };
  }, [finalStoreId]);

  // Handle PWA install prompt
  useEffect(() => {
    // Detect iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowInstallBanner(true);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setShowInstallBanner(false);
    };

    // Show install banner for iOS or when beforeinstallprompt fires
    if (iOS) {
      // For iOS, show banner after a short delay to avoid being too intrusive
      setTimeout(() => setShowInstallBanner(true), 3000);
    } else {
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.addEventListener('appinstalled', handleAppInstalled);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Load categories
  useEffect(() => {
    const loadCategories = async () => {
      try {
        if (!finalStoreId) return;

        let foundCats: any[] = [];
        if (isSupabaseConfigured()) {
          try {
            const { data, error } = await supabase
              .from('categories')
              .select('*')
              .eq('store_id', finalStoreId)
              .order('display_order', { ascending: true });

            if (!error && data) {
              foundCats = data.map((c: any) => ({
                id: c.id,
                name: c.name,
                icon: c.icon || 'Package',
                color: c.color || '#999999',
                order: c.display_order || 0,
                createdAt: new Date(c.created_at),
              }));
            }
          } catch(e) {}
        }
        
        // Fallback to Dexie only if Supabase is unavailable
        if (foundCats.length === 0 && !isSupabaseConfigured()) {
          try {
            const localCats = await dexieDb.categories.toArray();
            foundCats = localCats.filter(c => c.storeId === finalStoreId || !c.storeId);
          } catch(e) {
            console.warn('Local category fallback failed for guest store:', e);
          }
        }
        setCategories(foundCats);
      } catch (error) {
        console.error('Failed to load categories:', error);
      }
    };

    loadCategories();
  }, [finalStoreId]);

  // Filter products by category and search
  const filteredProducts = useMemo(() => {
    let result = products || [];
    if (selectedCategory) {
      result = result.filter(p => p.categoryIds && p.categoryIds.includes(selectedCategory));
    }
    if (searchQuery) {
      result = result.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return result;
  }, [products, selectedCategory, searchQuery]);

  // Calculate totals
  const itemCount = cartState.items.reduce((sum, item) => sum + item.quantity, 0);

  // Handle adding item (with quantity increment)
  const handleAddItem = (product: Product) => {
    if (!shopOrdersOpen) {
      toast.error(shopStatusMessage || 'This shop is not accepting orders right now.');
      return;
    }
    addItem(product, 1);
    toast.success(`Added ${product.name} to cart`, { duration: 2000 });
  };

  const handleQuantityChange = (lineId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(lineId);
    } else {
      updateQuantity(lineId, quantity);
    }
  };

  const handleInstallApp = async () => {
    if (isIOS) {
      // For iOS, show instructions
      alert(`To install ${store.name} to your iPhone screen:\n\n1. Tap the Share button (📤) at the bottom of Safari\n2. Scroll down and tap "Add to Home Screen" (➕)\n3. Tap "Add" at the top right\n\nThe shop app will now appear on your home screen!`);
      setShowInstallBanner(false);
      return;
    }

    if (!installPrompt) return;

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowInstallBanner(false);
      }
    } catch (error) {
      console.error('Install prompt failed:', error);
    }
    setInstallPrompt(null);
  };

  const handleDismissInstall = () => {
    setShowInstallBanner(false);
  };

  const openCart = () => {
    if (!shopOrdersOpen) {
      toast.error(shopStatusMessage || 'This shop is not accepting orders right now.');
      return;
    }
    setCartSheetOpen(true);
  };

  const [isGeneratingFlyer, setIsGeneratingFlyer] = useState(false);

  const handleShareStore = async () => {
    if (!store) return;
    try {
      setIsGeneratingFlyer(true);
      toast.info('Generating catalog flyer...', { duration: 2000 });
      const flyerEl = document.getElementById('store-flyer-capture');
      if (flyerEl) {
        // Unhide it momentarily to capture
        flyerEl.style.visibility = 'hidden';
        flyerEl.style.display = 'block';
        const canvas = await html2canvas(flyerEl, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
        });
        flyerEl.style.display = 'none';

        const shopUrl = window.location.href;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

        if (!blob) {
          toast.error('Failed to generate picture');
          return;
        }

        const file = new File([blob], `${store.name}-catalog.png`, { type: 'image/png' });
        const shareData: any = {
          title: store.name,
          text: `Check out products from ${store.name}! Order here: ${shopUrl}`,
        };

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          shareData.files = [file];
        }

        if (navigator.share) {
          try {
            await navigator.share(shareData);
            return;
          } catch (shareError) {
            console.warn('Native share failed:', shareError);
          }
        }

        toast.success('Picture downloaded! Ready to share on WhatsApp.', { duration: 4000 });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${store.name}-catalog.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setTimeout(() => {
          window.open(
            `https://wa.me/?text=${encodeURIComponent(`Check out products from ${store.name}! Order here: ${shopUrl}`)}`,
            '_blank'
          );
        }, 1000);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to prepare sharing poster');
    } finally {
      setIsGeneratingFlyer(false);
    }
  };

  if (storeLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-lg text-gray-600">Loading store...</div>
      </div>
    );
  }

  if (!finalStoreId || !store) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto" />
          <div className="text-lg text-gray-600">Store not found</div>
          <p className="text-sm text-gray-500">The store you're looking for doesn't exist.</p>
          <Button variant="outline" onClick={() => window.history.back()}>
            <Home className="mr-2 h-4 w-4" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {!shopOrdersOpen && (
        <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mx-auto flex max-w-4xl items-start gap-3 text-amber-950">
            <PauseCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">
                {storeHostStatus?.hostStatus === 'removed' ? 'Shop unavailable' : 'Shop paused'}
              </p>
              <p className="text-sm">{shopStatusMessage}</p>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center justify-between w-full sm:w-auto">
              <div>
                <h1 className="text-2xl font-bold">{store.name}</h1>
                <p className="text-sm text-gray-600">{store.location_name || store.address}</p>
              </div>
              
              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleShareStore}
                  disabled={isGeneratingFlyer}
                  className="text-blue-600 sm:hidden"
                >
                  <Share2 className="h-5 w-5" />
                </Button>

                <Button
                  onClick={openCart}
                  className="relative flex sm:hidden shrink-0"
                  size="sm"
                  variant="outline"
                  disabled={!shopOrdersOpen}
                >
                  <ShoppingCart className="h-5 w-5" />
                  {itemCount > 0 && (
                    <Badge className="absolute -top-2 -right-2 bg-red-500 h-5 w-5 text-[10px] flex items-center justify-center p-0">
                      {itemCount}
                    </Badge>
                  )}
                </Button>
              </div>
            </div>
            
            <div className="w-full flex-1 sm:max-w-md flex gap-2">
              <Input 
                type="text" 
                placeholder="Search products..." 
                value={searchQuery}
                // @ts-ignore
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleShareStore}
                disabled={isGeneratingFlyer}
                className="hidden sm:flex text-blue-600"
                title="Share Shop via WhatsApp"
              >
                <Share2 className="h-4 w-4" />
              </Button>
            </div>
            
            <Button
              onClick={openCart}
              className="relative hidden sm:flex shrink-0"
              size="lg"
              disabled={!shopOrdersOpen}
            >
              <ShoppingCart className="h-5 w-5" />
              {itemCount > 0 && (
                <Badge className="absolute -top-2 -right-2 bg-red-500 h-6 w-6 flex items-center justify-center p-0">
                  {itemCount}
                </Badge>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Install App Banner */}
      {showInstallBanner && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-blue-600">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-blue-900">
                  {isIOS ? `Add ${store.name} to iPhone` : `Install ${store.name} App`}
                </p>
                <p className="text-xs text-blue-700">
                  {isIOS
                    ? 'Tap the Share button 📤 below, then "Add to Home Screen" ➕'
                    : 'Get the full experience with offline access and notifications'
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleInstallApp}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isIOS ? 'How to Add' : 'Install'}
              </Button>
              <Button
                onClick={handleDismissInstall}
                variant="ghost"
                size="sm"
                className="text-blue-600 hover:text-blue-800"
              >
                ×
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={cn('max-w-4xl mx-auto px-4 py-6', !shopOrdersOpen && 'opacity-60')}>
        {/* Categories */}
        {categories.length > 0 && (
          <div className="mb-6 overflow-x-auto">
            <div className="flex gap-2 pb-2">
              <Button
                variant={selectedCategory === null ? 'default' : 'outline'}
                onClick={() => setSelectedCategory(null)}
                className="whitespace-nowrap"
              >
                All Products
              </Button>
              {categories.map((cat) => (
                <Button
                  key={cat.id}
                  variant={selectedCategory === cat.id ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory(cat.id)}
                  className="whitespace-nowrap"
                >
                  {cat.name}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* View Mode Toggle */}
        <div className="flex justify-end gap-2 mb-4">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>

        {/* Products */}
        {filteredProducts.length === 0 ? (
          <div className="text-center py-12">
            <Package className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No products available</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredProducts.map((product) => {
              const stockStatus = getStockStatus(product);
              const isOutOfStock = stockStatus === 'out-of-stock';

              return (
                <Card
                  key={product.id}
                  className={cn(
                    'h-full flex flex-col overflow-hidden transition-all hover:shadow-lg',
                    isOutOfStock && 'opacity-50'
                  )}
                >
                  {/* Product Image */}
                  <div className="h-32 bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center overflow-hidden">
                    <ProductImage
                      productId={product.id}
                      localImageUrl={product.imageUrl}
                      storeId={finalStoreId}
                      alt={product.name}
                      className="h-full w-full object-cover"
                      showPlaceholder={false}
                    />
                    {!product.imageUrl && (
                      <div className="flex items-center justify-center h-full">
                        <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Product Info */}
                  <div className="flex-1 p-3 flex flex-col">
                    <h3 className="font-semibold text-sm line-clamp-2">{product.name}</h3>

                    <div className="mt-1 mb-auto">
                      <p className="text-lg font-bold text-blue-600">
                        {currencySymbol}
                        {Number(product.sellingPrice).toFixed(2)}
                      </p>

                      {stockStatus === 'low-stock' && (
                        <Badge variant="secondary" className="mt-1 text-xs">
                          Low Stock
                        </Badge>
                      )}
                      {isOutOfStock && (
                        <Badge variant="destructive" className="mt-1 text-xs">
                          Out of Stock
                        </Badge>
                      )}
                    </div>

                    {/* Add Button */}
                    <Button
                      size="sm"
                      onClick={() => handleAddItem(product)}
                      disabled={isOutOfStock}
                      className="w-full mt-2"
                    >
                      {isOutOfStock ? (
                        'Out of Stock'
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-1" />
                          Add
                        </>
                      )}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredProducts.map((product) => {
              const stockStatus = getStockStatus(product);
              const isOutOfStock = stockStatus === 'out-of-stock';

              return (
                <Card
                  key={product.id}
                  className={cn(
                    'p-4 flex items-center justify-between',
                    isOutOfStock && 'opacity-50'
                  )}
                >
                  <div className="flex-1">
                    <h3 className="font-semibold">{product.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-lg font-bold text-blue-600">
                        {currencySymbol}
                        {Number(product.sellingPrice).toFixed(2)}
                      </p>
                      {stockStatus === 'low-stock' && (
                        <Badge variant="secondary" className="text-xs">
                          Low Stock
                        </Badge>
                      )}
                      {isOutOfStock && (
                        <Badge variant="destructive" className="text-xs">
                          Out of Stock
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => handleAddItem(product)}
                    disabled={isOutOfStock}
                  >
                    {isOutOfStock ? (
                      'Out of Stock'
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart Sheet */}
      <Sheet open={cartSheetOpen} onOpenChange={setCartSheetOpen}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Your Cart</SheetTitle>
          </SheetHeader>

          {cartState.items.length === 0 ? (
            <div className="py-12 text-center">
              <ShoppingCart className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">Your cart is empty</p>
            </div>
          ) : (
            <div className="py-6 space-y-4">
              {/* Items */}
              {cartState.items.map((item) => (
                <div key={item.lineId} className="border rounded-lg p-3">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-semibold flex-1">{item.product.name}</h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(item.lineId)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {currencySymbol}
                      {Number(item.unitPrice ?? item.product.sellingPrice).toFixed(2)} each
                    </p>

                    <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleQuantityChange(item.lineId, item.quantity - 1)}
                        className="h-6 w-6 p-0"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleQuantityChange(item.lineId, item.quantity + 1)}
                        className="h-6 w-6 p-0"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex justify-end mt-2">
                    <p className="font-semibold">
                      {currencySymbol}
                      {Number((item.unitPrice ?? item.product.sellingPrice) * item.quantity).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}

              {/* Totals */}
              <div className="border-t pt-4 space-y-2">
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

                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <RollingNumber value={cartState.total} format={(v) => `${currencySymbol}${v.toFixed(2)}`} />
                </div>
              </div>
            </div>
          )}

          <SheetFooter className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setCartSheetOpen(false)}
            >
              Continue Shopping
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                if (!shopOrdersOpen) {
                  toast.error(shopStatusMessage || 'This shop is not accepting orders right now.');
                  return;
                }
                setCartSheetOpen(false);
                setCheckoutOpen(true);
              }}
              disabled={cartState.items.length === 0 || !shopOrdersOpen}
            >
              Checkout
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Guest Checkout Form */}
      <GuestCheckoutForm
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        onOrderCreated={() => {
          setCartSheetOpen(false);
        }}
        store={store}
        storeId={finalStoreId}
      />
      <div className="max-w-4xl mx-auto px-4">
        <footer
          role="contentinfo"
          className="mt-6 border-t bg-gradient-to-r from-white via-blue-50 to-white text-center py-3 text-sm text-gray-700"
        >
          <div className="max-w-4xl mx-auto px-4 flex items-center justify-center gap-3">
            <span className="text-gray-600">Powered by</span>

            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="text-blue-700 font-semibold hover:text-blue-800"
              aria-label="Mthunzi-Tech-Labs"
            >
              Mthunzi-Tech-Labs
            </a>

            <span className="text-gray-400">|</span>

            <a
              href="tel:0979171520"
              className="inline-flex items-center gap-2 bg-blue-600 text-white text-xs font-medium px-3 py-1 rounded-full hover:bg-blue-700"
              aria-label="Call Mthunzi-Tech-Labs"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5h2l2 5-2 2 4 4 2-2 5 2v2a2 2 0 0 1-2 2C7.373 22 2 16.627 2 9a2 2 0 0 1 1-1z" />
              </svg>
              0979171520
            </a>
          </div>
        </footer>
      </div>

      {/* Hidden Flyer Generator for Sharing */}
      <div 
        id="store-flyer-capture"
        style={{ 
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          width: '600px', 
          backgroundColor: '#fff',
          padding: '24px',
          display: 'none',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px', borderBottom: '2px solid #f3f4f6', paddingBottom: '16px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 8px 0' }}>{store.name}</h1>
          <p style={{ fontSize: '18px', color: '#6b7280', margin: '0' }}>{store.location_name || store.address}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {products && products.slice(0, 6).map((p) => {
            const imgSource = p.imageUrl || p.image;
            return (
            <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px', background: '#f9fafb' }}>
              {imgSource && <img src={imgSource} alt={p.name} crossOrigin="anonymous" style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '4px', marginBottom: '8px' }} />}
              {!imgSource && <div style={{ width: '100%', height: '120px', background: '#e5e7eb', borderRadius: '4px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>No Image</div>}
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', margin: '0 0 4px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</h3>
                <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#2563eb', margin: '0' }}>{currencySymbol}{p.sellingPrice.toFixed(2)}</p>
              </div>
            </div>
            );
          })}
        </div>

        <div style={{ marginTop: '24px', textAlign: 'center', background: '#eef2ff', padding: '16px', borderRadius: '8px' }}>
          <p style={{ fontSize: '20px', fontWeight: '600', color: '#1e40af', margin: '0 0 8px 0' }}>Shop online now!</p>
          <p style={{ fontSize: '14px', color: '#4338ca', margin: '0' }}>Scan or visit our link to place your order directly.</p>
          <div style={{ marginTop: '12px', display: 'inline-block', background: '#2563eb', color: '#fff', padding: '8px 16px', borderRadius: '24px', fontWeight: 'bold' }}>
            Powered by Mthunzi-POS
          </div>
        </div>
      </div>

    </div>
  );
}
