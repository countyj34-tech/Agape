import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useStore } from '@/contexts/StoreContext';
import { supabase, supabaseAdmin, isSupabaseConfigured, type SupabaseStore, getDeviceStoreId, setDeviceStoreId } from '@/lib/supabase';
import { ensureSchemaValid } from '@/lib/supabaseSchemaHealer';
import { dexieDb } from '@/lib/db';
import { autoSyncProductsFromSupabase } from '@/lib/sync';
import { removeDemoStoreAndData, hasUserStores, DEMO_STORE_ID } from '@/lib/demoStoreInitializer';
import { generateStoreCode } from '@/lib/storeCode';
import { syncStoreImagesToSupabase } from '@/lib/productImageStorage';
import { generateStoreCodeForStore } from '@/lib/storeManagement';
import { downloadStoreData, importStoreData, readImportFile } from '@/lib/storeExportImport';
import { toast } from 'sonner';
import { Pencil, Trash2, Copy, Check, CloudUpload, Key, Download, Upload } from 'lucide-react';

const CURRENCY_OPTIONS: Array<{ code: string; symbol: string; label: string }> = [
  { code: 'ZMW', symbol: 'K', label: 'Zambian Kwacha (ZMW)' },
  { code: 'ZAR', symbol: 'R', label: 'South African Rand (ZAR)' },
  { code: 'USD', symbol: '$', label: 'US Dollar (USD)' },
  { code: 'EUR', symbol: '€', label: 'Euro (EUR)' },
  { code: 'GBP', symbol: '£', label: 'British Pound (GBP)' },
  { code: 'KES', symbol: 'KSh', label: 'Kenyan Shilling (KES)' },
  { code: 'NGN', symbol: '₦', label: 'Nigerian Naira (NGN)' },
  { code: 'GHS', symbol: 'GH₵', label: 'Ghanaian Cedi (GHS)' },
  { code: 'TZS', symbol: 'TSh', label: 'Tanzanian Shilling (TZS)' },
  { code: 'UGX', symbol: 'USh', label: 'Ugandan Shilling (UGX)' },
];

function getCurrencyOption(code: string | undefined) {
  if (!code) return undefined;
  return CURRENCY_OPTIONS.find((c) => c.code === code);
}

export default function StoreManagerPage() {
  const { settings } = useSupabaseAuth();
  const { stores, refreshStores, currentStoreId, setCurrentStoreId } = useStore();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [currencyCode, setCurrencyCode] = useState(settings?.currency ?? 'ZMW');
  const [currencySymbol, setCurrencySymbol] = useState(settings?.currencySymbol ?? 'K');
  const [paymentMtn, setPaymentMtn] = useState('');
  const [paymentAirtel, setPaymentAirtel] = useState('');
  const [paymentZamtel, setPaymentZamtel] = useState('');
  const [paymentZedmobile, setPaymentZedmobile] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankName, setBankName] = useState('');
  const [storePhone, setStorePhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedStoreId, setCopiedStoreId] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(true);

  const plan = settings?.plan ?? 'free';
  const hasDemoStore = stores.some((s) => s.id === DEMO_STORE_ID);

  useEffect(() => {
    void refreshStores();
  }, [refreshStores]);

  const resetForm = () => {
    setName('');
    setLocation('');
    setCurrencyCode(settings?.currency ?? 'ZMW');
    setCurrencySymbol(settings?.currencySymbol ?? 'K');
    setPaymentMtn('');
    setPaymentAirtel('');
    setPaymentZamtel('');
    setPaymentZedmobile('');
    setBankAccount('');
    setBankName('');
    setStorePhone('');
    setIsPublic(true);
    setEditingId(null);
  };

  const handleCreateOrUpdateStore = async () => {
    if (!name.trim()) {
      toast.error('Store name is required');
      return;
    }

    setCreating(true);
    try {
      if (editingId) {
        const nowIso = new Date().toISOString();
        
        if (isSupabaseConfigured()) {
          try {
            // Prefer service-role client for server-side writes when available
            const writeClient: any = supabaseAdmin ?? supabase;
            const { error } = await writeClient
              .from('stores')
              .update({
                name: name.trim(),
                location_name: location.trim() || null,
                phone: storePhone || null,
                currency: currencyCode,
                currency_symbol: currencySymbol,
                payment_numbers: {
                  mtn: paymentMtn || null,
                  airtel: paymentAirtel || null,
                  zamtel: paymentZamtel || null,
                  zedmobile: paymentZedmobile || null,
                  bank_account: bankAccount || null,
                  bank_name: bankName || null,
                },
              })
              .eq('id', editingId);
            if (error) throw error;
          } catch (updateError) {
            console.warn('Remote store update failed, local store will still be updated:', updateError);
            toast.info('Remote store update failed. Local copy has been saved.', { duration: 5000 });
          }
        }
          
          const existing = await dexieDb.stores.get(editingId);
          if (existing) {
            const updated: SupabaseStore = {
              ...existing,
              name: name.trim(),
              location_name: location.trim() || undefined,
              phone: storePhone.trim() || undefined,
              currency: currencyCode,
              currency_symbol: currencySymbol,
              is_public: isPublic,
              payment_numbers: {
                mtn: paymentMtn || undefined,
                airtel: paymentAirtel || undefined,
                zamtel: paymentZamtel || undefined,
                zedmobile: paymentZedmobile || undefined,
              },
              updated_at: nowIso,
            };
            await dexieDb.stores.put(updated);
          }
          toast.success('Store updated');
        } else {
          const nowIso = new Date().toISOString();
          let newStoreId = DEMO_STORE_ID;
          if (newStoreId === DEMO_STORE_ID) {
            // Generate unique ID for new store
            newStoreId = crypto.randomUUID();
          }
          let ownerId: string | undefined = undefined;
          let createdInSupabase = false;
          let storeCode = generateStoreCode();

          // Check if we only have demo store before creating user store
          const hadOnlyDemoStore = !(await hasUserStores());

          // STEP 1: Get the current authenticated Supabase user (optional)
          if (isSupabaseConfigured()) {
            const { data: userData, error: userError } = await supabase.auth.getUser();
            if (userError) {
              console.warn('Failed to retrieve Supabase user, will create local-only store:', userError);
              // Continue with local-only creation
            } else if (userData?.user?.id) {
              ownerId = userData.user.id;
              console.log(`✓ Authenticated Supabase user: ${ownerId}`);
            } else {
              console.warn('No authenticated Supabase user session found, will create local-only store');
              // Continue with local-only creation
            }
          }

          // STEP 2: Create store in Supabase (use service-role client when available)
          if (isSupabaseConfigured()) {
            try {
              const writeClient: any = supabaseAdmin ?? supabase;
              const payload: any = {
                id: newStoreId,
                name: name.trim(),
                location_name: location.trim() || null,
                phone: storePhone || null,
                currency: currencyCode,
                currency_symbol: currencySymbol,
                owner_id: ownerId || null,
                store_code: storeCode,
                is_public: isPublic,
                payment_numbers: {
                  mtn: paymentMtn || null,
                  airtel: paymentAirtel || null,
                  zamtel: paymentZamtel || null,
                  zedmobile: paymentZedmobile || null,
                },
              };

              // Attach company if we have it from settings
              if (settings?.companyId) {
                payload.company_id = settings.companyId;
              }

              // Try inserting the full payload first. If the server schema/cache
              // is missing optional columns (e.g. owner_id) PostgREST may reject
              // the request. In that case retry a simpler payload without the
              // offending field so the local flow can continue.
              let insertError: any = null;
              const attemptInsert = async (p: any) => {
                const res = await writeClient.from('stores').insert([p]);
                return res;
              };

              // Validate remote schema and show repair SQL if needed (best-effort)
              try {
                const schemaCheck = await ensureSchemaValid();
                if (!schemaCheck.isValid) {
                  console.warn('Supabase schema invalid:', schemaCheck);
                  console.log('Repair SQL preview:', schemaCheck.repairSQL);
                  toast.warning('Supabase schema appears incomplete. Check console for repair SQL. Proceeding with best-effort insert.');
                }
              } catch (schemaErr) {
                console.warn('Schema validation failed:', schemaErr);
              }

              // First attempt: try to insert the full payload
              let res = await attemptInsert(payload);
              if (!res?.error) {
                createdInSupabase = true;
                console.log('✓ Store created in Supabase');
              } else {
                console.error('Supabase store insert error:', res.error);
                // Try to recover by removing offending fields mentioned in the error message
                const errorMsg = String(res.error?.message || res.error || '');
                const removableFields = ['owner_id', 'payment_numbers', 'company_id', 'store_code', 'is_public'];
                let fallbackPayload = { ...payload };
                let retried = false;

                for (const key of removableFields) {
                  if (fallbackPayload.hasOwnProperty(key) && errorMsg.includes(key)) {
                    console.warn(`Retrying store insert without field: ${key}`);
                    delete (fallbackPayload as any)[key];
                    const retryRes = await attemptInsert(fallbackPayload);
                    if (!retryRes?.error) {
                      createdInSupabase = true;
                      console.log(`✓ Store created in Supabase (fallback without ${key})`);
                      res = retryRes;
                      retried = true;
                      break;
                    } else {
                      console.error(`Retry without ${key} failed:`, retryRes.error);
                      // continue to next removable field
                    }
                  }
                }

                if (!retried && res?.error) {
                  toast.error(`Store creation failed: ${res.error.message || String(res.error)}`);
                  throw res.error;
                }
              }
            } catch (createError: any) {
              const errorMsg = createError?.message || String(createError);
              console.error('Remote store creation failed:', errorMsg);
              toast.warning(`Failed to create store in cloud, creating locally only: ${errorMsg}`);
              // Continue with local creation even if Supabase failed
              createdInSupabase = false;
            }
          } else {
            console.log('Supabase not configured, saving locally only');
          }

          // Save locally regardless of Supabase status (always create local store)
          const localStore: SupabaseStore = {
            id: newStoreId,
            name: name.trim(),
            location_name: location.trim() || undefined,
            category: undefined,
            address: undefined,
            phone: storePhone.trim() || undefined,
            payment_numbers: {
              mtn: paymentMtn || undefined,
              airtel: paymentAirtel || undefined,
              zamtel: paymentZamtel || undefined,
              zedmobile: paymentZedmobile || undefined,
            },
            currency: currencyCode,
            currency_symbol: currencySymbol,
            owner_id: ownerId,
            // Include company link on the local record so Store lists filter correctly
            companyId: settings?.companyId,
            company_id: settings?.companyId,
            store_code: storeCode,
            is_public: isPublic,
            created_at: nowIso,
            updated_at: nowIso,
          };

            await dexieDb.stores.put(localStore);
            console.log('✓ Store saved to local database');

            // Make this new store the device's active store and allow future auto-seeding.
            setDeviceStoreId(localStore.id);
            localStorage.removeItem('mthunzi_assigned_store_id');
            localStorage.setItem('mthunzi_allow_auto_seed', 'true');

            // Fire-and-forget product sync in background; do not block UI
            toast.success(`Store "${localStore.name}" created`);
            (async () => {
              if (navigator.onLine && isSupabaseConfigured() && createdInSupabase) {
                try {
                  const syncedCount = await autoSyncProductsFromSupabase();
                  if (syncedCount > 0) {
                    toast.success(`Store "${localStore.name}" created with ${syncedCount} products synced`);
                  }
                } catch (syncError) {
                  console.warn('Product sync after store creation failed (background):', syncError);
                }
              }
            })();

          // Remove demo store if this is the user's first store creation
          if (hadOnlyDemoStore) {
            try {
              await removeDemoStoreAndData();
              console.log('✓ Demo store cleanup completed');
              toast.success('Demo store removed. Your new store is now active.');
            } catch (error) {
              console.error('Failed to clean up demo store:', error);
              toast.warning('Demo store cleanup failed. You may need to manually delete it.');
            }
          }
        }

      resetForm();
      void refreshStores();
    } catch (e) {
      console.error(e);
      toast.error('Failed to create store');
    } finally {
      setCreating(false);
    }
  };

  const handleStartEdit = (store: SupabaseStore) => {
    setEditingId(store.id);
    setName(store.name ?? '');
    setLocation(store.location_name ?? '');
    setStorePhone(store.phone || '');
    setCurrencyCode(store.currency ?? settings?.currency ?? 'ZMW');
    setCurrencySymbol(store.currency_symbol ?? settings?.currencySymbol ?? 'K');
    setPaymentMtn(store.payment_numbers?.mtn || '');
    setPaymentAirtel(store.payment_numbers?.airtel || '');
    setPaymentZamtel(store.payment_numbers?.zamtel || '');
    setPaymentZedmobile(store.payment_numbers?.zedmobile || '');
    setIsPublic(store.is_public ?? true);
  };

  const handleDeleteStore = async (store: SupabaseStore) => {
    if (store.id === currentStoreId) {
      toast.error('Cannot delete the currently selected store. Switch to another store first.');
      return;
    }

    const confirmed = window.confirm(
      `Delete store "${store.name}"? This will remove it from the store list. Existing sales data will remain tagged to this store id.`
    );
    if (!confirmed) return;

    try {
      // Delete locally first to avoid blocking the UI
      await dexieDb.stores.delete(store.id);

      // Attempt remote delete in background
      (async () => {
        if (!isSupabaseConfigured()) return;
        try {
          const { error } = await supabase.from('stores').delete().eq('id', store.id);
          if (error) console.warn('Remote store delete failed (background):', error);
        } catch (err) {
          console.warn('Remote store delete failed (background):', err);
        }
      })();
      const deviceId = getDeviceStoreId();
      if (deviceId === store.id) {
        const remaining = await dexieDb.stores.toArray();
        if (remaining.length > 0) {
          setDeviceStoreId(remaining[0].id);
          localStorage.setItem('mthunzi_allow_auto_seed', 'true');
        } else {
          localStorage.removeItem('mthunzi_store_id');
          localStorage.setItem('mthunzi_allow_auto_seed', 'false');
        }
      }
      toast.success('Store deleted');
      if (editingId === store.id) {
        resetForm();
      }
      void refreshStores();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete store');
    }
  };

  const handleSyncImages = async (store: SupabaseStore) => {
    if (!isSupabaseConfigured()) {
      toast.error('Supabase is not configured. Cannot sync images.');
      return;
    }

    try {
      toast.loading('Syncing images to Supabase...', { id: 'sync-images' });
      const count = await syncStoreImagesToSupabase(store.id);
      toast.success(`Synced ${count} images to Supabase`, { id: 'sync-images' });
    } catch (error) {
      console.error('Failed to sync images:', error);
      toast.error('Failed to sync images', { id: 'sync-images' });
    }
  };

  const handleGenerateStoreCode = async (store: SupabaseStore) => {
    try {
      toast.loading('Generating store code...', { id: 'generate-code' });
      const newCode = await generateStoreCodeForStore(store.id);
      toast.success(`Store code generated: ${newCode}`, { id: 'generate-code' });
      await refreshStores();
    } catch (error) {
      console.error('Failed to generate store code:', error);
      toast.error('Failed to generate store code', { id: 'generate-code' });
    }
  };

  const handleExportStore = async (store: SupabaseStore) => {
    try {
      toast.loading('Exporting store data...', { id: 'export-store' });
      await downloadStoreData(store.id, store.name);
      toast.success(`Exported "${store.name}" data`, { id: 'export-store' });
    } catch (error) {
      console.error('Failed to export store:', error);
      toast.error('Failed to export store', { id: 'export-store' });
    }
  };

  const handleImportStore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      toast.loading('Importing store data...', { id: 'import-store' });
      const jsonString = await readImportFile(file);
      const importedStoreId = await importStoreData(jsonString);
      if (importedStoreId) {
        setDeviceStoreId(importedStoreId);
        setCurrentStoreId(importedStoreId);
      }
      toast.success('Store data imported successfully', { id: 'import-store' });
      await refreshStores();
      // Reset file input
      event.target.value = '';
    } catch (error) {
      console.error('Failed to import store:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to import store data: ${errorMessage}`, { id: 'import-store' });
    }
  };

  return (
    <AppShell title="Store Manager">
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Plan & Limits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Current plan: <span className="font-semibold capitalize">{plan}</span>
            </p>
            <p>
              {isSupabaseConfigured()
                ? 'Supabase is configured. Your real stores will be created in the cloud and synced locally.'
                : 'Supabase is not configured. Stores will be created locally only.'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Existing Stores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2 mb-4">
              <input
                type="file"
                accept=".json"
                onChange={handleImportStore}
                style={{ display: 'none' }}
                id="import-store-file"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('import-store-file')?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                Import Store Data
              </Button>
              <span className="text-xs text-muted-foreground">
                Import store data from JSON file (bypasses Supabase RLS)
              </span>
            </div>
            {stores.length === 0 ? (
              <p className="text-muted-foreground">No stores created yet.</p>
            ) : (
              <ul className="space-y-2">
                {stores.map((s) => (
                  <li
                    key={s.id}
                    className="rounded border px-3 py-2 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.name}</p>
                        {s.location_name && (
                          <p className="truncate text-[11px] text-muted-foreground">{s.location_name}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-muted-foreground">
                          {s.currency_symbol} · {s.currency}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-blue-500"
                          title="Sync images to Supabase"
                          onClick={() => handleSyncImages(s)}
                        >
                          <CloudUpload className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-green-500"
                          title="Export store data"
                          onClick={() => handleExportStore(s)}
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground"
                          onClick={() => handleStartEdit(s)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => handleDeleteStore(s)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {s.store_code ? (
                      <div className="flex items-center gap-2 rounded bg-blue-50 p-2">
                        <span className="text-[10px] font-mono bg-white px-2 py-1 rounded flex-1">
                          Store Code: <span className="font-bold text-blue-600">{s.store_code}</span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-blue-600 hover:text-blue-700"
                          onClick={() => {
                            navigator.clipboard.writeText(s.store_code!);
                            setCopiedStoreId(s.id);
                            setTimeout(() => setCopiedStoreId(null), 2000);
                            toast.success('Store code copied!');
                          }}
                        >
                          {copiedStoreId === s.id ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => handleGenerateStoreCode(s)}
                      >
                        <Key className="h-3 w-3 mr-1" />
                        Generate Store Code
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Store' : 'Create Store'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
              {hasDemoStore && !editingId && (
              <p className="text-xs text-blue-600">
                A demo store is active until you create your first real store. When your first real store is created, the demo store and demo inventory are removed automatically.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="store-name">Store name</Label>
              <Input
                id="store-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mthunzi Main Branch"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="store-location">Location / description</Label>
              <Input
                id="store-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Lusaka, CBD"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="store-phone">Primary store phone</Label>
              <Input
                id="store-phone"
                value={storePhone}
                onChange={(e) => setStorePhone(e.target.value)}
                placeholder="e.g. 260971234567"
              />
              <p className="text-xs text-muted-foreground">
                This number is used as the default mobile payment destination when a specific provider number is not configured.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="mtn">MTN Mobile Money Number</Label>
                <Input id="mtn" value={paymentMtn} onChange={(e) => setPaymentMtn(e.target.value)} placeholder="e.g. 26097xxxxxxx" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="airtel">Airtel Mobile Money Number</Label>
                <Input id="airtel" value={paymentAirtel} onChange={(e) => setPaymentAirtel(e.target.value)} placeholder="e.g. 26097xxxxxxx" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zamtel">Zamtel Mobile Money Number</Label>
                <Input id="zamtel" value={paymentZamtel} onChange={(e) => setPaymentZamtel(e.target.value)} placeholder="e.g. 26097xxxxxxx" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zedmobile">Zedmobile Mobile Money Number</Label>
                <Input id="zedmobile" value={paymentZedmobile} onChange={(e) => setPaymentZedmobile(e.target.value)} placeholder="e.g. 26097xxxxxxx" />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1 space-y-2">
                <Label>Currency</Label>
                <Select
                  value={currencyCode}
                  onValueChange={(code) => {
                    const opt = getCurrencyOption(code);
                    setCurrencyCode(code);
                    if (opt) setCurrencySymbol(opt.symbol);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label} — {c.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28 space-y-2">
                <Label>Symbol</Label>
                <Input
                  value={currencySymbol}
                  onChange={(e) => setCurrencySymbol(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={isPublic} onCheckedChange={(checked) => setIsPublic(checked)} />
                <div>
                  <p className="text-sm font-medium">Public store</p>
                  <p className="text-xs text-muted-foreground">Allow join by store code</p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={handleCreateOrUpdateStore}
                disabled={creating}
                className="flex-1"
              >
                {creating ? (editingId ? 'Saving...' : 'Creating...') : editingId ? 'Save Changes' : 'Create Store'}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={resetForm}
                  disabled={creating}
                >
                  Cancel Edit
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
