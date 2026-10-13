import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AdminGate } from '@/components/admin/AdminGate';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { dexieDb } from '@/lib/db';
import { useStore } from '@/contexts/StoreContext';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

type RangePreset = '7d' | '30d' | '90d' | 'all';

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export default function FinancialHubPage() {
  const { currentStoreId, isGlobalView } = useStore();
  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();

  const [range, setRange] = useState<RangePreset>('7d');

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (range === 'all') {
      return { from: new Date(2000, 0, 1), to: endOfDay(now) };
    }
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const from = startOfDay(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
    return { from, to: endOfDay(now) };
  }, [range]);

  const sales = useLiveQuery(
    async () => {
      const list = await dexieDb.sales
        .filter((s) => {
          const created = s.createdAt instanceof Date ? s.createdAt : new Date(String(s.createdAt));
          const inRange = created >= from && created <= to;
          if (!inRange) return false;
          if (isGlobalView) return true;
          return s.storeId === currentStoreId;
        })
        .toArray();
      return list;
    },
    [currentStoreId, isGlobalView, from.getTime(), to.getTime()]
  );

  const saleItems = useLiveQuery(
    async () => {
      const list = await dexieDb.saleItems.where('timestamp').between(from, to, true, true).toArray();
      if (isGlobalView) return list;
      return list.filter((i) => i.storeId === currentStoreId);
    },
    [currentStoreId, isGlobalView, from.getTime(), to.getTime()]
  );

  const expenses = useLiveQuery(
    async () => {
      const list = await dexieDb.expenses.where('createdAt').between(from, to, true, true).toArray();
      if (isGlobalView) return list;
      return list.filter((e) => e.storeId === currentStoreId);
    },
    [currentStoreId, isGlobalView, from.getTime(), to.getTime()]
  );

  const inventory = useLiveQuery(
    () => isGlobalView
      ? dexieDb.products.toArray()
      : dexieDb.products.where('storeId').equals(currentStoreId).toArray(),
    [currentStoreId, isGlobalView]
  );

  const totals = useMemo(() => {
    const totalSales = (sales ?? []).reduce((sum, s) => sum + (s.total ?? 0), 0);
    const cogs = (saleItems ?? []).reduce(
      (sum, i) => sum + (Number(i.buyingPriceAtSale ?? 0) * Number(i.qty ?? 0)),
      0
    );
    const totalExpenses = (expenses ?? []).reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const netProfitBeforeTax = totalSales - cogs - totalExpenses;
    const tiedCapital = (inventory ?? []).reduce(
      (sum, p) => sum + (Number(p.stock ?? 0) * Number(p.buyingPrice ?? 0)),
      0
    );

    return { totalSales, cogs, totalExpenses, netProfitBeforeTax, tiedCapital };
  }, [expenses, inventory, saleItems, sales]);

  const settings = useLiveQuery(() => dexieDb.settings.get('main'), []);

  const computed = useMemo(() => {
    const netProfitBeforeTax = totals.netProfitBeforeTax;
    const taxRate = Math.max(0, Number(settings?.taxRate ?? 0));
    const taxAmount = netProfitBeforeTax > 0 ? (netProfitBeforeTax * taxRate) / 100 : 0;
    const netProfit = netProfitBeforeTax - taxAmount;
    const netProfitMargin = totals.totalSales > 0 ? (netProfit / totals.totalSales) * 100 : null;
    return { taxRate, taxAmount, netProfit, netProfitMargin };
  }, [settings?.taxRate, totals.netProfitBeforeTax, totals.totalSales]);

  const barData = useMemo(
    () => [
      {
        label: 'Liquid Cash',
        value: Number(totals.totalSales.toFixed(2)),
      },
      {
        label: 'Tied Capital',
        value: Number(totals.tiedCapital.toFixed(2)),
      },
    ],
    [totals.tiedCapital, totals.totalSales]
  );

  return (
    <AdminGate>
      <AppShell title="Financial Hub">
        <div className="mx-auto max-w-4xl space-y-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold">Owner Financial Hub</h1>
              <p className="text-sm text-muted-foreground">
                Net Profit = Sales − COGS − Expenses − Tax
              </p>
            </div>

            <div className="w-full sm:w-56">
              <Select value={range} onValueChange={(v) => setRange(v as RangePreset)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Sovereignty</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">
                  Your data stays in Zambia, on your device. No American clouds required.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Resilience</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">Works during load shedding and internet outages.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Insight</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">
                  See profit after expenses and tax — not just what you sold.
                </p>
              </CardContent>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatCurrency(totals.totalSales)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total COGS</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatCurrency(totals.cogs)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Expenses</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatCurrency(totals.totalExpenses)}</div>
              </CardContent>
            </Card>

            <Card className={computed.netProfit >= 0 ? 'border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10' : 'border-destructive/30 bg-destructive/5'}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Net Profit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className={computed.netProfit >= 0 ? 'text-3xl font-bold text-emerald-700 dark:text-emerald-300' : 'text-3xl font-bold text-destructive'}>
                  {formatCurrency(computed.netProfit)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Net Profit Margin:{' '}
                  <span className="font-semibold">
                    {computed.netProfitMargin == null ? '—' : `${computed.netProfitMargin.toFixed(1)}%`}
                  </span>
                </p>
                {computed.taxRate > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Tax ({computed.taxRate.toFixed(1)}%):{' '}
                    <span className="font-semibold">{formatCurrency(computed.taxAmount)}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          </section>

          <section>
            <Card>
              <CardHeader>
                <CardTitle>Cash Flow Snapshot</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-2 text-sm text-muted-foreground">
                  Compare money you received (Liquid Cash) vs money sitting in stock (Tied Capital).
                </div>

                <ChartContainer
                  className="h-[280px] w-full"
                  config={{
                    value: {
                      label: 'Amount',
                      color: 'hsl(var(--primary))',
                    },
                  }}
                >
                  <BarChart data={barData} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={72}
                      tickFormatter={(v) => `${currencySymbol}${Number(v).toFixed(0)}`}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="var(--color-value)" />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </section>
        </div>
      </AppShell>
    </AdminGate>
  );
}
