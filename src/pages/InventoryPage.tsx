import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/layout/AppShell';
import { AdminGate } from '@/components/admin/AdminGate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { dexieDb, addProduct, updateProduct, deleteProduct, getAllProducts, getAllCategories, recordStockInward } from '@/lib/db';
import type { Category, Product } from '@/types/pos';
import { getStockStatus } from '@/types/pos';
import { Plus, Pencil, Trash2, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import BulkImportDialog from '@/components/admin/BulkImportDialog';
import { isAdminRole } from '@/lib/permissions';
import { extractRefillFromFile, calculateBuyingPrice } from '@/lib/refillService';
import { buildReorderLines, preloadReorderPdfDeps, shareOrDownloadReorderPdf, shareReorderPdf } from '@/lib/reorderPdf';
import { useStore } from '@/contexts/StoreContext';
import { usePersistentForm } from '@/hooks/usePersistentForm';
import { BarcodeScannerDialog } from '@/components/pos/BarcodeScannerDialog';

function newProductTemplate(): Product {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    name: '',
    barcode: '',
    buyingPrice: 0,
    sellingPrice: 0,
    stock: 0,
    lowStockThreshold: 5,
    categoryIds: [],
    storeId: '',
    createdAt: now,
    updatedAt: now,
  };
}

export default function InventoryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { settings, isAdminAuthenticated } = useSupabaseAuth();
  const { currentStore } = useStore();
  const { format: formatCurrency } = useCurrencyFormatter();

  const products = useLiveQuery(
    async () => {
      const all = await getAllProducts(currentStore?.id);
      return all.slice().sort((a, b) => a.name.localeCompare(b.name));
    },
    [currentStore?.id]
  );
  const categories = useLiveQuery(() => dexieDb.categories.orderBy('order').toArray(), []);

  const [query, setQuery] = useState('');

  const urlFilter = useMemo(() => {
    const p = new URLSearchParams(location.search);
    return p.get('filter') ?? '';
  }, [location.search]);

  const activeFilter = urlFilter === 'low-stock' ? 'low-stock' : 'all';
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [draft, setDraft] = useState<Product>(() => newProductTemplate());
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkPurchaseMode, setBulkPurchaseMode] = useState(false);
  const [cratePackPrice, setCratePackPrice] = useState('');
  const [unitsPerCrate, setUnitsPerCrate] = useState('');

  // Persistent draft for the "Add Product" flow (text the user typed but didn't save).
  const [draftPersisted, setDraftPersisted, clearDraftPersisted] = usePersistentForm<Partial<Product>>(
    'inventory:add-product-draft',
    () => ({})
  );

  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [stockTarget, setStockTarget] = useState<Product | null>(null);
  const [stockQty, setStockQty] = useState('');
  const [stockUnitCost, setStockUnitCost] = useState('');
  const [stockDate, setStockDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stockBusy, setStockBusy] = useState(false);
  const [stockMode, setStockMode] = useState<'manual' | 'upload'>('manual');
  const [stockFile, setStockFile] = useState<File | null>(null);
  const stockFileInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const list = products ?? [];
    const filterApplied =
      activeFilter === 'low-stock'
        ? list.filter((p) => p.stock <= p.lowStockThreshold)
        : list;
    const q = query.trim().toLowerCase();
    if (!q) return filterApplied;
    return filterApplied.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(query.trim())
    );
  }, [activeFilter, products, query]);

  // Simple virtualization: only render a sliding window of items for smooth scrolling
  const [visibleCount, setVisibleCount] = useState(120);
  const visibleProducts = useMemo(
    () => (filtered ?? []).slice(0, visibleCount),
    [filtered, visibleCount]
  );

  const openCreate = useCallback(() => {
    setEditorMode('create');
    // Merge any persisted draft values on top of a fresh template.
    setDraft({ ...newProductTemplate(), ...draftPersisted });
    setBulkPurchaseMode(Boolean((draftPersisted as any)?.bulkPurchaseMode));
    setCratePackPrice(String((draftPersisted as any)?.cratePackPrice ?? ''));
    setUnitsPerCrate(String((draftPersisted as any)?.unitsPerCrate ?? ''));
    setEditorOpen(true);
  }, [draftPersisted]);

  const openEdit = useCallback((p: Product) => {
    setEditorMode('edit');
    setDraft({ ...p });
    setBulkPurchaseMode(false);
    setCratePackPrice('');
    setUnitsPerCrate('');
    setEditorOpen(true);
  }, []);

  const openStockIn = useCallback((p: Product) => {
    setStockTarget(p);
    setStockQty('');
    setStockUnitCost(p.buyingPrice ? String(p.buyingPrice) : '');
    setStockDate(new Date().toISOString().slice(0, 10));
    setStockMode('manual');
    setStockFile(null);
    setStockDialogOpen(true);
  }, []);

  const handleStockFileUpload = async (file: File) => {
    if (!stockTarget) return;
    setStockBusy(true);
    try {
      const result = await extractRefillFromFile(file);
      toast.success(`Extracted: ${result.refill_quantity} units of ${result.item_name}`);
      setStockQty(String(result.refill_quantity));
      
      // Auto-calculate unit cost if possible
      const unitCost = calculateBuyingPrice(result.item_name, result.refill_quantity);
      if (unitCost > 0) {
        setStockUnitCost(String(unitCost));
      }
      setStockFile(file);
    } catch (error) {
      console.error('Extraction failed:', error);
      toast.error(`Extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setStockBusy(false);
    }
  };

  const handledHardwareScanRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const scan = (location.state as any)?.hardwareScan as
      | { mode?: 'edit' | 'stock'; productId?: string }
      | undefined;
    if (!scan?.productId) return;
    if (handledHardwareScanRef.current) return;
    handledHardwareScanRef.current = true;

    (async () => {
      const p = await dexieDb.products.get(scan.productId!);
      if (!p) return;
      if (scan.mode === 'stock') openStockIn(p);
      else openEdit(p);

      // Clear route state so refreshing doesn't reopen the dialog.
      navigate(location.pathname + location.search, { replace: true, state: null });
    })();
  }, [location.pathname, location.search, location.state, navigate, openEdit, openStockIn]);

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error('Product name is required');
      return;
    }
    if (!draft.barcode.trim()) {
      toast.error('Barcode is required');
      return;
    }

    try {
      if (editorMode === 'create') {
        await addProduct({ ...draft, createdAt: new Date(), updatedAt: new Date() });
        clearDraftPersisted();
        toast.success('Product added');
      } else {
        await updateProduct({ ...draft, updatedAt: new Date() });
        toast.success('Product updated');
      }
      setEditorOpen(false);
    } catch (e) {
      console.error(e);
      toast.error('Failed to save product');
    }
  };

  const remove = async (p: Product) => {
    if (!confirm(`Delete ${p.name}?`)) return;
    try {
      await deleteProduct(p.id);
      toast.success('Product deleted');
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete product');
    }
  };

  const toggleCategory = (catId: string, checked: boolean) => {
    setDraft((prev) => {
      const next = new Set(prev.categoryIds);
      if (checked) next.add(catId);
      else next.delete(catId);
      return { ...prev, categoryIds: Array.from(next) };
    });
    if (editorMode === 'create') {
      setDraftPersisted((prev) => ({ ...prev, categoryIds: Array.from(new Set([...(prev.categoryIds ?? []), catId])) }));
    }
  };

  const resolvedCategories: Category[] = categories ?? [];

  const calculatedUnitBuyingPrice = useMemo(() => {
    const cratePrice = Number(cratePackPrice);
    const units = Number(unitsPerCrate);

    if (!bulkPurchaseMode) return Number(draft.buyingPrice || 0);
    if (!Number.isFinite(cratePrice) || cratePrice <= 0) return 0;
    if (!Number.isFinite(units) || units <= 0) return 0;

    return cratePrice / units;
  }, [bulkPurchaseMode, cratePackPrice, draft.buyingPrice, unitsPerCrate]);

  useEffect(() => {
    if (!bulkPurchaseMode) return;
    if (calculatedUnitBuyingPrice <= 0) return;

    setDraft((prev) => ({
      ...prev,
      buyingPrice: Number(calculatedUnitBuyingPrice.toFixed(2)),
    }));
  }, [bulkPurchaseMode, calculatedUnitBuyingPrice]);

  useEffect(() => {
    if (!editorOpen || editorMode !== 'create') return;
    setDraftPersisted((prev) => ({
      ...prev,
      bulkPurchaseMode,
      cratePackPrice,
      unitsPerCrate,
    } as any));
  }, [bulkPurchaseMode, cratePackPrice, editorMode, editorOpen, setDraftPersisted, unitsPerCrate]);

  useEffect(() => {
    preloadReorderPdfDeps().catch(() => undefined);
  }, []);

  const reorderLines = useMemo(() => {
    return buildReorderLines({
      productLines: (products ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
      })),
      targetMultiplier: 2,
    });
  }, [products]);

  const suggestedReorderByProductId = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of reorderLines) m.set(l.productId, l.suggestedReorderQty);
    return m;
  }, [reorderLines]);

  const exportReorderPdf = async () => {
    if (reorderLines.length === 0) {
      toast.message('No low-stock items to export');
      return;
    }
    try {
      const preopenedWindow = window.open('', '_blank');
      await shareOrDownloadReorderPdf({
        title: 'Low-stock Reorder List',
        lines: reorderLines,
        settings,
        preopenedWindow,
      });
    } catch (e) {
      console.error(e);
      toast.error('Failed to export reorder PDF');
    }
  };

  const shareReorder = async () => {
    if (reorderLines.length === 0) {
      toast.message('No low-stock items to share');
      return;
    }
    try {
      const result = await shareReorderPdf({ title: 'Reorder List', lines: reorderLines, settings });
      if (result.shared) toast.success('Shared PDF');
      else if (result.reason === 'cancelled') toast.message('Share cancelled');
      else if (result.reason === 'unsupported') toast.message('PDF downloaded. Attach it in WhatsApp.');
      else toast.error('Failed to share PDF');
    } catch (e) {
      console.error(e);
      toast.error('Failed to share');
    }
  };

  return (
    <AdminGate>
      <AppShell title="Inventory">
        <div className="space-y-4 p-4">
          {currentStore && (
            <p className="text-xs text-muted-foreground">
              Store: <span className="font-semibold">{currentStore.name}</span>
              {currentStore.location_name ? ` · ${currentStore.location_name}` : ''}
            </p>
          )}
          {activeFilter === 'low-stock' && (
            <Card className="border-warning/40 bg-warning/10">
              <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Filtered: Low stock</p>
                  <p className="text-xs text-muted-foreground">Showing items where stock is at or below the threshold.</p>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportReorderPdf}
                    title="Export reorder list PDF"
                    className="w-full sm:w-auto"
                  >
                    Export Reorder PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={shareReorder}
                    title="Share reorder list PDF"
                    className="w-full sm:w-auto"
                  >
                    Share
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/admin/inventory')}
                    className="w-full sm:w-auto"
                  >
                    Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <Input
                placeholder="Search name or barcode…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/admin/shelf-labels')}
                title="Print QR shelf labels for this store"
                className="w-full sm:w-auto"
              >
                QR Shelf Labels
              </Button>
              <Button onClick={openCreate} className="w-full gap-2 sm:w-auto">
                <Plus className="h-4 w-4" />
                Add Product
              </Button>
              {isAdminAuthenticated && isAdminRole(settings?.userRole) && (
                <Button onClick={() => setBulkImportOpen(true)} variant="outline" size="sm" className="w-full sm:w-auto">
                  AI-Powered Stock Import
                </Button>
              )}
              {/* Demo flow removed */}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:space-y-2">
              {(filtered ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No products found.</p>
              ) : (
                <>
                {visibleProducts.map((p) => {
                  const status = getStockStatus(p);

                  // Always render compact row; show image in the small avatar square (where the letter appears)

                  return (
                    <div key={p.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                        <div className="flex-shrink-0">
                          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-muted/10 sm:h-20 sm:w-20">
                            {p.imageUrl ? (
                              <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-16 w-16 items-center justify-center text-primary font-bold sm:h-20 sm:w-20">{p.name.charAt(0).toUpperCase()}</div>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold">{p.name}</p>
                            {status === 'low-stock' && (
                              <Badge variant="outline" className="border-warning text-warning">Low</Badge>
                            )}
                            {status === 'out-of-stock' && <Badge variant="destructive">Out</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">Barcode: {p.barcode}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center sm:gap-2">
                        <Button variant="outline" size="icon" onClick={() => openEdit(p)} className="h-10 w-full sm:w-10">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => openStockIn(p)}
                          className="h-10 w-full rounded-xl bg-primary px-3 py-2 text-primary-foreground"
                        >
                          <Plus className="h-4 w-4" />
                          <span className="ml-1 text-sm">+ Stock In</span>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-10 w-full text-destructive hover:bg-destructive/10 sm:w-10" onClick={() => remove(p)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {(filtered ?? []).length > visibleCount && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => setVisibleCount((c) => c + 120)}
                    >
                      Show more items ({visibleCount} of {(filtered ?? []).length})
                    </button>
                  </div>
                )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>{editorMode === 'create' ? 'Add Product' : 'Edit Product'}</DialogTitle>
              <DialogDescription className="sr-only">Create or edit a product in your inventory.</DialogDescription>
            </DialogHeader>

            <div className="max-h-[calc(90vh-10rem)] overflow-y-auto pr-2">
              <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Product name"
                />
              </div>

              <div className="grid gap-2">
                <Label className="flex items-center gap-2">
                  Image (optional)
                  <span className="text-xs text-muted-foreground">📸 Click camera to add photo</span>
                </Label>
                <div className="flex items-center gap-3">
                  <input
                    ref={(el) => (fileInputRef.current = el)}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const result = reader.result as string | null;
                          if (result) setDraft((prev) => ({ ...prev, imageUrl: result }));
                        };
                        reader.readAsDataURL(f);
                      } catch (err) {
                        console.error('Failed to read image', err);
                        toast.error('Failed to load image');
                      }
                    }}
                  />

                  <button
                    type="button"
                    className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 text-primary transition hover:scale-105 hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring"
                    onClick={() => fileInputRef.current?.click()}
                    title="Click to upload product image"
                  >
                    {draft.imageUrl ? (
                      <img src={draft.imageUrl} alt="preview" className="h-16 w-16 rounded-lg object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <Camera className="h-6 w-6" />
                        <span className="text-xs font-medium">Click to add</span>
                      </div>
                    )}
                  </button>

                  {draft.imageUrl && (
                    <Button variant="ghost" size="sm" onClick={() => setDraft((d) => ({ ...d, imageUrl: undefined }))}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Barcode</Label>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    value={draft.barcode}
                    onChange={(e) => setDraft((prev) => ({ ...prev, barcode: e.target.value }))}
                    placeholder="Scan or type barcode"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setBarcodeScannerOpen(true)} title="Scan barcode with camera">
                    <Camera className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Buying Price</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={draft.buyingPrice === 0 ? '' : String(draft.buyingPrice)}
                    readOnly={bulkPurchaseMode}
                    onChange={(e) => {
                      if (bulkPurchaseMode) return;
                      const raw = e.target.value;
                      const n = parseFloat(raw);
                      setDraft((prev) => ({ ...prev, buyingPrice: Number.isFinite(n) ? n : 0 }));
                      if (editorMode === 'create') {
                        setDraftPersisted((prev) => ({ ...prev, buyingPrice: Number.isFinite(n) ? n : undefined }));
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                    className={bulkPurchaseMode ? 'border-cyan-400 bg-cyan-50/50 text-cyan-900' : undefined}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Selling Price</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={draft.sellingPrice === 0 ? '' : String(draft.sellingPrice)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = parseFloat(raw);
                      setDraft((prev) => ({ ...prev, sellingPrice: Number.isFinite(n) ? n : 0 }));
                      if (editorMode === 'create') {
                        setDraftPersisted((prev) => ({ ...prev, sellingPrice: Number.isFinite(n) ? n : undefined }));
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>

              <div className="rounded-lg border border-dashed p-4 space-y-4 bg-muted/20">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="bulkPurchaseMode" className="text-sm font-medium">Bulk Purchase Mode</Label>
                    <p className="text-xs text-muted-foreground">Enable this to calculate unit cost from crate/pack pricing.</p>
                  </div>
                  <Checkbox
                    id="bulkPurchaseMode"
                    checked={bulkPurchaseMode}
                    onCheckedChange={(checked) => setBulkPurchaseMode(Boolean(checked))}
                  />
                </div>

                {bulkPurchaseMode && (
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label htmlFor="cratePackPrice">Crate/Pack Price</Label>
                      <Input
                        id="cratePackPrice"
                        type="number"
                        inputMode="decimal"
                        value={cratePackPrice}
                        onChange={(e) => setCratePackPrice(e.target.value)}
                        placeholder="225"
                        className="border-cyan-400/60 focus-visible:ring-cyan-400"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="unitsPerCrate">Units per Crate</Label>
                      <Input
                        id="unitsPerCrate"
                        type="number"
                        inputMode="numeric"
                        value={unitsPerCrate}
                        onChange={(e) => setUnitsPerCrate(e.target.value)}
                        placeholder="24"
                        className="border-cyan-400/60 focus-visible:ring-cyan-400"
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="unitBuyingPrice">Unit Buying Price</Label>
                      <Input
                        id="unitBuyingPrice"
                        readOnly
                        value={calculatedUnitBuyingPrice > 0 ? calculatedUnitBuyingPrice.toFixed(2) : ''}
                        placeholder="Auto-calculated"
                        className="border-cyan-400 bg-cyan-500/10 text-cyan-700 font-semibold shadow-[0_0_0_1px_rgba(34,211,238,0.35)]"
                      />
                    </div>
                  </div>
                )}

                {bulkPurchaseMode && (
                  <p className="text-xs text-muted-foreground">
                    Formula: Unit Buying Price = Crate/Pack Price / Units per Crate
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Stock</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={draft.stock === 0 ? '' : String(draft.stock)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = parseInt(raw) || 0;
                      setDraft((prev) => ({ ...prev, stock: n }));
                      if (editorMode === 'create') {
                        setDraftPersisted((prev) => ({ ...prev, stock: n || undefined }));
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Low Stock Threshold</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={draft.lowStockThreshold === 0 ? '' : String(draft.lowStockThreshold)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = parseInt(raw) || 0;
                      setDraft((prev) => ({ ...prev, lowStockThreshold: n }));
                      if (editorMode === 'create') {
                        setDraftPersisted((prev) => ({ ...prev, lowStockThreshold: n || undefined }));
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Categories</Label>
                {resolvedCategories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No categories yet.</p>
                ) : (
                  <div className="max-h-[240px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-2 gap-2">
                      {resolvedCategories.map((c) => {
                        const checked = draft.categoryIds.includes(c.id);
                        return (
                          <label key={c.id} className="flex items-center gap-2 rounded-md border p-2">
                            <Checkbox checked={checked} onCheckedChange={(v) => toggleCategory(c.id, Boolean(v))} />
                            <span className="text-sm">{c.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <BarcodeScannerDialog
          open={barcodeScannerOpen}
          onOpenChange={setBarcodeScannerOpen}
          onDetected={(code) => {
            setDraft((prev) => ({ ...prev, barcode: code }));
            if (editorMode === 'create') {
              setDraftPersisted((prev) => ({ ...prev, barcode: code || undefined }));
            }
          }}
        />

        <BulkImportDialog open={bulkImportOpen} onOpenChange={setBulkImportOpen} storeId={currentStore?.id} />

        <Dialog open={stockDialogOpen} onOpenChange={setStockDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Record Stock Received</DialogTitle>
              <DialogDescription>
                Log a new stock batch for audit history and update on-hand stock.
              </DialogDescription>
            </DialogHeader>

            {stockTarget && (
              <div className="grid gap-4">
                <div className="text-sm text-muted-foreground">
                  Product: <span className="font-semibold">{stockTarget.name}</span>
                </div>

                {/* Mode Selector */}
                <div className="flex gap-2 border-b">
                  <button
                    onClick={() => setStockMode('manual')}
                    className={`flex-1 py-2 text-sm font-medium border-b-2 transition ${
                      stockMode === 'manual'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                    disabled={stockBusy}
                  >
                    Manual Entry
                  </button>
                  <button
                    onClick={() => setStockMode('upload')}
                    className={`flex-1 py-2 text-sm font-medium border-b-2 transition ${
                      stockMode === 'upload'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                    disabled={stockBusy}
                  >
                    Auto-Extract
                  </button>
                </div>

                {/* Manual Entry Mode */}
                {stockMode === 'manual' && (
                  <>
                    <div className="grid gap-2">
                      <Label>Quantity received</Label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={stockQty}
                        onChange={(e) => setStockQty(e.target.value)}
                        placeholder="e.g. 24"
                        disabled={stockBusy}
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label>Unit cost</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={stockUnitCost}
                        onChange={(e) => setStockUnitCost(e.target.value)}
                        placeholder="Buying cost per unit"
                        disabled={stockBusy}
                      />
                    </div>

                    <div className="grid gap-2">
                      <Label>Batch date</Label>
                      <Input
                        type="date"
                        value={stockDate}
                        onChange={(e) => setStockDate(e.target.value)}
                        disabled={stockBusy}
                      />
                    </div>
                  </>
                )}

                {/* Auto-Extract Mode */}
                {stockMode === 'upload' && (
                  <>
                    <div className="grid gap-2">
                      <Label>Upload Receipt or Invoice</Label>
                      <div
                        className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-blue-500 transition"
                        onClick={() => !stockBusy && stockFileInputRef.current?.click()}
                      >
                        <input
                          ref={stockFileInputRef}
                          type="file"
                          accept="image/*,.pdf,.xls,.xlsx,.csv"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleStockFileUpload(file);
                          }}
                          className="hidden"
                          disabled={stockBusy}
                        />
                        {stockFile ? (
                          <div className="text-sm text-green-600 font-medium">
                            ✓ {stockFile.name}
                          </div>
                        ) : (
                          <>
                            <div className="text-sm text-muted-foreground">
                              {stockBusy ? 'Processing...' : 'Click to select or drag & drop'}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              Images, PDF, or spreadsheets
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {stockQty && (
                      <>
                        <div className="bg-blue-50 p-3 rounded text-sm">
                          <div className="font-medium">Extracted Data:</div>
                          <div className="text-blue-900 mt-1">Quantity: {stockQty} units</div>
                          {stockUnitCost && <div className="text-blue-900">Unit Cost: {stockUnitCost}</div>}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="grid gap-1">
                            <Label className="text-xs">Override Quantity</Label>
                            <Input
                              type="number"
                              inputMode="numeric"
                              value={stockQty}
                              onChange={(e) => setStockQty(e.target.value)}
                              placeholder="Units"
                              disabled={stockBusy}
                            />
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-xs">Override Unit Cost</Label>
                            <Input
                              type="number"
                              inputMode="decimal"
                              value={stockUnitCost}
                              onChange={(e) => setStockUnitCost(e.target.value)}
                              placeholder="Cost"
                              disabled={stockBusy}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    <div className="grid gap-2">
                      <Label>Batch date</Label>
                      <Input
                        type="date"
                        value={stockDate}
                        onChange={(e) => setStockDate(e.target.value)}
                        disabled={stockBusy}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStockDialogOpen(false)} disabled={stockBusy}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!stockTarget) return;
                  const qty = Number(stockQty);
                  const unitCost = Number(stockUnitCost || 0);
                  if (!Number.isFinite(qty) || qty <= 0) {
                    toast.error('Enter a quantity greater than 0');
                    return;
                  }
                  if (!Number.isFinite(unitCost) || unitCost < 0) {
                    toast.error('Enter a valid unit cost');
                    return;
                  }
                  const receivedAt = stockDate
                    ? new Date(stockDate + 'T00:00:00')
                    : new Date();

                  setStockBusy(true);
                  try {
                    await recordStockInward({
                      productId: stockTarget.id,
                      quantityAdded: qty,
                      unitCost,
                      receivedAt,
                      addedBy: settings?.shopName || undefined,
                    });
                    toast.success('Stock received recorded');
                    setStockDialogOpen(false);
                  } catch (e) {
                    console.error(e);
                    toast.error('Failed to record stock');
                  } finally {
                    setStockBusy(false);
                  }
                }}
                disabled={stockBusy || !stockTarget || !stockQty}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppShell>
    </AdminGate>
  );
}
