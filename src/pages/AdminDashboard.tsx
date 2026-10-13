import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PinEntry } from '@/components/pos/PinEntry';
import { PinResetDialog } from '@/components/pos/PinResetDialog';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useStore } from '@/contexts/StoreContext';
import { dexieDb, exportAllData, importData, saveSettings } from '@/lib/db';
import { supabase, getDeviceStoreId, isSupabaseConfigured } from '@/lib/supabase';
import { slugify } from '@/lib/utils';
import { pullStoresFromSupabase, pullSalesFromSupabase, pullProductsFromSupabase, pullCategoriesFromSupabase, bulkSyncProductsToSupabase, bulkSyncCategoriesToSupabase, bulkSyncSalesToSupabase, bulkSyncStoresToSupabase, bulkSyncOnlineOrdersToSupabase, bulkSyncAuditLogsToSupabase, processSyncQueue, getPendingSyncCount } from '@/lib/sync';
import { refreshPendingOnlineOrdersFromCloud, subscribeToPendingOrders } from '@/lib/onlineOrders';
import { ConfettiGoal } from '@/components/ConfettiGoal';
import type { Sale, Product, Settings as SettingsType } from '@/types/pos';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import {
  DollarSign,
  TrendingUp,
  ShoppingBag,
  AlertTriangle,
  Package,
  FolderOpen,
  Settings,
  Cloud,
  RefreshCw,
  Activity,
  Building2,
  ShieldCheck,
  BarChart3,
  Percent,
  Trophy,
  Share2,
  Bell,
  Eye,
  Users,
  BrainCircuit,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useNotification } from '@/contexts/NotificationContext';
import { requestPersistentStorage } from '@/lib/storageGuard';
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';
import { getDeviceId } from '@/lib/supabase';
import { MTZ_SUPPORT, SOFTWARE_VERSION } from '@/lib/systemInfo';
import html2canvas from 'html2canvas';

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

export default function AdminDashboard() {
    // Only call useNotification ONCE at the top level
    const { addNotification } = useNotification();
  const { isAdminAuthenticated, isPinSetup, settings, login, setupPin, refreshSettings } = useSupabaseAuth();
  const { currentStoreId, stores, currentStore, isGlobalView, setCurrentStoreId } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [pinError, setPinError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showPinReset, setShowPinReset] = useState(false);
  const [shareOrigin, setShareOrigin] = useState(() => window.location.origin);
  const isSuperAdmin = settings?.userRole === 'super_admin';

  const [settingsDraft, setSettingsDraft] = useState<
    Pick<
      SettingsType,
      | 'currency'
      | 'currencySymbol'
      | 'eodAutoPromptEnabled'
      | 'eodClosingTime'
      | 'auditSyncEnabled'
      | 'auditOpeningTime'
      | 'auditClosingTime'
      | 'plan'
      | 'userRole'
      | 'assignedStoreId'
      | 'thermalPrinterWidth'
      | 'receiptFooter'
      | 'autoWhatsAppEnabled'
      | 'autoWhatsAppNumber'
      | 'autoWhatsAppMethod'
      | 'autoWhatsAppWebhookUrl'
    >
  >({
    currency: 'ZMW',
    currencySymbol: 'K',
    eodAutoPromptEnabled: true,
    eodClosingTime: '18:00',
    auditSyncEnabled: false,
    auditOpeningTime: '08:00',
    auditClosingTime: '18:00',
    plan: 'free',
    userRole: 'owner',
    assignedStoreId: null,
    thermalPrinterWidth: '80mm',
    receiptFooter: 'Thank you for shopping with us!',
    autoWhatsAppEnabled: false,
    autoWhatsAppNumber: '',
    autoWhatsAppMethod: 'web',
    autoWhatsAppWebhookUrl: '',
  });
  const [importing, setImporting] = useState(false);
  const [pendingSyncs, setPendingSyncs] = useState(0);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [storageGuardActive, setStorageGuardActive] = useState<boolean | null>(null);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);

  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();
  const isSettingsRoute = location.pathname === '/admin/settings';

  const {
    state: printerState,
    discoverAndConnect: discoverPrinter,
    discoverAndConnectSerial: discoverSerialPrinter,
    discoverAndConnectUsb: discoverUsbPrinter,
    discoverAndConnectBle: discoverBlePrinter,
    autoReconnect: reconnectPrinter,
    disconnect: disconnectPrinter,
    testPrint,
  } = useBluetoothPrinter();

  const todayKey = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  // Stable day bounds — recreating these every render retriggers live queries and freezes navigation.
  const { startOfDay, endOfDay, startOfYesterday, endOfYesterday } = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const yStart = new Date(start);
    yStart.setDate(yStart.getDate() - 1);
    const yEnd = new Date(yStart);
    yEnd.setHours(23, 59, 59, 999);
    return {
      startOfDay: start,
      endOfDay: end,
      startOfYesterday: yStart,
      endOfYesterday: yEnd,
    };
  }, [todayKey]);

    // (Removed duplicate useNotification and productsChannel setup)

  // Defer non-critical queries so leaving Admin never freezes navigation.
  const [deferredReady, setDeferredReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setDeferredReady(true), 400);
    return () => window.clearTimeout(id);
  }, []);

  const todaySales = useLiveQuery(
    () => {
      const base = dexieDb.sales
        .where('createdAt')
        .between(startOfDay, endOfDay, true, true);
      if (isGlobalView) return base.toArray();
      return base.filter((s) => s.storeId === currentStoreId).toArray();
    },
    [currentStoreId, isGlobalView, startOfDay, endOfDay]
  );

  const todaySaleItems = useLiveQuery(
    () => {
      const base = dexieDb.saleItems
        .where('timestamp')
        .between(startOfDay, endOfDay, true, true);
      if (isGlobalView) return base.toArray();
      return base.filter((i) => i.storeId === currentStoreId).toArray();
    },
    [currentStoreId, isGlobalView, startOfDay, endOfDay]
  );

  const yesterdaySaleItems = useLiveQuery(
    () => {
      if (!deferredReady) return [];
      const base = dexieDb.saleItems
        .where('timestamp')
        .between(startOfYesterday, endOfYesterday, true, true);
      if (isGlobalView) return base.toArray();
      return base.filter((i) => i.storeId === currentStoreId).toArray();
    },
    [currentStoreId, isGlobalView, startOfYesterday, endOfYesterday, deferredReady]
  );

  // Recent sales window for predictive stock-out alerts (last 7 days)
  const recentStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6); // inclusive 7-day window
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const recentSaleItems = useLiveQuery(
    () => {
      if (!deferredReady) return [];
      const base = dexieDb.saleItems
        .where('timestamp')
        .between(recentStart, endOfDay, true, true);
      if (isGlobalView) return base.toArray();
      return base.filter((i) => i.storeId === currentStoreId).toArray();
    },
    [currentStoreId, isGlobalView, recentStart, endOfDay, deferredReady]
  );

  const allProducts = useLiveQuery(
    () => isGlobalView
      ? dexieDb.products.toArray()
      : dexieDb.products.where('storeId').equals(currentStoreId).toArray(),
    [currentStoreId, isGlobalView]
  );

  const lowStockProducts = useMemo(
    () => (allProducts ?? []).filter((p) => p.stock <= p.lowStockThreshold),
    [allProducts]
  );

  const predictiveAlerts = useMemo(() => {
    if (!recentSaleItems || !allProducts) return [] as Array<{
      productId: string;
      name: string;
      daysRemaining: number;
      projectedStockoutDate: Date;
      profitPotential: number;
    }>;

    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    const qtyByProduct = new Map<
      string,
      { qty: number; firstTs: Date; lastTs: Date }
    >();

    for (const item of recentSaleItems) {
      const ts = item.timestamp instanceof Date ? item.timestamp : new Date(String(item.timestamp));
      const existing = qtyByProduct.get(item.productId);
      if (existing) {
        existing.qty += item.qty;
        if (ts < existing.firstTs) existing.firstTs = ts;
        if (ts > existing.lastTs) existing.lastTs = ts;
      } else {
        qtyByProduct.set(item.productId, { qty: item.qty, firstTs: ts, lastTs: ts });
      }
    }

    const alerts: Array<{
      productId: string;
      name: string;
      daysRemaining: number;
      projectedStockoutDate: Date;
      profitPotential: number;
    }> = [];

    for (const product of allProducts) {
      const stats = qtyByProduct.get(product.id);
      if (!stats || stats.qty <= 0) continue;
      if (product.stock <= 0) continue;

      const spanDays = Math.max(
        1,
        Math.round((stats.lastTs.getTime() - stats.firstTs.getTime()) / msPerDay) + 1
      );
      const avgDaily = stats.qty / spanDays;
      if (!Number.isFinite(avgDaily) || avgDaily <= 0) continue;

      const daysRemaining = product.stock / avgDaily;
      if (!Number.isFinite(daysRemaining) || daysRemaining > 7) continue; // only near-term risks

      const projectedStockoutDate = new Date(now.getTime() + daysRemaining * msPerDay);

      const unitMargin = Math.max(0, (product.sellingPrice || 0) - (product.buyingPrice || 0));
      const horizonDays = 3;
      const potentialUnits = Math.max(0, avgDaily * horizonDays - product.stock);
      const profitPotential = unitMargin * potentialUnits;

      alerts.push({
        productId: product.id,
        name: product.name,
        daysRemaining,
        projectedStockoutDate,
        profitPotential,
      });
    }

    return alerts
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .slice(0, 5);
  }, [recentSaleItems, allProducts]);

  useEffect(() => {
    if (settings) {
      setSettingsDraft({
        currency: settings.currency,
        currencySymbol: settings.currencySymbol,
        eodAutoPromptEnabled: settings.eodAutoPromptEnabled ?? true,
        eodClosingTime: settings.eodClosingTime ?? '18:00',
        auditSyncEnabled: settings.auditSyncEnabled ?? false,
        auditOpeningTime: settings.auditOpeningTime ?? '08:00',
        auditClosingTime: settings.auditClosingTime ?? '18:00',
        plan: settings.plan ?? 'free',
        userRole: settings.userRole ?? 'owner',
        assignedStoreId: settings.assignedStoreId ?? null,
        thermalPrinterWidth: settings.thermalPrinterWidth ?? '80mm',
        receiptFooter: settings.receiptFooter ?? 'Thank you for shopping with us!',
        autoWhatsAppEnabled: settings.autoWhatsAppEnabled ?? false,
        autoWhatsAppNumber: settings.autoWhatsAppNumber ?? '',
        autoWhatsAppMethod: settings.autoWhatsAppMethod ?? 'web',
        autoWhatsAppWebhookUrl: settings.autoWhatsAppWebhookUrl ?? '',
      });
    }
  }, [settings]);

  // Request persistent storage so the browser is less likely to evict IndexedDB data.
  useEffect(() => {
    if (!isAdminAuthenticated) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await requestPersistentStorage();
        if (!cancelled) {
          setStorageGuardActive(result.persisted === true);
        }
      } catch (e) {
        console.error('Failed to request persistent storage', e);
        if (!cancelled) setStorageGuardActive(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAdminAuthenticated]);

  // Load and subscribe to pending online orders
  useEffect(() => {
    const currentStoreForOrders = isGlobalView || !currentStoreId
      ? stores.length === 1 ? stores[0]?.id : null
      : currentStoreId;

    if (!currentStoreForOrders) {
      setPendingOrdersCount(0);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    const loadOrders = async () => {
      try {
        // Dexie-first count — never block Admin UI waiting on cloud.
        const { getPendingOnlineOrders } = await import('@/lib/onlineOrders');
        const local = await getPendingOnlineOrders(currentStoreForOrders);
        setPendingOrdersCount(local.length);

        unsubscribe = subscribeToPendingOrders(
          currentStoreForOrders,
          () => {
            setPendingOrdersCount((prev) => prev + 1);
          },
          (updatedOrder) => {
            if (String(updatedOrder.status).toLowerCase() !== 'pending') {
              setPendingOrdersCount((prev) => Math.max(0, prev - 1));
            }
          }
        );

        // Background cloud refresh only
        void refreshPendingOnlineOrdersFromCloud(currentStoreForOrders)
          .then((orders) => setPendingOrdersCount(orders.length))
          .catch(() => undefined);
      } catch (error) {
        console.error('Failed to load pending orders:', error);
        setPendingOrdersCount(0);
      }
    };

    loadOrders();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [currentStoreId, isGlobalView, stores]);

  useEffect(() => {
    // Never block the menu — show the shell immediately, fill data when ready.
    const fast = window.setTimeout(() => setLoading(false), 300);
    return () => window.clearTimeout(fast);
  }, []);

  useEffect(() => {
    // When live queries have resolved, stop showing skeleton loading.
    if (!isAdminAuthenticated) return;
    if (todaySales && todaySaleItems && allProducts) {
      setLoading(false);
    }
  }, [isAdminAuthenticated, allProducts, todaySaleItems, todaySales]);

  useEffect(() => {
    if (!isAdminAuthenticated) return;
    // EOD report has moved to /reports (salesperson).
  }, [isAdminAuthenticated, location.pathname]);

  // Set up Supabase Realtime subscriptions for instant updates
  useEffect(() => {
    if (!isAdminAuthenticated || !isSupabaseConfigured()) return;
    // Realtime pull-on-every-event freezes admin taps/navigation. Manual Sync Now only.
    setIsRealtimeConnected(false);
    const syncInterval = setInterval(() => {
      if (document.hidden) return;
      setPendingSyncs(getPendingSyncCount());
    }, 10000);
    return () => clearInterval(syncInterval);
  }, [isAdminAuthenticated, currentStoreId]);

  // Manual sync trigger
  const handleManualSync = async () => {
    toast.info('Syncing...', { id: 'manual-sync' });
    try {
      await processSyncQueue();
      await pullStoresFromSupabase();
      const pulled = await pullProductsFromSupabase(isGlobalView ? undefined : currentStoreId, undefined, {
        persist: true,
      });
      await pullSalesFromSupabase(isGlobalView ? undefined : currentStoreId);
      setPendingSyncs(getPendingSyncCount());
      toast.success(
        pulled.length > 0 ? `Sync completed · ${pulled.length} products on device` : 'Sync completed!',
        { id: 'manual-sync' }
      );
    } catch (error) {
      console.error('Manual sync error:', error);
      toast.error('Sync failed', { id: 'manual-sync' });
    }
  };

  const resolvedSales: Sale[] = todaySales ?? [];
  const resolvedSaleItems = todaySaleItems ?? [];
  const resolvedYesterdaySaleItems = yesterdaySaleItems ?? [];
  const resolvedLowStock: Product[] = lowStockProducts ?? [];

  const handlePinSubmit = async (pin: string) => {
    if (!isPinSetup) {
      await setupPin(pin);
    } else {
      const success = await login(pin);
      if (!success) {
        setPinError('Incorrect PIN');
      }
    }
  };

  const getShareableOrigin = async () => {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return window.location.origin;
    }
    try {
      const resp = await fetch('/api/pipeline/health');
      if (resp.ok) {
        const data = await resp.json();
        const lanIp = Array.isArray(data?.lanIps)
          ? data.lanIps.find((ip: string) => String(ip).startsWith('10.') || String(ip).startsWith('192.168.')) ||
            data.lanIps[0]
          : null;
        if (lanIp) {
          const port = window.location.port || '8080';
          return `http://${lanIp}:${port}`;
        }
      }
    } catch {
      /* ignore */
    }
    return window.location.origin;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const origin = await getShareableOrigin();
      if (!cancelled) setShareOrigin(origin);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleShareStoreLink = async () => {
    // if app is in global view but only one store exists, share that store
    let storeId = currentStoreId;
    if (storeId === '__all__' && stores.length === 1) {
      storeId = stores[0].id;
    }
    if (!storeId || storeId === '__all__') return; // nothing to share

    const slug = currentStore?.name ? slugify(currentStore.name) : '';
    const origin = await getShareableOrigin();
    const url = `${origin}/shop/${storeId}${slug ? `/${slug}` : ''}`;
    const title = currentStore?.name ? `${currentStore.name} - Online Store` : 'Online Store';
    const text = 'Check out our products and place orders online!';

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text,
          url,
        });
      } catch (error) {
        // User cancelled or error occurred
        console.log('Share cancelled or failed:', error);
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Store link copied to clipboard!');
      } catch (error) {
        // Final fallback: show the URL
        toast.error('Unable to share. URL: ' + url);
      }
    }
  };

  const handleShareStoreFlyer = async () => {
    let storeId = currentStoreId;
    if (storeId === '__all__' && stores.length === 1) {
      storeId = stores[0].id;
    }
    if (!storeId || storeId === '__all__') return;

    const store = stores.find(s => s.id === storeId);
    if (!store) return;

    try {
      toast.info('Generating store flyer...', { duration: 2000 });
      const flyerEl = document.getElementById('admin-store-flyer-capture');
      if (flyerEl) {
        flyerEl.style.visibility = 'hidden';
        flyerEl.style.display = 'block';
        const canvas = await html2canvas(flyerEl, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
        });
        flyerEl.style.display = 'none';

        const shareOrigin = await getShareableOrigin();
        const shopUrl = `${shareOrigin}/shop/${storeId}`;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

        if (!blob) {
          toast.error('Failed to generate flyer');
          return;
        }

        const file = new File([blob], `${store.name}-flyer.png`, { type: 'image/png' });
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

        toast.success('Flyer downloaded! Ready to share on WhatsApp.', { duration: 4000 });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${store.name}-flyer.png`;
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
      toast.error('Failed to prepare flyer sharing');
    }
  };

  // Calculate metrics (safe even when not authenticated)
  const totalRevenue = resolvedSales.reduce((sum, sale) => sum + sale.total, 0);
  const totalDiscount = resolvedSales.reduce((sum, sale) => sum + (sale.discount ?? 0), 0);
  const grossProfit = resolvedSaleItems.reduce(
    (sum, i) => sum + (i.priceAtSale - i.buyingPriceAtSale) * i.qty,
    0
  );
  const totalProfit = grossProfit - totalDiscount;
  const yesterdayGrossProfit = resolvedYesterdaySaleItems.reduce(
    (sum, i) => sum + (i.priceAtSale - i.buyingPriceAtSale) * i.qty,
    0
  );
  const profitDelta = grossProfit - yesterdayGrossProfit;
  const profitGrowthPct =
    yesterdayGrossProfit > 0 ? (profitDelta / yesterdayGrossProfit) * 100 : null;
  const transactionCount = resolvedSales.length;
  const dailyGoal = (settings as any)?.dailySalesGoal ?? 0;

  const salesByStore = isGlobalView
    ? resolvedSales.reduce((acc, sale) => {
        const id = sale.storeId || 'unknown';
        const existing = acc.get(id) ?? {
          storeId: id,
          name: stores.find((s) => s.id === id)?.name || 'Unknown store',
          total: 0,
        };
        existing.total += sale.total;
        acc.set(id, existing);
        return acc;
      }, new Map<string, { storeId: string; name: string; total: number }>())
    : new Map<string, { storeId: string; name: string; total: number }>();

  const weekWindow = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }, []);

  const weeklySales = useLiveQuery(
    async () => {
      if (!deferredReady) return [];
      const list = await dexieDb.sales
        .where('createdAt')
        .between(weekWindow.start, weekWindow.end, true, true)
        .toArray();
      if (isGlobalView) return list;
      return list.filter((s) => s.storeId === currentStoreId);
    },
    [currentStoreId, isGlobalView, weekWindow.start, weekWindow.end, deferredReady]
  );

  const topSalesperson = useMemo(() => {
    const sales = weeklySales ?? [];
    if (sales.length === 0) return null;
    const by = new Map<string, { total: number; displayName: string }>();
    for (const s of sales) {
      const rawName = (s.cashierName || '').trim() || 'Unknown';
      const userKey = s.cashierId || rawName.toLowerCase().replace(/\s+/g, ' ').trim() || 'unknown';
      const existing = by.get(userKey);
      if (existing) {
        existing.total += s.total ?? 0;
        if (!existing.displayName || existing.displayName === 'Unknown') existing.displayName = rawName;
      } else {
        by.set(userKey, { total: s.total ?? 0, displayName: rawName });
      }
    }
    let best: { name: string; total: number } | null = null;
    for (const entry of by.values()) {
      if (!best || entry.total > best.total) best = { name: entry.displayName, total: entry.total };
    }
    return best;
  }, [weeklySales]);

  // EOD moved to /reports (salesperson)

  // Show PIN entry if not authenticated
  if (!isAdminAuthenticated) {
    return (
      <>
        <PinEntry
          onSubmit={handlePinSubmit}
          onCancel={() => window.history.back()}
          onForgotPin={() => setShowPinReset(true)}
          title={isPinSetup ? 'Enter Admin PIN' : 'Create Admin PIN'}
          subtitle={
            isPinSetup
              ? 'Enter your PIN to access the admin dashboard'
              : 'Set up a 4-6 digit PIN to secure admin access'
          }
          error={pinError}
          isSetup={!isPinSetup}
        />
        <PinResetDialog 
          open={showPinReset} 
          onOpenChange={setShowPinReset} 
        />
      </>
    );
  }

  const quickLinks = [
    ...(isSuperAdmin
      ? [{ to: '/admin/ai-stock', icon: BrainCircuit, label: 'AI Stock Processing', color: 'bg-sky-600' }]
      : []),
    { to: '/admin/companies', icon: Users, label: 'Add Staff', color: 'bg-purple-500' },
    { to: '/admin/inventory', icon: Package, label: 'Inventory', color: 'bg-blue-500' },
    { to: '/admin/shelf-labels', icon: Activity, label: 'Shelf Labels', color: 'bg-emerald-500' },
    { to: '/admin/categories', icon: FolderOpen, label: 'Categories', color: 'bg-green-500' },
    { to: '/admin/financials', icon: BarChart3, label: 'Financial Hub', color: 'bg-violet-500' },
    { to: '/admin/tax', icon: Percent, label: 'Tax Settings', color: 'bg-fuchsia-500' },
    { to: '/admin/settings/zra', icon: ShieldCheck, label: 'ZRA Smart Invoice', color: 'bg-emerald-500' },
    { to: '/admin/settings/customer-display', icon: Activity, label: 'Customer Display', color: 'bg-sky-500' },
    { to: '/admin/settings', icon: Settings, label: 'Settings', color: 'bg-orange-500' },
  ];

  const handleSaveSettings = async () => {
    if (!settings || !settingsDraft) return;
    try {
      await saveSettings({
        ...settings,
        currency: settingsDraft.currency,
        currencySymbol: settingsDraft.currencySymbol,
        eodAutoPromptEnabled: settingsDraft.eodAutoPromptEnabled ?? true,
        eodClosingTime: settingsDraft.eodClosingTime ?? '18:00',
        auditSyncEnabled: settingsDraft.auditSyncEnabled ?? false,
        auditOpeningTime: settingsDraft.auditOpeningTime ?? '08:00',
        auditClosingTime: settingsDraft.auditClosingTime ?? '18:00',
        plan: settingsDraft.plan ?? settings.plan ?? 'free',
        userRole: settingsDraft.userRole ?? settings.userRole ?? 'owner',
        assignedStoreId:
          settingsDraft.userRole === 'staff' ? settingsDraft.assignedStoreId ?? null : null,
        thermalPrinterWidth: settingsDraft.thermalPrinterWidth ?? settings.thermalPrinterWidth ?? '80mm',
        receiptFooter: settingsDraft.receiptFooter ?? settings.receiptFooter ?? 'Thank you for shopping with us!',
        autoWhatsAppEnabled: settingsDraft.autoWhatsAppEnabled ?? settings.autoWhatsAppEnabled ?? false,
        autoWhatsAppNumber: settingsDraft.autoWhatsAppNumber ?? settings.autoWhatsAppNumber ?? '',
        autoWhatsAppMethod: settingsDraft.autoWhatsAppMethod ?? settings.autoWhatsAppMethod ?? 'web',
        autoWhatsAppWebhookUrl:
          settingsDraft.autoWhatsAppWebhookUrl ?? settings.autoWhatsAppWebhookUrl ?? '',
        updatedAt: new Date(),
      });
      await refreshSettings();
      toast.success('Settings saved');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save settings');
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const json = await exportAllData();
      const blob = new Blob([json], { type: 'application/json' });
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const filename = `mthunzi-pos-backup-${stamp}.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Backup downloaded');
    } catch (e) {
      console.error(e);
      toast.error('Failed to export backup');
    }
  };

  const handleImportBackupFile = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const restoreStoreId = await importData(text);
      await refreshSettings();
      await refreshStores();

      if (restoreStoreId) {
        if (restoreStoreId !== currentStoreId) {
          setCurrentStoreId(restoreStoreId);
        }

        if (navigator.onLine && isSupabaseConfigured()) {
          try {
            await pullStoresFromSupabase();

            const [categories, products, sales] = await Promise.all([
              pullCategoriesFromSupabase(restoreStoreId),
              pullProductsFromSupabase(restoreStoreId),
              pullSalesFromSupabase(restoreStoreId),
            ]);

            if (categories.length > 0) {
              await dexieDb.categories.bulkPut(categories);
            }

            if (products.length > 0) {
              await dexieDb.products.bulkPut(products);
            }

            if (sales.length > 0) {
              await dexieDb.sales.bulkPut(sales);
              await dexieDb.saleItems.where('storeId').equals(restoreStoreId).delete();
              for (const sale of sales) {
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

            await bulkSyncStoresToSupabase(restoreStoreId);
            await bulkSyncCategoriesToSupabase(restoreStoreId);
            await bulkSyncProductsToSupabase();
            await bulkSyncSalesToSupabase(restoreStoreId);
            await bulkSyncOnlineOrdersToSupabase(restoreStoreId);
            await bulkSyncAuditLogsToSupabase();
            await processSyncQueue();
          } catch (syncError) {
            console.warn('Backup imported but cloud sync failed:', syncError);
          }
        }
      }

      toast.success('Backup imported');
      toast.message('Reload recommended');
    } catch (e) {
      console.error('Failed to import backup:', e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to import backup: ${errorMessage}`);
    } finally {
      setImporting(false);
    }
  };

  // Demo seeding removed

  if (loading) {
    return (
      <AppShell title={isSettingsRoute ? 'Settings' : 'Admin Dashboard'}>
        <div className="flex items-center justify-center p-12">
          <div className="text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
            <p className="text-muted-foreground">Loading dashboard...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title={isSettingsRoute ? 'Settings' : 'Admin Dashboard'}>
      {isSettingsRoute ? (
        <div className="space-y-6 p-4">
          {(() => {
            const time = settingsDraft?.eodClosingTime ?? '';
            const timeValid = /^\d{1,2}:\d{2}$/.test(time);
            const needsValidTime = Boolean(settingsDraft?.eodAutoPromptEnabled);
            const auditOpeningTime = settingsDraft?.auditOpeningTime ?? '';
            const auditClosingTime = settingsDraft?.auditClosingTime ?? '';
            const auditTimeValid = /^\d{1,2}:\d{2}$/.test(auditOpeningTime) && /^\d{1,2}:\d{2}$/.test(auditClosingTime);
            const needsAuditTime = Boolean(settingsDraft?.auditSyncEnabled);
            const canSave =
              Boolean(settingsDraft?.currency) &&
              Boolean(settingsDraft?.currencySymbol) &&
              (!needsValidTime || timeValid) &&
              (!needsAuditTime || auditTimeValid);

            return (
              <>
          {storageGuardActive && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/50 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-100">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <span className="font-semibold">Data Guard Active</span>
              <span className="hidden text-[11px] sm:inline text-emerald-800/80 dark:text-emerald-200/80">
                Browser storage is locked as persistent to reduce data-loss risk.
              </span>
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Store access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Use these options to connect this device to an existing store or to open the boss/admin login flow.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button className="w-full" onClick={() => navigate('/join-store')}>
                  Join existing store
                </Button>
                <Button variant="outline" className="w-full" onClick={() => navigate('/boss-login')}>
                  Boss / admin login
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>ZRA Smart Invoice</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Configure company-specific TPIN, device credentials, and Smart Invoice enablement.
              </p>
              <Button className="w-full" variant="outline" onClick={() => navigate('/admin/settings/zra')}>
                Open ZRA Smart Invoice
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer Display</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Configure the rear pole / VFD display (Serial / USB COM) and open the second-screen price
                display for customers.
              </p>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => navigate('/admin/settings/customer-display')}
              >
                Open Customer Display Settings
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Currency</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={settingsDraft?.currency ?? ''}
                  onValueChange={(code) => {
                    const opt = getCurrencyOption(code);
                    setSettingsDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            currency: code,
                            currencySymbol: opt?.symbol ?? prev.currencySymbol,
                          }
                        : {
                            currency: code,
                            currencySymbol: opt?.symbol ?? settings?.currencySymbol ?? 'K',
                            eodAutoPromptEnabled: settings?.eodAutoPromptEnabled ?? true,
                            eodClosingTime: settings?.eodClosingTime ?? '18:00',
                            plan: settings?.plan ?? 'free',
                            userRole: settings?.userRole ?? 'owner',
                            assignedStoreId: settings?.assignedStoreId ?? null,
                            thermalPrinterWidth: settings?.thermalPrinterWidth ?? '80mm',
                            receiptFooter: settings?.receiptFooter ?? 'Thank you for shopping with us!',
                          }
                    );
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

              <div className="space-y-2">
                <Label>Currency symbol</Label>
                <Input
                  value={settingsDraft?.currencySymbol ?? ''}
                  onChange={(e) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? { ...prev, currencySymbol: e.target.value }
                        : {
                            currency: settings?.currency ?? 'ZMW',
                            currencySymbol: e.target.value,
                            eodAutoPromptEnabled: settings?.eodAutoPromptEnabled ?? true,
                            eodClosingTime: settings?.eodClosingTime ?? '18:00',
                            plan: settings?.plan ?? 'free',
                            userRole: settings?.userRole ?? 'owner',
                            assignedStoreId: settings?.assignedStoreId ?? null,
                            thermalPrinterWidth: settings?.thermalPrinterWidth ?? '80mm',
                            receiptFooter: settings?.receiptFooter ?? 'Thank you for shopping with us!',
                          }
                    )
                  }
                  placeholder={getCurrencyOption(settingsDraft?.currency)?.symbol ?? 'R'}
                />
                <p className="text-xs text-muted-foreground">
                  Example: R, $, €, £, KSh
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigate('/admin')}>
                  Back
                </Button>
                <Button
                  onClick={handleSaveSettings}
                  disabled={!canSave}
                >
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hardware (Offline)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Thermal paper width</Label>
                <Select
                  value={settingsDraft?.thermalPrinterWidth ?? '80mm'}
                  onValueChange={(w) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? { ...prev, thermalPrinterWidth: w as '58mm' | '80mm' }
                        : {
                            currency: settings?.currency ?? 'ZMW',
                            currencySymbol: settings?.currencySymbol ?? 'K',
                            eodAutoPromptEnabled: settings?.eodAutoPromptEnabled ?? true,
                            eodClosingTime: settings?.eodClosingTime ?? '18:00',
                            plan: settings?.plan ?? 'free',
                            userRole: settings?.userRole ?? 'owner',
                            assignedStoreId: settings?.assignedStoreId ?? null,
                            thermalPrinterWidth: w as '58mm' | '80mm',
                            receiptFooter: settings?.receiptFooter ?? 'Thank you for shopping with us!',
                          }
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58mm">58mm (small printer)</SelectItem>
                    <SelectItem value="80mm">80mm (standard printer)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Used for ESC/POS receipt formatting when printing offline.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Receipt footer</Label>
                <Input
                  value={settingsDraft?.receiptFooter ?? ''}
                  onChange={(e) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? { ...prev, receiptFooter: e.target.value }
                        : {
                            currency: settings?.currency ?? 'ZMW',
                            currencySymbol: settings?.currencySymbol ?? 'K',
                            eodAutoPromptEnabled: settings?.eodAutoPromptEnabled ?? true,
                            eodClosingTime: settings?.eodClosingTime ?? '18:00',
                            plan: settings?.plan ?? 'free',
                            userRole: settings?.userRole ?? 'owner',
                            assignedStoreId: settings?.assignedStoreId ?? null,
                            thermalPrinterWidth: settings?.thermalPrinterWidth ?? '80mm',
                            receiptFooter: e.target.value,
                          }
                    )
                  }
                  placeholder="Thank you for shopping with us!"
                />
              </div>

              <div className="rounded-md border p-3 text-xs">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Printer status</span>
                    <span className="font-medium">
                      {printerState.kind === 'connected'
                        ? `Connected (${printerState.deviceName}${
                            printerState.transport === 'serial'
                              ? ' · Serial'
                              : printerState.transport === 'usb'
                                ? ' · USB'
                                : printerState.transport === 'ble'
                                  ? ' · BLE'
                                  : printerState.transport === 'network'
                                    ? ' · Wi‑Fi / LAN'
                                    : ''
                          })`
                        : printerState.kind === 'connecting'
                          ? 'Connecting…'
                          : printerState.kind === 'unsupported'
                            ? 'Unsupported'
                            : printerState.kind === 'error'
                              ? 'Error'
                              : 'Disconnected'}
                    </span>
                  </div>
                  {printerState.kind === 'error' && (
                    <p className="text-destructive">{printerState.error}</p>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1">
                <p className="font-medium text-foreground">Cable / USB / Wi‑Fi / Bluetooth</p>
                <p className="text-muted-foreground">
                  Use <span className="font-medium">Connect Cable / USB</span> for serial COM printers and USB-to-serial adapters,
                  <span className="font-medium"> Connect Wi‑Fi / LAN</span> for IP-based thermal printers on the same network,
                  and <span className="font-medium">Connect BLE</span> for Bluetooth LE printers.
                </p>
                <p className="text-muted-foreground">
                  For Windows Bluetooth printers such as RPP02N: pair in Bluetooth settings, then use
                  <span className="font-medium"> Connect Cable / USB</span> if the printer exposes a COM port or
                  <span className="font-medium"> Connect Serial / COM</span> when using the Bluetooth virtual COM port.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={async () => {
                    try {
                      const ok = await discoverSerialPrinter();
                      if (ok) toast.success('Serial / COM printer connected');
                    } catch (e) {
                      console.error(e);
                      toast.error((e as Error)?.message || 'Failed to connect serial printer');
                    }
                  }}
                >
                  Connect Cable / USB
                </Button>

                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const ok = await discoverUsbPrinter();
                      if (ok) toast.success('USB printer connected');
                    } catch (e) {
                      console.error(e);
                      toast.error((e as Error)?.message || 'Failed to connect USB printer');
                    }
                  }}
                >
                  Connect USB Direct
                </Button>

                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const hostInput = window.prompt('Printer IP address or hostname', '192.168.1.50');
                      if (!hostInput) return;
                      const portInput = window.prompt('Printer port', '9100');
                      const port = Number(portInput || '9100');
                      const ok = await bluetoothPrinterService.connectNetworkPrinter(hostInput, Number.isFinite(port) ? port : 9100);
                      if (ok) toast.success('Wi‑Fi / LAN printer connected');
                    } catch (e) {
                      console.error(e);
                      toast.error((e as Error)?.message || 'Failed to connect Wi‑Fi / LAN printer');
                    }
                  }}
                >
                  Connect Wi‑Fi / LAN
                </Button>

                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const ok = await discoverBlePrinter();
                      if (ok) toast.success('BLE printer connected');
                    } catch (e) {
                      console.error(e);
                      toast.error((e as Error)?.message || 'Failed to connect BLE printer');
                    }
                  }}
                >
                  Connect BLE
                </Button>

                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const ok = await discoverPrinter();
                      if (ok) toast.success('Printer connected');
                    } catch (e) {
                      console.error(e);
                      toast.error((e as Error)?.message || 'Failed to connect printer');
                    }
                  }}
                >
                  Auto Discover
                </Button>

                <Button
                  variant="outline"
                  onClick={async () => {
                    const ok = await reconnectPrinter();
                    if (ok) toast.success('Reconnected to last printer');
                    else toast.message('Auto-reconnect not available. Use Connect Serial / COM.');
                  }}
                >
                  Auto-reconnect
                </Button>

                <Button
                  variant="outline"
                  onClick={async () => {
                    if (!settings) {
                      toast.error('Settings not loaded');
                      return;
                    }
                    try {
                      await testPrint(settings);
                      toast.success('Test print sent');
                    } catch (e) {
                      console.error(e);
                      toast.error((e as Error)?.message || 'Test print failed');
                    }
                  }}
                >
                  Test Print
                </Button>

                <Button
                  variant="destructive"
                  onClick={async () => {
                    await disconnectPrinter();
                    toast.message('Printer disconnected');
                  }}
                >
                  Disconnect
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                ESC/POS is generated offline. RPP02N uses the Bluetooth COM port (Serial). BLE is only for printers
                that advertise a GATT UART service.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>About & Support</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  Designed and Developed by Stephen Zulu. Lead Engineer at Mthunzi-Tech-Labs.
                </p>
                <p className="text-xs text-muted-foreground">
                  Version: <span className="font-semibold">{SOFTWARE_VERSION}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Device ID: <span className="font-mono font-semibold">{getDeviceId()}</span>
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <a
                    href={`https://wa.me/${MTZ_SUPPORT.whatsappNumber}?text=${encodeURIComponent(
                      `Hi Stephen, I need support for Device ID: ${getDeviceId()}`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp Support
                  </a>
                </Button>

                <Button asChild variant="outline">
                  <a href={`mailto:${MTZ_SUPPORT.email}`}>Email</a>
                </Button>

                <Button asChild variant="outline">
                  <a href={`tel:${MTZ_SUPPORT.phone}`}>Call</a>
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                For faster support, include the Device ID in your message.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plan & Access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Plan</Label>
                <Select
                  value={settingsDraft?.plan ?? 'free'}
                  onValueChange={(plan) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? { ...prev, plan: plan as 'free' | 'premium' }
                        : {
                            currency: settings?.currency ?? 'ZMW',
                            currencySymbol: settings?.currencySymbol ?? 'K',
                            eodAutoPromptEnabled: settings?.eodAutoPromptEnabled ?? true,
                            eodClosingTime: settings?.eodClosingTime ?? '18:00',
                            plan: plan as 'free' | 'premium',
                            userRole: settings?.userRole ?? 'owner',
                            assignedStoreId: settings?.assignedStoreId ?? null,
                            thermalPrinterWidth: settings?.thermalPrinterWidth ?? '80mm',
                            receiptFooter: settings?.receiptFooter ?? 'Thank you for shopping with us!',
                          }
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free — 1 store</SelectItem>
                    <SelectItem value="premium">Premium — Multiple stores</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={settingsDraft?.userRole ?? 'owner'}
                  onValueChange={(role) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? { ...prev, userRole: role as 'owner' | 'staff' }
                        : {
                            currency: settings?.currency ?? 'ZMW',
                            currencySymbol: settings?.currencySymbol ?? 'K',
                            eodAutoPromptEnabled: settings?.eodAutoPromptEnabled ?? true,
                            eodClosingTime: settings?.eodClosingTime ?? '18:00',
                            plan: settings?.plan ?? 'free',
                            userRole: role as 'owner' | 'staff',
                            assignedStoreId: settings?.assignedStoreId ?? null,
                            thermalPrinterWidth: settings?.thermalPrinterWidth ?? '80mm',
                            receiptFooter: settings?.receiptFooter ?? 'Thank you for shopping with us!',
                          }
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owner">Owner / Admin</SelectItem>
                    <SelectItem value="staff">Salesperson (single store)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {settingsDraft?.userRole === 'staff' && (
                <div className="space-y-2">
                  <Label>Assigned Store</Label>
                  <Select
                    value={settingsDraft.assignedStoreId ?? ''}
                    onValueChange={(id) =>
                      setSettingsDraft((prev) => (prev ? { ...prev, assignedStoreId: id } : prev))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select store" />
                    </SelectTrigger>
                    <SelectContent>
                      {stores.length === 0 ? (
                        <SelectItem value="__no_stores__" disabled>
                          No stores available
                        </SelectItem>
                      ) : (
                        stores.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                            {s.location_name ? ` — ${s.location_name}` : ''}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Assign this device/user to a single store. They will not be able to switch stores.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Audit Sync Schedule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Auto sync at opening and closing</div>
                  <div className="text-xs text-muted-foreground">
                    Syncs today's sales at closing and yesterday's sales at opening for Vantage audit automation.
                  </div>
                </div>
                <Switch
                  checked={Boolean(settingsDraft?.auditSyncEnabled)}
                  onCheckedChange={(checked) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? { ...prev, auditSyncEnabled: checked }
                        : {
                            currency: settings?.currency ?? 'ZMW',
                            currencySymbol: settings?.currencySymbol ?? 'K',
                            eodAutoPromptEnabled: settings?.eodAutoPromptEnabled ?? true,
                            eodClosingTime: settings?.eodClosingTime ?? '18:00',
                            auditSyncEnabled: checked,
                            auditOpeningTime: settings?.auditOpeningTime ?? '08:00',
                            auditClosingTime: settings?.auditClosingTime ?? '18:00',
                            plan: settings?.plan ?? 'free',
                            userRole: settings?.userRole ?? 'owner',
                            assignedStoreId: settings?.assignedStoreId ?? null,
                            thermalPrinterWidth: settings?.thermalPrinterWidth ?? '80mm',
                            receiptFooter: settings?.receiptFooter ?? 'Thank you for shopping with us!',
                          }
                    )
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="auditOpeningTime">Opening time</Label>
                <Input
                  id="auditOpeningTime"
                  type="time"
                  value={settingsDraft?.auditOpeningTime ?? ''}
                  onChange={(e) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? { ...prev, auditOpeningTime: e.target.value }
                        : {
                            currency: settings?.currency ?? 'ZMW',
                            currencySymbol: settings?.currencySymbol ?? 'K',
                            eodAutoPromptEnabled: settings?.eodAutoPromptEnabled ?? true,
                            eodClosingTime: settings?.eodClosingTime ?? '18:00',
                            auditSyncEnabled: true,
                            auditOpeningTime: e.target.value,
                            auditClosingTime: settings?.auditClosingTime ?? '18:00',
                            plan: settings?.plan ?? 'free',
                            userRole: settings?.userRole ?? 'owner',
                            assignedStoreId: settings?.assignedStoreId ?? null,
                            thermalPrinterWidth: settings?.thermalPrinterWidth ?? '80mm',
                            receiptFooter: settings?.receiptFooter ?? 'Thank you for shopping with us!',
                          }
                    )
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="auditClosingTime">Closing time</Label>
                <Input
                  id="auditClosingTime"
                  type="time"
                  value={settingsDraft?.auditClosingTime ?? ''}
                  onChange={(e) =>
                    setSettingsDraft((prev) =>
                      prev
                        ? { ...prev, auditClosingTime: e.target.value }
                        : {
                            currency: settings?.currency ?? 'ZMW',
                            currencySymbol: settings?.currencySymbol ?? 'K',
                            eodAutoPromptEnabled: settings?.eodAutoPromptEnabled ?? true,
                            eodClosingTime: settings?.eodClosingTime ?? '18:00',
                            auditSyncEnabled: true,
                            auditOpeningTime: settings?.auditOpeningTime ?? '08:00',
                            auditClosingTime: e.target.value,
                            plan: settings?.plan ?? 'free',
                            userRole: settings?.userRole ?? 'owner',
                            assignedStoreId: settings?.assignedStoreId ?? null,
                            thermalPrinterWidth: settings?.thermalPrinterWidth ?? '80mm',
                            receiptFooter: settings?.receiptFooter ?? 'Thank you for shopping with us!',
                          }
                    )
                  }
                />
                {!auditTimeValid && ((settingsDraft?.auditOpeningTime ?? '') !== '' || (settingsDraft?.auditClosingTime ?? '') !== '') && (
                  <p className="text-xs text-destructive">Please enter valid times for both opening and closing (HH:MM).</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Auto WhatsApp EOD Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Prepare/send report at closing time</div>
                  <div className="text-xs text-muted-foreground">
                    At closing time, the app will prepare an End-of-Day WhatsApp report. In browsers,
                    WhatsApp sending requires a tap unless you use a webhook.
                  </div>
                </div>
                <Switch
                  checked={Boolean(settingsDraft?.autoWhatsAppEnabled)}
                  onCheckedChange={(checked) =>
                    setSettingsDraft((prev) => ({ ...prev, autoWhatsAppEnabled: checked }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>WhatsApp number (E.164 digits)</Label>
                <Input
                  value={settingsDraft?.autoWhatsAppNumber ?? ''}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({ ...prev, autoWhatsAppNumber: e.target.value }))
                  }
                  placeholder="260979171520"
                />
                <p className="text-xs text-muted-foreground">
                  Tip: digits only recommended (no +, spaces).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Send method</Label>
                <Select
                  value={settingsDraft?.autoWhatsAppMethod ?? 'web'}
                  onValueChange={(m) =>
                    setSettingsDraft((prev) => ({ ...prev, autoWhatsAppMethod: m as 'web' | 'webhook' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="web">Web (tap to send)</SelectItem>
                    <SelectItem value="webhook">Webhook (fully automatic)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(settingsDraft?.autoWhatsAppMethod ?? 'web') === 'webhook' && (
                <div className="space-y-2">
                  <Label>Webhook URL</Label>
                  <Input
                    value={settingsDraft?.autoWhatsAppWebhookUrl ?? ''}
                    onChange={(e) =>
                      setSettingsDraft((prev) => ({ ...prev, autoWhatsAppWebhookUrl: e.target.value }))
                    }
                    placeholder="https://your-server.example.com/whatsapp/send"
                  />
                  <p className="text-xs text-muted-foreground">
                    Endpoint receives JSON: {'{ to, text, dateKey }'}.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Backup & Restore</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Download an encrypted JSON snapshot of all products, categories, sales, reports and
                settings on this device. Your data stays on your hardware until you choose to
                import it on another device.
              </p>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={handleDownloadBackup} className="flex-1">
                  Download Backup (JSON)
                </Button>
                <label className="flex-1">
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    disabled={importing}
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      await handleImportBackupFile(f);
                      e.target.value = '';
                    }}
                  />
                  <Button asChild variant="default" className="w-full" disabled={importing}>
                    <span>{importing ? 'Importing…' : 'Import Backup'}</span>
                  </Button>
                </label>
              </div>

              {/* Demo mode removed */}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Safety Center</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Protect your sales history</p>
              <p>
                Do <span className="font-semibold">not</span> use options like
                {' '}
                <span className="font-semibold">"Clear Browser Cache"</span>,
                {' '}
                <span className="font-semibold">"Clear Website Data"</span> or
                {' '}
                <span className="font-semibold">"Reset Safari"</span> for this app.
                These actions delete the local database that keeps your sales records.
              </p>
              <p>
                Before changing devices or reinstalling, always use
                {' '}
                <span className="font-semibold">Download Backup (JSON)</span>
                {' '}
                to export a backup of your data. You can import this backup on the new
                device to restore your history.
              </p>
            </CardContent>
          </Card>
              </>
            );
          })()}
        </div>
      ) : (
        <div className="space-y-6 p-4">
        {/* View scope indicator + live sync status */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <div className="flex flex-col">
            <span className="font-medium text-muted-foreground">View</span>
            <span className="text-[13px] font-semibold">
              {isGlobalView
                ? 'All Stores (Global View)'
                : currentStore?.name || 'This device store'}
            </span>
            {isGlobalView ? (
              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Global Dashboard across all branches
              </span>
            ) : (
              stores.length > 1 && (
                <span className="mt-0.5 text-[11px] text-muted-foreground">
                  Switch to "All Stores (Global View)" in the header to see owner-wide totals.
                </span>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isGlobalView && currentStoreId && (
              <Button
                onClick={handleShareStoreLink}
                variant="outline"
                size="sm"
                className="gap-2 bg-blue-50 border-blue-200 hover:bg-blue-100"
              >
                <Share2 className="h-4 w-4 text-blue-600" />
                <span className="hidden sm:inline text-blue-700">Share Store</span>
              </Button>
            )}
            {!isGlobalView && currentStore?.location_name && (
              <Badge variant="outline" className="text-[11px]">
                {currentStore.location_name}
              </Badge>
            )}
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span
                className={
                  'h-2 w-2 rounded-full ' +
                  (isRealtimeConnected ? 'bg-emerald-500' : 'bg-muted-foreground/60')
                }
              />
              <span className="font-medium">
                {isRealtimeConnected ? 'Live Sync Active' : 'Local-first · Sync on demand'}
              </span>
            </div>
          </div>
        </div>
        {/* Confetti when daily sales goal is reached */}
        {dailyGoal > 0 && (
          <ConfettiGoal goalAmount={dailyGoal} currentTotal={totalRevenue} />
        )}

        {/* Cloud Sync Status + Multi-store helper */}
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="md:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Cloud Sync
              </CardTitle>
              <Cloud
                className={
                  isRealtimeConnected
                    ? 'h-4 w-4 text-emerald-500'
                    : 'h-4 w-4 text-muted-foreground'
                }
              />
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">
                {isSupabaseConfigured()
                  ? 'Offline-first mode. Tap Sync Now when you want cloud updates — keeps taps instant.'
                  : 'Supabase not configured. Admin can connect cloud later.'}
              </p>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Pending sync items</span>
                <span className="font-semibold">{pendingSyncs}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full justify-center gap-2"
                onClick={handleManualSync}
                disabled={!isSupabaseConfigured()}
              >
                <RefreshCw className="h-4 w-4" />
                Sync Now
              </Button>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Multi-Store (Owner View)
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                Add branches and switch between them. Choose "All Stores (Global View)" to see an owner-wide dashboard.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => navigate('/admin/stores')}
                >
                  Manage Stores / Branches
                </Button>
                {stores.length > 1 && !isGlobalView && (
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => setCurrentStoreId('__all__')}
                  >
                    Switch to Global View
                  </Button>
                )}
                {stores.length > 0 && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    Stores configured: <span className="font-semibold">{stores.length}</span>
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Pending Orders Notification */}
        {pendingOrdersCount > 0 && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-amber-600 dark:text-amber-500" />
                <CardTitle className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  Pending Online Orders
                </CardTitle>
              </div>
              <Badge className="bg-amber-600 text-white dark:bg-amber-700">
                {pendingOrdersCount} {pendingOrdersCount === 1 ? 'order' : 'orders'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                You have {pendingOrdersCount} new {pendingOrdersCount === 1 ? 'order' : 'orders'} from customers who placed them through your online marketplace. Review and confirm receipt to update inventory.
              </p>
              <Button
                onClick={() => navigate('/sales')}
                className="w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Package className="h-4 w-4" />
                View Orders & Confirm Receipt
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Online Marketplace Section */}
        <section>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-blue-600" />
                <CardTitle className="text-sm font-medium">Online Marketplace</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {(() => {
                // if there's exactly one store we can share immediately even if global view is selected
                const effectiveStoreId =
                  stores.length === 1
                    ? stores[0].id
                    : isGlobalView
                    ? ''
                    : currentStoreId;

                if (!effectiveStoreId) {
                  return (
                    <>
                      <p className="text-xs text-muted-foreground mb-3">
                        You're viewing all stores. Select a specific store to generate and share its marketplace link with customers.
                      </p>
                      {stores.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium">Switch to a store's dashboard:</p>
                          <div className="grid gap-2">
                            {stores.map((store) => (
                              <Button
                                key={store.id}
                                onClick={() => setCurrentStoreId(store.id)}
                                variant="outline"
                                className="justify-start h-auto py-2 px-3 text-left"
                              >
                                <div className="flex-1">
                                  <div className="text-sm font-medium">{store.name}</div>
                                  {store.location_name && (
                                    <div className="text-xs text-muted-foreground">{store.location_name}</div>
                                  )}
                                </div>
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                }

                // shareable id exists
                const slug = stores.length === 1 ? slugify(stores[0].name) : currentStore?.name ? slugify(currentStore.name) : '';
                const shareUrl = `${shareOrigin}/shop/${effectiveStoreId}${slug ? `/${slug}` : ''}`;
                return (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Share your online store with customers. Use the Wi‑Fi/network link (not localhost) so phones can place remote orders on this shop.
                    </p>
                    <div className="space-y-2">
                      <p className="text-xs font-medium">Marketplace Link:</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value={shareUrl}
                          className="flex-1 px-3 py-2 text-xs border rounded bg-muted"
                        />
                        <Button
                          onClick={() => {
                            navigator.clipboard.writeText(shareUrl);
                            toast.success('Link copied to clipboard');
                          }}
                          variant="outline"
                          size="sm"
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                    <Button
                      onClick={handleShareStoreLink}
                      className="w-full gap-2 bg-blue-600 hover:bg-blue-700"
                    >
                      <Share2 className="h-4 w-4" />
                      Share Store Link
                    </Button>
                    <Button
                      onClick={handleShareStoreFlyer}
                      variant="outline"
                      className="w-full gap-2"
                    >
                      <Share2 className="h-4 w-4" />
                      Share Store Flyer
                    </Button>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </section>

        {/* Stats Cards */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Link to={`/sales?date=${encodeURIComponent(todayKey)}`}>
            <Card className="cursor-pointer transition-all hover:shadow-md active:scale-[0.99]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {isGlobalView ? 'Global Revenue (All Stores)' : "Today's Revenue"}
                </CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(totalRevenue)}</p>
              </CardContent>
            </Card>
          </Link>

          <Link to={`/reports?from=${encodeURIComponent(todayKey)}&to=${encodeURIComponent(todayKey)}`}>
            <Card className="cursor-pointer transition-all hover:shadow-md active:scale-[0.99]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Profit Pulse (Today)
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="text-2xl font-bold text-success">
                  {formatCurrency(grossProfit)}
                </p>
                {profitGrowthPct != null && (
                  <p className="text-xs font-medium text-muted-foreground">
                    {profitGrowthPct >= 0 ? '+' : ''}
                    {profitGrowthPct.toFixed(1)}% vs yesterday
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>

          <Link to="/sales">
            <Card className="cursor-pointer transition-all hover:shadow-md active:scale-[0.99]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Transactions
                </CardTitle>
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{transactionCount}</p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/admin/inventory?filter=low-stock">
            <Card className="cursor-pointer transition-all hover:shadow-md active:scale-[0.99]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Low Stock Items
                </CardTitle>
                <AlertTriangle className="h-4 w-4 text-warning" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-warning">
                  {resolvedLowStock.length}
                </p>
              </CardContent>
            </Card>
          </Link>
        </section>

        <section>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Top Salesperson (Last 7 Days)
              </CardTitle>
              <Trophy className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <div className="min-w-0">
                {topSalesperson ? (
                  <>
                    <div className="flex items-center gap-2">
                      <p className="truncate text-lg font-semibold">{topSalesperson.name}</p>
                      <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
                        🥇 Top Salesperson
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Revenue:{' '}
                      <span className="font-semibold">{formatCurrency(topSalesperson.total)}</span>
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">No sales recorded yet</p>
                    <p className="text-xs text-muted-foreground">
                      Start selling to see the weekly leaderboard.
                    </p>
                  </>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate('/sales')}>
                View Sales
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* Smart stock prediction / stock danger zone */}
        {predictiveAlerts.length > 0 && (
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Activity className="h-5 w-5 text-emerald-600" />
              Stock Danger Zone (Fast Movers)
            </h2>
            <Card>
              <CardContent className="divide-y p-0">
                {predictiveAlerts.map((alert) => (
                  <div
                    key={alert.productId}
                    className="flex items-center justify-between p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{alert.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Likely to run out in {alert.daysRemaining.toFixed(1)} days (
                        {alert.projectedStockoutDate.toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                        )
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      {alert.profitPotential > 0 && (
                        <p className="font-semibold text-emerald-700">
                          Potential: ~{currencySymbol}
                          {Math.round(alert.profitPotential).toLocaleString()}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Action needed: plan restock
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {isGlobalView && salesByStore.size > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-semibold">Global Summary (Today)</h2>
            <Card>
              <CardContent className="divide-y p-0">
                {Array.from(salesByStore.values()).map((entry) => (
                  <div
                    key={entry.storeId}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{entry.name}</p>
                    </div>
                    <p className="font-semibold">{formatCurrency(entry.total)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Quick Links */}
        <section>
          <h2 className="mb-3 text-lg font-semibold">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {quickLinks.map((link) => (
              <Link key={link.to} to={link.to}>
                <Card className="flex flex-col items-center justify-center p-4 transition-all hover:shadow-md active:scale-[0.98]">
                  <div className={`mb-2 rounded-full p-3 ${link.color}`}>
                    <link.icon className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-sm font-medium">{link.label}</span>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* EOD moved to /reports (salesperson) */}

        {/* Low Stock Alert */}
        {resolvedLowStock.length > 0 && (
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Stock Alerts
            </h2>
            <Card>
              <CardContent className="divide-y p-0">
                {resolvedLowStock.slice(0, 5).map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-3"
                  >
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Threshold: {product.lowStockThreshold}
                      </p>
                    </div>
                    <Badge
                      variant={product.stock === 0 ? 'destructive' : 'outline'}
                      className={
                        product.stock > 0
                          ? 'border-warning text-warning'
                          : ''
                      }
                    >
                      {product.stock} left
                    </Badge>
                  </div>
                ))}
                {resolvedLowStock.length > 5 && (
                  <Link to="/admin/inventory?filter=low-stock">
                    <Button variant="ghost" className="w-full">
                      View all {resolvedLowStock.length} items
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          </section>
        )}
        </div>
      )}

      {/* Hidden Store Flyer Generator for Sharing */}
      <div
        id="admin-store-flyer-capture"
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
        {(() => {
          let storeId = currentStoreId;
          if (storeId === '__all__' && stores.length === 1) {
            storeId = stores[0].id;
          }
          const store = stores.find(s => s.id === storeId);
          if (!store) return null;

          return (
            <>
              <div style={{ textAlign: 'center', marginBottom: '24px', borderBottom: '2px solid #f3f4f6', paddingBottom: '16px' }}>
                <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 8px 0' }}>{store.name}</h1>
                <p style={{ fontSize: '18px', color: '#6b7280', margin: '0' }}>{store.location_name || store.address}</p>
              </div>

              <div style={{ marginTop: '24px', textAlign: 'center', background: '#eef2ff', padding: '16px', borderRadius: '8px' }}>
                <p style={{ fontSize: '20px', fontWeight: '600', color: '#1e40af', margin: '0 0 8px 0' }}>Shop online now!</p>
                <p style={{ fontSize: '14px', color: '#4338ca', margin: '0 0 12px 0' }}>Scan or visit our link to place your order directly.</p>
                <div style={{ marginTop: '12px', display: 'inline-block', background: '#2563eb', color: '#fff', padding: '8px 16px', borderRadius: '24px', fontWeight: 'bold' }}>
                  Powered by Mthunzi-POS
                </div>
              </div>
            </>
          );
        })()}
      </div>

    </AppShell>
  );
}
