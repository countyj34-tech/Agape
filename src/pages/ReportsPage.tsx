import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { dexieDb, saveDailySummary, upsertDailySummaryForDate, updateShiftReportNote, deleteShiftReportAndRelatedAuditLogs, restoreShiftReportAndAuditLogs } from '@/lib/db';
import { PinEntry } from '@/components/pos/PinEntry';
import { PinResetDialog } from '@/components/pos/PinResetDialog';
import type { DailySummary, Expense, Product, Sale, SaleItem, CustomerLedgerEntry, Shift, ShiftReport } from '@/types/pos';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { preloadEodPdfDeps, shareEodPdfToWhatsApp, shareOrDownloadEodPdf } from '@/lib/eodPdf';
import { formatAuditText } from '@/lib/reconciliation';
import { toast } from 'sonner';
import { BarChart3, Share2, Download, FileText, HelpCircle } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '@/contexts/StoreContext';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { shareOrDownloadClosingReportPdf, shareClosingReportPdfToWhatsApp } from '@/lib/closingReportPdf';
import { canViewSensitiveData } from '@/lib/permissions';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function localDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayBounds(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map((v) => parseInt(v, 10));
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return { start, end };
}

function rangeBounds(startKey: string, endKey: string) {
  const a = dayBounds(startKey);
  const b = dayBounds(endKey);
  if (a.start.getTime() <= b.end.getTime()) return { start: a.start, end: b.end };
  // If user accidentally selects inverted range, swap.
  return { start: b.start, end: a.end };
}

function eachDateKeyInRange(startKey: string, endKey: string) {
  const { start, end } = rangeBounds(startKey, endKey);
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);

  const out: string[] = [];
  while (cursor.getTime() <= last.getTime()) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings, isAdminAuthenticated } = useSupabaseAuth();
  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();
  const { currentStoreId, currentStore, isGlobalView } = useStore();

  useEffect(() => {
    // Warm up jsPDF so export/share is fast and more reliable.
    preloadEodPdfDeps().catch(() => undefined);
  }, []);

  const todayKey = useMemo(() => localDateKey(new Date()), []);
  const [startDateKey, setStartDateKey] = useState(() => {
    const from = searchParams.get('from');
    return from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : todayKey;
  });
  const [endDateKey, setEndDateKey] = useState(() => {
    const to = searchParams.get('to');
    return to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : todayKey;
  });

  useEffect(() => {
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const valid = (v: string | null) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

    const nextStart = valid(from) ? (from as string) : todayKey;
    const nextEnd = valid(to) ? (to as string) : todayKey;

    if (nextStart !== startDateKey) setStartDateKey(nextStart);
    if (nextEnd !== endDateKey) setEndDateKey(nextEnd);
  }, [endDateKey, searchParams, startDateKey, todayKey]);

  useEffect(() => {
    const currentFrom = searchParams.get('from');
    const currentTo = searchParams.get('to');
    if (currentFrom !== startDateKey || currentTo !== endDateKey) {
      setSearchParams({ from: startDateKey, to: endDateKey }, { replace: true });
    }
  }, [endDateKey, searchParams, setSearchParams, startDateKey]);

  const { start, end } = useMemo(
    () => rangeBounds(startDateKey, endDateKey),
    [endDateKey, startDateKey]
  );
  const isSingleDay = startDateKey === endDateKey;
  const rangeLabel = isSingleDay ? startDateKey : `${startDateKey}..${endDateKey}`;

  const sales = useLiveQuery(
    async () => {
      const all = await dexieDb.sales.toArray();
      return all.filter((s) => {
        const created = s.createdAt instanceof Date ? s.createdAt : new Date(String(s.createdAt));
        if (created < start || created > end) return false;
        return isGlobalView || s.storeId === currentStoreId;
      });
    },
    [currentStoreId, isGlobalView, start.getTime(), end.getTime()]
  );

  const saleItems = useLiveQuery(
    async () => {
      const all = await dexieDb.saleItems.toArray();
      return all.filter((i) => {
        const ts = i.timestamp instanceof Date ? i.timestamp : new Date(String(i.timestamp));
        if (ts < start || ts > end) return false;
        return isGlobalView || i.storeId === currentStoreId;
      });
    },
    [currentStoreId, isGlobalView, start.getTime(), end.getTime()]
  );

  const expenses = useLiveQuery(
    () => dexieDb.expenses.where('createdAt').between(start, end, true, true).toArray(),
    [start.getTime(), end.getTime()]
  );

  const customerLedger = useLiveQuery(
    () => dexieDb.customerLedger.where('createdAt').between(start, end, true, true).toArray(),
    [start.getTime(), end.getTime()]
  );

  const lowStockProducts = useLiveQuery(
    async () => {
      const products = await dexieDb.products.toArray();
      return products.filter((p) => {
        if (p.stock > p.lowStockThreshold) return false;
        return isGlobalView || p.storeId === currentStoreId;
      });
    },
    [currentStoreId, isGlobalView]
  );

  const savedSummaries = useLiveQuery(
    () => dexieDb.dailySummaries.orderBy('date').reverse().limit(30).toArray(),
    []
  );

  // All shift reports for this store (used to allow per-report deletion)
  const allShiftReports = useLiveQuery(
    () => (isGlobalView ? dexieDb.shiftReports.toArray() : dexieDb.shiftReports.where('storeId').equals(currentStoreId).toArray()),
    [currentStoreId, isGlobalView]
  );

  const recentShifts = useLiveQuery(
    () => dexieDb.shifts.orderBy('startedAt').reverse().limit(20).toArray(),
    []
  );

  const shiftReportsForRange = useLiveQuery(
    async () => {
      const all = await dexieDb.shiftReports.toArray();
      return all.filter((r) => {
        const created = r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt));
        if (created < start || created > end) return false;
        return isGlobalView || r.storeId === currentStoreId;
      });
    },
    [currentStoreId, isGlobalView, start.getTime(), end.getTime()]
  );

  const resolvedSales: Sale[] = sales ?? [];
  const resolvedSaleItems: SaleItem[] = saleItems ?? [];
  const resolvedExpenses: Expense[] = expenses ?? [];
  const resolvedCustomerLedger: CustomerLedgerEntry[] = customerLedger ?? [];
  const resolvedLowStock: Product[] = lowStockProducts ?? [];
  const resolvedSavedSummaries: DailySummary[] = savedSummaries ?? [];
  const resolvedShifts: Shift[] = recentShifts ?? [];
  const resolvedShiftReports: ShiftReport[] = shiftReportsForRange ?? [];


  const totalRevenue = resolvedSales.reduce((sum, s) => sum + s.total, 0);
  const totalDiscount = resolvedSales.reduce((sum, s) => sum + (s.discount ?? 0), 0);
  const grossProfit = resolvedSaleItems.reduce(
    (sum, i) => sum + ((i.priceAtSale || 0) - (i.buyingPriceAtSale || 0)) * (i.qty || 1),
    0
  );
  const totalProfit = grossProfit - totalDiscount;

  const reconciliation = useMemo(() => {
    const paidNowForSale = (s: Sale) => {
      if (typeof s.amountPaid === 'number' && Number.isFinite(s.amountPaid)) return Math.max(0, s.amountPaid);
      if (s.paymentMethod === 'credit') return 0;
      if (s.paymentMethod === 'cash') {
        const received = typeof s.amountReceived === 'number' ? s.amountReceived : s.total;
        return Math.max(0, Math.min(s.total, received));
      }
      return Math.max(0, s.total);
    };

    const cashIn = resolvedSales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + paidNowForSale(s), 0);
    const cardIn = resolvedSales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + paidNowForSale(s), 0);
    const transferIn = resolvedSales.filter((s) => s.paymentMethod === 'transfer').reduce((sum, s) => sum + paidNowForSale(s), 0);

    const mobileInByProvider: Partial<Record<'mtn' | 'airtel' | 'zamtel' | 'other', number>> = {};
    let mobileInTotal = 0;
    for (const s of resolvedSales) {
      if (s.paymentMethod !== 'mobile') continue;
      const amt = paidNowForSale(s);
      mobileInTotal += amt;
      const key = (s.mobileProvider ?? 'other') as 'mtn' | 'airtel' | 'zamtel' | 'other';
      mobileInByProvider[key] = (mobileInByProvider[key] ?? 0) + amt;
    }

    const creditIssued = resolvedSales.reduce((sum, s) => sum + (s.balanceDue ?? 0), 0);
    const creditPayments = resolvedCustomerLedger
      .filter((l) => l.kind === 'payment')
      .reduce((sum, l) => sum + (l.amount ?? 0), 0);

    const expensesCash = resolvedExpenses.filter((e) => e.source === 'cash').reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const expensesMobileBySource: Partial<Record<'mtn' | 'airtel' | 'zamtel' | 'other', number>> = {};
    let expensesMobileTotal = 0;
    for (const e of resolvedExpenses) {
      if (e.source === 'cash') continue;
      const amt = e.amount ?? 0;
      expensesMobileTotal += amt;
      const key = (e.source ?? 'other') as 'mtn' | 'airtel' | 'zamtel' | 'other';
      expensesMobileBySource[key] = (expensesMobileBySource[key] ?? 0) + amt;
    }
    const expensesTotal = resolvedExpenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);

    const expectedCashDrawer = cashIn - expensesCash;

    const netProfitAfterExpenses = totalProfit - expensesTotal;

    return {
      cashIn,
      cardIn,
      transferIn,
      mobileInTotal,
      mobileInByProvider,
      creditIssued,
      creditPayments,
      expensesTotal,
      expensesCash,
      expensesMobileTotal,
      expensesMobileBySource,
      expectedCashDrawer,
      netProfitAfterExpenses,
    };
  }, [resolvedCustomerLedger, resolvedExpenses, resolvedSales, totalProfit]);

  const digitalTakingsTotal = reconciliation.cardIn + reconciliation.transferIn + reconciliation.mobileInTotal;

  // New stock received cost for the selected range (typically a single day)
  const [newStockCostTotal, setNewStockCostTotal] = useState(0);
  const allStoreProducts = useLiveQuery(
    async () => {
      const products = await dexieDb.products.toArray();
      return products.filter((p) => isGlobalView || p.storeId === currentStoreId);
    },
    [currentStoreId, isGlobalView]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await dexieDb.stockInwardLogs
          .where('receivedAt')
          .between(start, end, true, true)
          .toArray();
        const logs = all.filter((l) => isGlobalView || l.storeId === currentStoreId);
        if (cancelled) return;
        const total = logs.reduce((sum, log) => sum + (log.totalCost ?? log.quantityAdded * log.unitCost), 0);
        setNewStockCostTotal(total);
      } catch (e) {
        console.error('Failed to compute new stock cost for range', e);
        if (!cancelled) setNewStockCostTotal(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStoreId, start.getTime(), end.getTime()]);

  const stockByProductId = useMemo(() => {
    const map = new Map<string, number>();
    const list = (allStoreProducts ?? []) as Product[];
    for (const p of list) {
      map.set(p.id, p.stock);
    }
    return map;
  }, [allStoreProducts]);

  const totalStockValue = useMemo(() => {
    const list = (allStoreProducts ?? []) as Product[];
    return list.reduce((sum, product) => sum + product.stock * (product.buyingPrice ?? 0), 0);
  }, [allStoreProducts]);

  const computedEod = useMemo((): DailySummary => {
    const byProduct = new Map<
      string,
      { productId: string; productName: string; quantitySold: number; revenue: number }
    >();

    for (const sale of resolvedSales) {
      for (const item of sale.items || []) {
        const existing = byProduct.get(item.productId);
        if (existing) {
          existing.quantitySold += item.quantity;
          existing.revenue += item.total;
        } else {
          byProduct.set(item.productId, {
            productId: item.productId,
            productName: item.productName,
            quantitySold: item.quantity,
            revenue: item.total,
          });
        }
      }
    }

    const topSellers = Array.from(byProduct.values())
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .map((s) => ({
        productId: s.productId,
        productName: s.productName,
        quantitySold: s.quantitySold,
        revenue: s.revenue,
        remainingStock: stockByProductId.get(s.productId) ?? 0,
      }));

    const lowStockItems = resolvedLowStock
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        currentStock: p.stock,
        threshold: p.lowStockThreshold,
      }))
      .slice(0, 20);

    const inventorySnapshot = ((allStoreProducts ?? []) as Product[])
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        currentStock: p.stock,
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName));

    return {
      id: `eod-${rangeLabel}`,
      date: rangeLabel,
      totalRevenue,
      totalProfit,
      storeId: currentStoreId,
      storeName: currentStore?.name,
      cashIn: reconciliation.cashIn,
      cardIn: reconciliation.cardIn,
      transferIn: reconciliation.transferIn,
      mobileInTotal: reconciliation.mobileInTotal,
      mobileInByProvider: reconciliation.mobileInByProvider,
      creditIssued: reconciliation.creditIssued,
      creditPayments: reconciliation.creditPayments,
      expensesTotal: reconciliation.expensesTotal,
      expensesCash: reconciliation.expensesCash,
      expensesMobileTotal: reconciliation.expensesMobileTotal,
      expensesMobileBySource: reconciliation.expensesMobileBySource,
      netProfitAfterExpenses: reconciliation.netProfitAfterExpenses,
      transactionCount: resolvedSales.length,
      topSellers,
      lowStockItems,
      inventorySnapshot,
      stockValue: totalStockValue,
      createdAt: new Date(),
    };
  }, [
    rangeLabel,
    reconciliation,
    resolvedLowStock,
    resolvedSales,
    totalProfit,
    totalRevenue,
    stockByProductId,
    currentStore?.name,
    currentStoreId,
    allStoreProducts,
  ]);

  const [showSoldItems, setShowSoldItems] = useState(false);
  const [closingNoteDraft, setClosingNoteDraft] = useState('');
  const [showPinEntry, setShowPinEntry] = useState(false);
  const [showPinReset, setShowPinReset] = useState(false);
  const pendingAdminActionRef = useRef<(() => Promise<void>) | null>(null);
  const { login } = useSupabaseAuth();

  const latestShiftReport: ShiftReport | null = useMemo(() => {
    if ((resolvedShiftReports ?? []).length === 0) return null;
    return (resolvedShiftReports ?? [])
      .slice()
      .sort((a, b) => {
        const ad = a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt));
        const bd = b.createdAt instanceof Date ? b.createdAt : new Date(String(b.createdAt));
        return bd.getTime() - ad.getTime();
      })[0];
  }, [resolvedShiftReports]);

  useEffect(() => {
    if (latestShiftReport?.note) {
      setClosingNoteDraft(latestShiftReport.note);
    } else {
      setClosingNoteDraft('');
    }
  }, [latestShiftReport?.id, latestShiftReport?.note]);

  const soldItems = useMemo(() => {
    if (!showSoldItems) return [] as Array<{
      productId: string;
      productName: string;
      quantitySold: number;
      unitPrice: number;
      revenue: number;
    }>;

    const map = new Map<
      string,
      { productId: string; productName: string; quantitySold: number; unitPrice: number; revenue: number }
    >();

    for (const sale of resolvedSales) {
      for (const item of sale.items || []) {
        const key = `${item.productId}::${item.unitPrice.toFixed(2)}`;
        const existing = map.get(key);
        const lineRevenue = item.total;
        if (existing) {
          existing.quantitySold += item.quantity;
          existing.revenue += lineRevenue;
        } else {
          map.set(key, {
            productId: item.productId,
            productName: item.productName,
            quantitySold: item.quantity,
            unitPrice: item.unitPrice,
            revenue: lineRevenue,
          });
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.quantitySold - a.quantitySold);
  }, [resolvedSales, showSoldItems]);

  const handleSaveSummary = async () => {
    if (!isSingleDay) {
      toast.message('Save Summary is only available for a single day.');
      return;
    }
    try {
      // Persist as a true daily summary (YYYY-MM-DD).
      await saveDailySummary({ ...computedEod, date: startDateKey, id: `eod-${startDateKey}` });
      toast.success('EOD summary saved');
    } catch (e) {
      console.error(e);
      toast.error('Failed to save EOD');
    }
  };

  const handleGenerateSummariesForRange = async () => {
    const keys = eachDateKeyInRange(startDateKey, endDateKey);
    if (keys.length > 400) {
      toast.error('Range too large (max 400 days). Choose a smaller range.');
      return;
    }

    try {
      for (const k of keys) {
        await upsertDailySummaryForDate(k);
      }
      toast.success(`Saved ${keys.length} daily summaries`);
    } catch (e) {
      console.error(e);
      toast.error('Failed to generate summaries');
    }
  };

  return (
    <AppShell title="Reports">
      <div className="space-y-4 p-4">
        {currentStore && (
          <p className="text-xs text-muted-foreground">
            Store: <span className="font-semibold">{currentStore.name}</span>
            {currentStore.location_name ? ` · ${currentStore.location_name}` : ''}
          </p>
        )}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-1">
              <CardTitle>End-of-Day Report (Sales)</CardTitle>
              {currentStore && (
                <p className="text-xs text-muted-foreground">
                  Store: <span className="font-semibold">{currentStore.name}</span>
                  {currentStore.location_name ? ` · ${currentStore.location_name}` : ''}
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>Date range</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="date"
                    value={startDateKey}
                    onChange={(e) => setStartDateKey(e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="date"
                    value={endDateKey}
                    onChange={(e) => setEndDateKey(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Revenue</span>
                <span className="font-semibold">{formatCurrency(totalRevenue)}</span>
              </div>
              { canViewSensitiveData(settings?.userRole, isAdminAuthenticated) ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Profit</span>
                  <span className="font-semibold text-success">{formatCurrency(totalProfit)}</span>
                </div>
              ) : null }
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Expenses</span>
                <span className="font-semibold text-destructive">{formatCurrency(reconciliation.expensesTotal)}</span>
              </div>
              { canViewSensitiveData(settings?.userRole, isAdminAuthenticated) ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Net profit</span>
                  <span className={reconciliation.netProfitAfterExpenses >= 0 ? 'font-semibold text-success' : 'font-semibold text-destructive'}>
                    {formatCurrency(reconciliation.netProfitAfterExpenses)}
                  </span>
                </div>
              ) : null }
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Transactions</span>
                <span className="font-semibold">{resolvedSales.length}</span>
              </div>
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <p className="text-sm font-semibold">Reconciliation</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Cash in</span>
                <span className="font-semibold">{formatCurrency(reconciliation.cashIn)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Cash expenses</span>
                <span className="font-semibold text-destructive">{formatCurrency(reconciliation.expensesCash)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Expected cash drawer</span>
                <span className="font-semibold">{formatCurrency(reconciliation.expectedCashDrawer)}</span>
              </div>

              <Separator />

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Mobile in</span>
                <span className="font-semibold">{formatCurrency(reconciliation.mobileInTotal)}</span>
              </div>
              {Object.entries(reconciliation.mobileInByProvider)
                .filter(([, v]) => (v ?? 0) > 0)
                .map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{k.toUpperCase()}</span>
                    <span>{formatCurrency(Number(v ?? 0))}</span>
                  </div>
                ))}

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Mobile expenses</span>
                <span className="font-semibold text-destructive">{formatCurrency(reconciliation.expensesMobileTotal)}</span>
              </div>

              <Separator />

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Card in</span>
                <span className="font-semibold">{formatCurrency(reconciliation.cardIn)}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Bank Transfers</span>
                <span className="font-semibold">{formatCurrency(reconciliation.transferIn)}</span>
              </div>

              <Separator />

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Credit issued</span>
                <span className="font-semibold text-destructive">{formatCurrency(reconciliation.creditIssued)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Credit payments</span>
                <span className="font-semibold text-success">{formatCurrency(reconciliation.creditPayments)}</span>
              </div>

              <div className="pt-1">
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/customers">Open Customer Book</Link>
                </Button>
              </div>
              <div>
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/expenses">Open Expenses</Link>
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1 gap-2" onClick={handleSaveSummary} disabled={!isSingleDay}>
                <BarChart3 className="h-4 w-4" />
                Save Summary
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={handleGenerateSummariesForRange}
              >
                <BarChart3 className="h-4 w-4" />
                Auto-Save Range
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                title="Share to WhatsApp"
                onClick={async () => {
                  try {
                    const result = await shareEodPdfToWhatsApp({ summary: computedEod, settings });
                    if (result.shared) {
                      toast.success('Shared PDF');
                    } else if (result.reason === 'cancelled') {
                      toast.message('Share cancelled');
                    } else if (result.reason === 'unsupported') {
                      toast.message('PDF downloaded. Attach it in WhatsApp.');
                    } else {
                      toast.error('Failed to share PDF');
                    }
                  } catch (e) {
                    console.error(e);
                    toast.error('Failed to share');
                  }
                }}
              >
                <Share2 className="h-4 w-4" />
                Share to WhatsApp
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={async () => {
                  try {
                    const preopenedWindow = window.open('', '_blank');
                    await shareOrDownloadEodPdf({ summary: computedEod, settings, preopenedWindow });
                  } catch (e) {
                    console.error(e);
                    toast.error('Failed to export PDF');
                  }
                }}
              >
                <Download className="h-4 w-4" />
                Export PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Closing Report: master reconciliation snapshot for the selected range (typically a day) */}
        <Card>
          <CardHeader>
            <CardTitle>Closing Report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!latestShiftReport ? (
              <p className="text-sm text-muted-foreground">
                No shift reconciliation has been recorded for this date range yet. Close a shift from
                the header to capture a snapshot.
              </p>
            ) : (
              <>
                <div className="grid gap-3 rounded-md border p-3 text-sm">
                    {latestShiftReport.difference < 0 && (
                      <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-bold text-destructive">
                        AUDIT SHIELD: SHORTAGE DETECTED — {formatCurrency(Math.abs(latestShiftReport.difference))}
                      </div>
                    )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cashier</span>
                    <span className="font-semibold">{latestShiftReport.cashierName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Expected cash (system)</span>
                    <span className="font-semibold">
                      {formatCurrency(latestShiftReport.expectedAmount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Counted cash (drawer)</span>
                    <span className="font-semibold">
                      {formatCurrency(latestShiftReport.actualAmount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      Overage / Shortage
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 text-[10px] text-muted-foreground hover:bg-muted"
                            aria-label="What is overage / shortage?"
                          >
                            <HelpCircle className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-xs text-xs">
                          The system compares expected cash with the physical cash counted in the drawer. A positive
                          difference is an <span className="font-semibold">overage</span> (extra cash); a negative
                          difference is a <span className="font-semibold">shortage</span> (missing cash).
                        </TooltipContent>
                      </Tooltip>
                    </span>
                    <div className="text-right">
                      <div
                        className={
                          latestShiftReport.status === 'balanced'
                            ? 'font-semibold text-emerald-600'
                            : latestShiftReport.status === 'overage'
                              ? 'font-semibold text-amber-500'
                              : 'font-semibold text-destructive'
                        }
                      >
                        {formatCurrency(latestShiftReport.difference)}
                      </div>
                      <div className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">
                        {latestShiftReport.status === 'balanced'
                          ? `🟢 Balanced — Good job, ${latestShiftReport.cashierName}!`
                          : latestShiftReport.status === 'overage'
                            ? '🟡 Overage — Someone forgot to give change or record a sale.'
                            : '🔴 Shortage — Money is missing. Investigation required.'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 rounded-md border p-3 text-sm">
                  <p className="text-sm font-semibold">Actual vs. Expected (Summary)</p>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cash counted</span>
                    <span className="font-semibold">
                      {formatCurrency(latestShiftReport.actualAmount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Digital sales (card + mobile)</span>
                    <span className="font-semibold">
                      {formatCurrency(digitalTakingsTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Stock value on shelf</span>
                    <span className="font-semibold">
                      {formatCurrency(totalStockValue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">New stock received today (cost)</span>
                    <span className="font-semibold">
                      {formatCurrency(newStockCostTotal)}
                    </span>
                  </div>
                </div>

                <div className="grid gap-2 rounded-md border p-3 text-sm">
                  <Label htmlFor="closing-note">Reason for discrepancy</Label>
                  <textarea
                    id="closing-note"
                    rows={3}
                    className="min-h-[80px] rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary"
                    placeholder={latestShiftReport.locked ? 'This reconciliation is locked and cannot be edited.' : 'Optional note explaining any overage or shortage...'}
                    value={closingNoteDraft}
                    onChange={(e) => setClosingNoteDraft(e.target.value)}
                    onBlur={async () => {
                      if (!latestShiftReport) return;
                      if (latestShiftReport.locked) return;
                      try {
                        await updateShiftReportNote(latestShiftReport.id, closingNoteDraft.trim());
                        toast.success('Closing note saved');
                      } catch (e) {
                        console.error(e);
                        toast.error('Failed to save note');
                      }
                    }}
                    readOnly={latestShiftReport.locked}
                    disabled={latestShiftReport.locked}
                  />
                  <p className="text-xs text-muted-foreground">
                    This note is stored with the shift reconciliation for future audits.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1 gap-2"
                    variant="outline"
                    onClick={async () => {
                      if (!latestShiftReport) return;
                      try {
                        const preopenedWindow = window.open('', '_blank');
                        await shareOrDownloadClosingReportPdf({
                          shiftReport: latestShiftReport,
                          stockValue: totalStockValue,
                          digitalTotal: digitalTakingsTotal,
                          totalSales: totalRevenue,
                          newStockCost: newStockCostTotal,
                          settings,
                          discrepancyNote: closingNoteDraft.trim(),
                          preopenedWindow,
                        });
                      } catch (e) {
                        console.error(e);
                        toast.error('Failed to export Closing Report PDF');
                      }
                    }}
                  >
                    <Download className="h-4 w-4" />
                    Export Closing Report (PDF)
                  </Button>
                  <Button
                    className="flex-1 gap-2"
                    variant="outline"
                    onClick={async () => {
                      if (!latestShiftReport) return;
                      try {
                        const result = await shareClosingReportPdfToWhatsApp({
                          shiftReport: latestShiftReport,
                          stockValue: totalStockValue,
                          digitalTotal: digitalTakingsTotal,
                          totalSales: totalRevenue,
                          newStockCost: newStockCostTotal,
                          settings,
                          discrepancyNote: closingNoteDraft.trim(),
                        });
                        if (result.shared) {
                          toast.success('Shared Closing Report');
                        } else if (result.reason === 'cancelled') {
                          toast.message('Share cancelled');
                        } else if (result.reason === 'unsupported') {
                          toast.message('PDF downloaded. Attach it in WhatsApp.');
                        } else {
                          toast.error('Failed to share Closing Report');
                        }
                      } catch (e) {
                        console.error(e);
                        toast.error('Failed to share Closing Report');
                      }
                    }}
                  >
                    <Share2 className="h-4 w-4" />
                    Share Closing Report
                  </Button>
                  <Button
                    className="flex-1 gap-2"
                    variant="outline"
                    asChild
                  >
                    <Link to="/admin/stock-master">
                      <FileText className="h-4 w-4" />
                      Open Stock Sheet
                    </Link>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>All Sold Items (by quantity)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {computedEod.topSellers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales for this date.</p>
            ) : (
              computedEod.topSellers.map((t) => {
                const remaining = stockByProductId.get(t.productId);
                return (
                  <div
                    key={t.productId}
                    className="flex items-center justify-between rounded-md border p-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {t.productName}{' '}
                      <span className="text-muted-foreground">
                        ×{t.quantitySold}
                        {typeof remaining === 'number' ? ` · ${remaining} left` : ''}
                      </span>
                    </span>
                    <span className="font-semibold">
                      {currencySymbol}
                      {t.revenue.toFixed(2)}
                    </span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Sold Items</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Lightweight by default. Load the detailed list only when needed.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSoldItems((v) => !v)}
            >
              {showSoldItems ? 'Hide Detailed List' : 'Show Detailed List'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {!showSoldItems ? (
              <p className="text-sm text-muted-foreground">
                Only summary totals are loaded. Click "Show Detailed List" to view item-level details
                for this closing report.
              </p>
            ) : soldItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sold items for this date.</p>
            ) : (
              soldItems.map((item) => (
                <div
                  key={`${item.productId}-${item.unitPrice}`}
                  className="flex items-center justify-between rounded-md border p-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      Qty {item.quantitySold} × {currencySymbol}{item.unitPrice.toFixed(2)}
                    </p>
                  </div>
                  <div className="text-right text-sm font-semibold">
                    {currencySymbol}{item.revenue.toFixed(2)}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved Summaries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Saved summaries are stored on this device (offline).
            </p>
            {resolvedSavedSummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved summaries yet.</p>
            ) : (
              resolvedSavedSummaries.map((s) => (
                <div key={s.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.date}</p>
                      <p className="text-xs text-muted-foreground">
                        Revenue {formatCurrency(s.totalRevenue)}
                        { canViewSensitiveData(settings?.userRole, isAdminAuthenticated) ? (
                          <>{` · Profit ${formatCurrency(s.totalProfit)}`}</>
                        ) : null }
                        {` · ${s.transactionCount} tx`}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // Saved summaries are single-day (YYYY-MM-DD)
                          setStartDateKey(s.date);
                          setEndDateKey(s.date);
                          toast.message(`Loaded ${s.date}`);
                        }}
                      >
                        Load
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            const preopenedWindow = window.open('', '_blank');
                            await shareOrDownloadEodPdf({ summary: s, settings, preopenedWindow });
                          } catch (e) {
                            console.error(e);
                            toast.error('Failed to export PDF');
                          }
                        }}
                      >
                        PDF
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            const result = await shareEodPdfToWhatsApp({ summary: s, settings });
                            if (result.shared) toast.success('Shared PDF');
                            else if (result.reason === 'cancelled') toast.message('Share cancelled');
                            else if (result.reason === 'unsupported') toast.message('PDF downloaded. Attach it in WhatsApp.');
                            else toast.error('Failed to share PDF');
                          } catch (e) {
                            console.error(e);
                            toast.error('Failed to share');
                          }
                        }}
                        title="Share to WhatsApp"
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={async () => {
                          const ok = window.confirm(`Delete saved summary for ${s.date}? This cannot be undone.`);
                          if (!ok) return;
                          try {
                            await dexieDb.dailySummaries.delete(s.id);
                            toast.success('Saved summary deleted');
                          } catch (e) {
                            console.error(e);
                            toast.error('Failed to delete saved summary');
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shift Reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Start/end shifts from the header (Shift icon).
            </p>
            {resolvedShifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shifts yet.</p>
            ) : (
              resolvedShifts.map((sh) => {
                const reportsForShift = (allShiftReports ?? []).filter((r) => r.shiftId === sh.id);
                return (
                  <div key={sh.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{sh.cashierName}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(sh.startedAt).toLocaleString()} → {sh.endedAt ? new Date(sh.endedAt).toLocaleString() : 'Still open'}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Badge className={sh.status === 'open' ? 'bg-emerald-600' : undefined}>{sh.status.toUpperCase()}</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/shift/${sh.id}`)}
                      >
                        Open
                      </Button>

                      {reportsForShift.length > 0 && (
                        <div className="flex items-center gap-2">
                          {reportsForShift.map((r) => (
                            <div key={r.id} className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/shift/${sh.id}`)}
                              >
                                View
                              </Button>
                              {canViewSensitiveData(settings?.userRole, isAdminAuthenticated) ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive"
                                  onClick={async () => {
                                    const ok = window.confirm('Delete this shift reconciliation report? This cannot be undone.');
                                    if (!ok) return;

                                    const exec = async () => {
                                      try {
                                        const { report, auditLogs } = await deleteShiftReportAndRelatedAuditLogs(r.id);
                                        toast.success('Shift report deleted', {
                                          action: {
                                            label: 'Undo',
                                            onClick: async () => {
                                              try {
                                                if (report) await restoreShiftReportAndAuditLogs(report, auditLogs);
                                                toast.success('Shift report restored');
                                              } catch (e) {
                                                console.error('Failed to restore shift report', e);
                                                toast.error('Restore failed');
                                              }
                                            },
                                          },
                                        });
                                      } catch (e) {
                                        console.error(e);
                                        toast.error('Failed to delete shift report');
                                      }
                                    };

                                    if (isAdminAuthenticated) {
                                      await exec();
                                    } else {
                                      pendingAdminActionRef.current = exec;
                                      setShowPinEntry(true);
                                    }
                                  }}
                                >
                                  Delete
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}

                      <Button
                        className="flex-1 gap-2"
                        variant="outline"
                        onClick={() => {
                          if (!latestShiftReport) return;
                          const text = formatAuditText({
                            storeName: currentStore?.name,
                            date: latestShiftReport.createdAt,
                            staffName: latestShiftReport.cashierName,
                            status: latestShiftReport.status,
                            shortageAmount: latestShiftReport.difference < 0 ? Math.abs(latestShiftReport.difference) : undefined,
                          });
                          const encoded = encodeURIComponent(text);
                          // Open WhatsApp Web share (best-effort)
                          const url = `https://wa.me/?text=${encoded}`;
                          window.open(url, '_blank', 'noopener noreferrer');
                        }}
                        title="Share to WhatsApp"
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {resolvedLowStock.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Stock Alerts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {resolvedLowStock.slice(0, 20).map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <Badge variant={p.stock === 0 ? 'destructive' : 'outline'}>
                    {p.stock} left (thr {p.lowStockThreshold})
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
      {showPinEntry && (
        <PinEntry
          onSubmit={async (pin) => {
            try {
              const ok = await login(pin);
              if (!ok) {
                toast.error('Incorrect PIN');
                return;
              }
              setShowPinEntry(false);
              const act = pendingAdminActionRef.current;
              pendingAdminActionRef.current = null;
              if (act) act().catch((e) => {
                console.error('Admin action failed', e);
                toast.error('Operation failed');
              });
            } catch (e) {
              console.error(e);
              toast.error('PIN validation failed');
            }
          }}
          onCancel={() => {
            setShowPinEntry(false);
            pendingAdminActionRef.current = null;
          }}
          onForgotPin={() => setShowPinReset(true)}
        />
      )}
      <PinResetDialog 
        open={showPinReset} 
        onOpenChange={setShowPinReset} 
      />
    </AppShell>
  );
}
