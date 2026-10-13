import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { dexieDb, getSettings, saveSettings } from '@/lib/db';
import { pullProductsFromSupabase, pullSalesFromSupabase } from '@/lib/sync';
import { useStore } from '@/contexts/StoreContext';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { getPublicStores, getStoreByCode } from '@/lib/storeManagement';
import { getCompanyByOwnerPhone } from '@/lib/companyManagement';
import { downloadAllStoreImages } from '@/lib/productImageStorage';
import type { SupabaseStore } from '@/lib/supabase';
import type { Store as StoreType } from '@/types/pos';
import { Loader2 } from 'lucide-react';

function normalizeStoreCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export default function JoinStorePage() {
  const { setCurrentStoreId } = useStore();
  const { refreshSettings } = useSupabaseAuth();
  const [storeCode, setStoreCode] = useState('');
  const [availableStores, setAvailableStores] = useState<SupabaseStore[]>([]);
  const [publicStores, setPublicStores] = useState<StoreType[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStores, setLoadingStores] = useState(true);
  const [joinedStores, setJoinedStores] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState<StoreType | null>(null);
  const navigate = useNavigate();
  const [storeLoadError, setStoreLoadError] = useState<string | null>(null);

  // Load available stores from Supabase for the signed-in owner only.
  useEffect(() => {
    loadAvailableStores();
    loadPublicStores();
    loadJoinedStores();
  }, []);

  const loadAvailableStores = async () => {
    try {
      setLoadingStores(true);
      setStoreLoadError(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error('Error checking user auth:', userError);
        setStoreLoadError('Unable to verify user session');
        return;
      }

      const uid = userData?.user?.id;

      if (!uid) {
        setAvailableStores([]);
        return;
      }

      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('owner_id', uid)
        .order('name');

      if (error) {
        console.error('Error loading stores:', error);
        setStoreLoadError(error.message || 'Unable to load stores');
        toast.error(`Failed to load available stores: ${error.message || 'Please try again.'}`);
        return;
      }

      setAvailableStores(data || []);
    } catch (err) {
      console.error('Error:', err);
      const message = (err as Error)?.message || 'Unable to load stores';
      setStoreLoadError(message);
      toast.error(`Failed to load stores: ${message}`);
    } finally {
      setLoadingStores(false);
    }
  };

  const loadPublicStores = async () => {
    try {
      const stores = await getPublicStores();
      setPublicStores(stores);
    } catch (error: any) {
      console.error('Failed to load public stores:', error);
      // Show user-friendly error
      if (error?.message?.includes('infinite recursion') || error?.message?.includes('RLS policy')) {
        setStoreLoadError('Supabase RLS policy error: Please fix your Supabase Row Level Security policies to allow public access to stores.');
        toast.error('Supabase configuration error: Contact your administrator to fix RLS policies.');
      } else {
        setStoreLoadError(error?.message || 'Unable to load stores');
        toast.error('Unable to load stores. Please check your internet connection.');
      }
    } finally {
      setLoadingStores(false);
    }
  };

  const loadJoinedStores = () => {
    const joined = JSON.parse(localStorage.getItem('mthunzi_joined_stores') || '[]');
    setJoinedStores(joined);
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedCode = normalizeStoreCode(storeCode);
    if (!normalizedCode) {
      toast.error('Please enter a store code');
      return;
    }

    if (!/^SHOP-[A-Z0-9]{5}$/.test(normalizedCode)) {
      toast.error('Invalid store code format. It should look like SHOP-ABCDE');
      return;
    }

    setLoading(true);
    try {
      const store = await getStoreByCode(normalizedCode);

      if (!store) {
        toast.error('Store code not found. Please check and try again. If the store is private, ask the owner to make it public or log in as the store owner.');
        return;
      }

      await selectStore(store);
    } catch (err: any) {
      console.error('Error:', err);
      // Check for specific Supabase policy errors
      if (err?.message?.includes('infinite recursion') || err?.message?.includes('RLS policy')) {
        toast.error('Supabase configuration error: Contact your administrator to fix RLS policies for the stores table.');
      } else {
        toast.error(`Failed to join store: ${err?.message || 'Please try again.'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const selectStore = async (store: SupabaseStore) => {
    try {
      // Save store to local device and mark this device as joined to the selected store
      const settings = await getSettings();
      if (settings) {
        settings.assignedStoreId = store.id;
        settings.shopName = store.name;
        settings.shopAddress = store.address || '';
        settings.shopPhone = store.phone || '';
        await saveSettings(settings);
        await refreshSettings();
      }

      setCurrentStoreId(store.id);

      // Save assigned store ID to localStorage for persistence
      localStorage.setItem('mthunzi_assigned_store_id', store.id);

      // Save store to local database for persistence
      await dexieDb.stores.put({
        id: store.id,
        name: store.name,
        location_name: store.location_name,
        category: store.category,
        address: store.address,
        phone: store.phone,
        currency: store.currency,
        currency_symbol: store.currency_symbol,
        owner_id: store.owner_id,
        store_code: store.store_code,
        is_public: store.is_public,
        company_id: (store as any).company_id,
        created_at: store.created_at,
        updated_at: store.updated_at,
      });

      if (navigator.onLine && isSupabaseConfigured()) {
        // Sync products from this store immediately
        console.log(`Pulling products for store: ${store.id}`);
        const products = await pullProductsFromSupabase(store.id);
        console.log(`Pulled ${products.length} products from Supabase`);

        if (products.length > 0) {
          await dexieDb.products.where('storeId').notEqual(store.id).delete();
          await dexieDb.products.bulkPut(products);
          console.log(`Saved ${products.length} products to local database`);
          toast.success(`Synced ${products.length} products`);

          // Download and store all product images locally for offline access
          toast.loading('Downloading product images...', { id: 'image-download' });
          const downloadedCount = await downloadAllStoreImages(store.id, products);
          if (downloadedCount > 0) {
            // Update products with local images
            await dexieDb.products.bulkPut(products);
            toast.success(`Downloaded ${downloadedCount} product images`, { id: 'image-download' });
          } else {
            toast.dismiss('image-download');
          }
        } else {
          console.warn('No products found in Supabase for this store');
          toast.warning('No products found in Supabase. Check if products exist in the store.');
        }

        // Sync categories from this store immediately
        const { data: categories, error: categoryError } = await supabase
          .from('categories')
          .select('*')
          .eq('store_id', store.id);

        if (!categoryError && categories?.length) {
          await dexieDb.categories.where('storeId').notEqual(store.id).delete();
          await dexieDb.categories.bulkPut(
            categories.map((raw: any) => ({
              id: raw.id,
              storeId: raw.store_id,
              name: raw.name,
              icon: raw.icon,
              color: raw.color,
              order: raw.order,
              createdAt: new Date(raw.created_at || raw.createdAt || Date.now()),
            }))
          );
        }

        // Sync sales from this store immediately
        const sales = await pullSalesFromSupabase(store.id);
        if (sales.length > 0) {
          await dexieDb.sales.where('storeId').notEqual(store.id).delete();
          await dexieDb.saleItems.where('storeId').notEqual(store.id).delete();
          for (const sale of sales) {
            await dexieDb.sales.put(sale);
            for (const item of sale.items || []) {
              await dexieDb.saleItems.add({
                saleId: sale.id,
                productId: item.productId,
                productName: item.productName,
                qty: item.quantity,
                priceAtSale: item.unitPrice,
                buyingPriceAtSale: item.buyingPrice,
                timestamp: sale.createdAt,
                storeId: sale.storeId,
              });
            }
          }
        }
      } else {
        console.log('Offline or Supabase not configured, skipping product sync');
        toast.warning('Offline mode - products not synced');
      }

      toast.success(`Successfully joined "${store.name}"!`);
      navigate('/');
    } catch (err) {
      console.error('Error selecting store:', err);
      toast.error('Failed to join store');
    }
  };

  if (loadingStores) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Loading Stores...</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Join Existing Store</CardTitle>
          <CardDescription>
            Connect this device to an existing store to sync products and data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Option 1: Join by Store Code */}
          <div className="space-y-4">
            <div className="border-t pt-4">
              <h3 className="font-semibold mb-3">📋 Join by Store Code</h3>
              <p className="text-sm text-gray-600 mb-3">
                Ask your manager for the store code (format: STORE-123). If you are the owner, sign in first so the app can show your stores.
              </p>
              <form onSubmit={handleJoinByCode} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="code">Store Code</Label>
                  <Input
                    id="code"
                    type="text"
                    placeholder="SHOP-ABCDE"
                    value={storeCode}
                    onChange={(e) => setStoreCode(normalizeStoreCode(e.target.value))}
                    disabled={loading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Joining...' : 'Join Store'}
                </Button>
              </form>
            </div>
          </div>

          {/* Option 2: Select from Available Stores */}
          {availableStores.length > 0 && (
            <div className="space-y-4">
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">🏪 Available Stores</h3>
                <p className="text-sm text-gray-600 mb-3">
                  Store codes are generated in the source device under Admin &gt; Stores. If your store does not appear here, ask your manager for the code.
                </p>
                <div className="grid gap-2 max-h-64 overflow-y-auto">
                  {availableStores.map((store) => (
                    <button
                      key={store.id}
                      onClick={() => selectStore(store)}
                      className="p-4 text-left border rounded-lg hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
                    >
                      <div className="font-medium">{store.name}</div>
                      <div className="text-sm text-gray-600">{store.address || 'No address'}</div>
                      <div className="text-xs text-gray-500 mt-1">Code: {store.store_code}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* No Stores Available */}
          {availableStores.length === 0 && !storeCode && (
            <Alert>
              <AlertDescription>
                {storeLoadError
                  ? `Unable to load stores: ${storeLoadError}. Ask your manager for the store code and check your internet connection.`
                  : 'No public stores available to join. Contact your store manager for a store code.'}
              </AlertDescription>
            </Alert>
          )}

          {/* Back Button */}
          <div className="border-t pt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => navigate('/')}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
