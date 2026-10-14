import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHardwareScanner } from '@/hooks/useHardwareScanner';
import { dexieDb } from '@/lib/db';
import { useCart } from '@/contexts/CartContext';
import { toast } from 'sonner';
import type { Product } from '@/types/pos';
import { useStore } from '@/contexts/StoreContext';
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
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';

type ScanPopupState = {
  open: boolean;
  product: Product | null;
  barcode: string;
};

export function HardwareScannerListener() {
  const location = useLocation();
  const navigate = useNavigate();
  const { addItem } = useCart();
  const { currentStoreId, isGlobalView } = useStore();
  const { autoReconnect } = useBluetoothPrinter();

  const [popup, setPopup] = useState<ScanPopupState>({ open: false, product: null, barcode: '' });

  // Treat root or /pos routes as POS
  const isPosRoute = useMemo(
    () => location.pathname === '/' || location.pathname.startsWith('/pos'),
    [location.pathname]
  );
  const isAdminInventoryRoute = useMemo(
    () => location.pathname.startsWith('/admin') && location.pathname !== '/',
    [location.pathname]
  );

  // Best-effort printer auto-reconnect on app start (offline-friendly).
  // This must run only once per mount so route changes do not retrigger the reconnect loop.
  const didAttemptPrinterReconnect = useRef(false);
  useEffect(() => {
    if (didAttemptPrinterReconnect.current) return;
    didAttemptPrinterReconnect.current = true;
    autoReconnect().catch(() => undefined);
  }, [autoReconnect]);

  const lookupProductByBarcode = useCallback(
    async (barcode: string): Promise<Product | null> => {
      const matches = await dexieDb.products.where('barcode').equals(barcode).toArray();
      if (matches.length === 0) return null;

      if (isGlobalView) return matches[0] ?? null;
      const inStore = matches.find((p) => p.storeId === currentStoreId);
      return inStore ?? null;
    },
    [currentStoreId, isGlobalView]
  );

  // Keep track of the last scan to prevent duplicate rapid firing
  const lastScanRef = useRef<{ barcode: string; ts: number } | null>(null);

  const handleScan = useCallback(
    async (barcode: string) => {
      // ignore empty
      if (!barcode) return;

      // ignore duplicates scanned within 1s
      const last = lastScanRef.current;
      const now = Date.now();
      if (last && last.barcode === barcode && now - last.ts < 1000) return;

      const product = await lookupProductByBarcode(barcode);
      if (!product) {
        // best-effort: try substring match (helps when scanners truncate or add prefix)
        try {
          // Load products for current store (or all in global view) and search for barcode substring
          const productsToSearch = isGlobalView
            ? await dexieDb.products.toArray()
            : await dexieDb.products.where('storeId').equals(currentStoreId).toArray();

          const found = productsToSearch.find((p) => !!p.barcode && p.barcode.includes(barcode));
          if (found) {
            lastScanRef.current = { barcode, ts: now };
            // proceed with found
            // If we are on POS, add immediately.
            if (isPosRoute) {
              if (inStore.stock <= 0) {
                toast.error(`${inStore.name} is out of stock`);
                return;
              }
              addItem(inStore);
              toast.success(`Added ${inStore.name}`);
              return;
            }

            if (isAdminInventoryRoute) {
              setPopup({ open: true, product: inStore, barcode });
              return;
            }

            if (inStore.stock <= 0) {
              toast.error(`${inStore.name} is out of stock`);
              return;
            }
            addItem(inStore);
            toast.success(`Added ${inStore.name}`);
            navigate('/', { replace: false });
            return;
          }
        } catch (e) {
          // ignore lookup fallback errors
        }

        toast.error(`Barcode not found: ${barcode}`);
        return;
      }

      // If we are on POS, add immediately.
      if (isPosRoute) {
        if (product.stock <= 0) {
          toast.error(`${product.name} is out of stock`);
          return;
        }
        addItem(product);
        toast.success(`Added ${product.name}`);
        lastScanRef.current = { barcode, ts: Date.now() };
        return;
      }

      // If scanned from Admin/Inventory/etc: show a quick action popup.
      if (isAdminInventoryRoute) {
        setPopup({ open: true, product, barcode });
        lastScanRef.current = { barcode, ts: Date.now() };
        return;
      }

      // Default behavior anywhere else: add to cart + jump to POS.
      if (product.stock <= 0) {
        toast.error(`${product.name} is out of stock`);
        return;
      }
      addItem(product);
      toast.success(`Added ${product.name}`);
      lastScanRef.current = { barcode, ts: Date.now() };
      navigate('/', { replace: false });
    },
    [addItem, isAdminInventoryRoute, isPosRoute, lookupProductByBarcode, navigate]
  );

  // Configure scanner to accept alphanumeric barcodes and be permissive on delays
  useHardwareScanner(handleScan, {
    minLength: 3,
    maxInterKeyDelayMs: 120,
    maxAverageKeyDelayMs: 80,
    numericOnly: false,
  });

  const productName = popup.product?.name ?? 'Product';

  return (
    <AlertDialog
      open={popup.open}
      onOpenChange={(open) => setPopup((p) => ({ ...p, open }))}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stock detected</AlertDialogTitle>
          <AlertDialogDescription>
            Barcode {popup.barcode}. Do you want to add {productName} to the cart or edit its stock?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => setPopup({ open: false, product: null, barcode: '' })}
          >
            Close
          </AlertDialogCancel>

          <AlertDialogAction
            onClick={() => {
              const p = popup.product;
              if (!p) return;
              if (p.stock <= 0) {
                toast.error(`${p.name} is out of stock`);
                setPopup({ open: false, product: null, barcode: '' });
                return;
              }
              addItem(p);
              toast.success(`Added ${p.name}`);
              setPopup({ open: false, product: null, barcode: '' });
              navigate('/', { replace: false });
            }}
          >
            Add to cart
          </AlertDialogAction>

          <AlertDialogAction
            onClick={() => {
              const p = popup.product;
              if (!p) return;
              setPopup({ open: false, product: null, barcode: '' });
              navigate('/admin/inventory', {
                state: { hardwareScan: { mode: 'stock', productId: p.id } },
              });
            }}
          >
            Edit stock
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
