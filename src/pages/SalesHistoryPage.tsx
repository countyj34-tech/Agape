import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { dexieDb } from '@/lib/db';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useStore } from '@/contexts/StoreContext';
import type { Sale } from '@/types/pos';
import { FileText, Search } from 'lucide-react';
import { useEffect } from 'react';
import { canViewSensitiveData } from '@/lib/permissions';
import { PendingOnlineOrders } from '@/components/pos/PendingOnlineOrders';

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

export default function SalesHistoryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings, isAdminAuthenticated } = useSupabaseAuth();
  const { currentStoreId, currentStore, isGlobalView } = useStore();
  const currencySymbol = settings?.currencySymbol || 'K';

  const [dateKey, setDateKey] = useState(() => localDateKey(new Date()));
  const [query, setQuery] = useState('');

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const date = p.get('date');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== dateKey) {
      setDateKey(date);
    }
  }, [dateKey, location.search]);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get('date') !== dateKey) {
      navigate({ pathname: '/sales', search: `?date=${encodeURIComponent(dateKey)}` }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  const { start, end } = useMemo(() => dayBounds(dateKey), [dateKey]);

  const sales = useLiveQuery(
    async () => {
      const all = await dexieDb.sales.toArray();
      return all
        .filter((s) => {
          const created = s.createdAt instanceof Date ? s.createdAt : new Date(String(s.createdAt));
          if (created < start || created > end) return false;
          return isGlobalView || s.storeId === currentStoreId;
        })
        .sort((a, b) => {
          const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(String(a.createdAt)).getTime();
          const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(String(b.createdAt)).getTime();
          return bTime - aTime;
        });
    },
    [currentStoreId, isGlobalView, start.getTime(), end.getTime()]
  );

  const resolvedSales: Sale[] = sales ?? [];

  const filteredSales = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resolvedSales;
    return resolvedSales.filter((s) => {
      const receipt = String(s.receiptNumber ?? '').toLowerCase();
      const method = String(s.paymentMethod ?? '').toLowerCase();
      return receipt.includes(q) || method.includes(q) || String(s.total).includes(q);
    });
  }, [query, resolvedSales]);

  const totals = useMemo(() => {
    return {
      revenue: resolvedSales.reduce((sum, s) => sum + (s.total ?? 0), 0),
      profit: resolvedSales.reduce((sum, s) => sum + (s.profit ?? 0), 0),
      tx: resolvedSales.length,
    };
  }, [resolvedSales]);

  return (
    <AppShell title="Sales">
      <div className="space-y-4 p-4">
        <PendingOnlineOrders />
        <Card>
          <CardHeader>
            <CardTitle>Sales (Today / By Date)</CardTitle>
            {currentStore && (
              <p className="text-xs text-muted-foreground">
                Store: <span className="font-semibold">{currentStore.name}</span>
                {currentStore.location_name ? ` · ${currentStore.location_name}` : ''}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>Date</Label>
              <Input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Revenue</span>
                <span className="font-semibold">
                  {currencySymbol}
                  {totals.revenue.toFixed(2)}
                </span>
              </div>
              {/* Show profit only to admin/owner */}
              { canViewSensitiveData(settings?.userRole, isAdminAuthenticated) ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Profit</span>
                  <span className="font-semibold text-success">
                    {currencySymbol}
                    {totals.profit.toFixed(2)}
                  </span>
                </div>
              ) : null }
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Transactions</span>
                <span className="font-semibold">{totals.tx}</span>
              </div>
            </div>

            <Separator />

            <div className="grid gap-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Receipt number, payment method, amount…"
                  className="pl-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {filteredSales.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales found for this date.</p>
            ) : (
              filteredSales.map((s) => (
                <button
                  key={s.id}
                  className="w-full rounded-md border p-3 text-left transition-colors hover:bg-muted/50"
                  onClick={() => navigate(`/receipt/${s.id}`, { state: { sale: s } })}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.receiptNumber || s.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(s.createdAt).toLocaleTimeString()} · {s.paymentMethod}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {currencySymbol}
                        {Number(s.total ?? 0).toFixed(2)}
                      </span>
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </button>
              ))
            )}

            <div className="pt-2">
              <Button variant="outline" className="w-full" onClick={() => navigate('/reports')}>
                Open Reports (EOD)
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
