import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, Share2 } from 'lucide-react';
import { toast } from 'sonner';

import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { dexieDb } from '@/lib/db';
import type { ShiftReport } from '@/types/pos';
import { preloadShiftPdfDeps, shareOrDownloadShiftPdf, shareShiftPdf } from '@/lib/shiftPdf';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { canViewSensitiveData } from '@/lib/permissions';

export default function ShiftReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings, isAdminAuthenticated } = useSupabaseAuth();
  const currencySymbol = settings?.currencySymbol || 'K';
  const sensitiveVisible = canViewSensitiveData(settings?.userRole, isAdminAuthenticated);

  useEffect(() => {
    preloadShiftPdfDeps().catch(() => undefined);
  }, []);

  const shift = useLiveQuery(() => (id ? dexieDb.shifts.get(id) : undefined), [id]);
  const sales = useLiveQuery(
    () => (id ? dexieDb.sales.where('shiftId').equals(id).toArray() : []),
    [id]
  );

  const shiftReport = useLiveQuery(
    () => (id ? dexieDb.shiftReports.where('shiftId').equals(id).reverse().first() as Promise<ShiftReport | undefined> : undefined),
    [id]
  );

  const resolvedSales = sales ?? [];

  const totals = useMemo(() => {
    const totalRevenue = resolvedSales.reduce((sum, s) => sum + (s.total ?? 0), 0);
    const totalProfit = resolvedSales.reduce((sum, s) => sum + (s.profit ?? 0), 0);
    return { totalRevenue, totalProfit, transactionCount: resolvedSales.length };
  }, [resolvedSales]);

  const onDownloadPdf = async () => {
    if (!shift) return;
    const preopened = window.open('', '_blank');
    try {
      await shareOrDownloadShiftPdf({ shift, sales: resolvedSales, settings, preopenedWindow: preopened });
    } catch {
      try {
        preopened?.close();
      } catch {
        // ignore
      }
      toast.error('Failed to export PDF');
    }
  };

  const onShare = async () => {
    if (!shift) return;
    try {
      const result = await shareShiftPdf({ shift, sales: resolvedSales, settings });
      if (result.shared) {
        toast.success('Shared');
      } else if (result.reason === 'cancelled') {
        toast.message('Share cancelled');
      } else if (result.reason === 'unsupported') {
        toast.message('Sharing not supported here. Downloaded instead.');
      } else {
        toast.error('Share failed');
      }
    } catch {
      toast.error('Share failed');
    }
  };

  if (!id) {
    return (
      <AppShell showSearch={false} title="Shift Report">
        <div className="mx-auto max-w-3xl p-4">
          <Card>
            <CardHeader>
              <CardTitle>Missing shift id</CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant="secondary" onClick={() => navigate('/reports')}>
                Back to Reports
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (!shift) {
    return (
      <AppShell showSearch={false} title="Shift Report">
        <div className="mx-auto max-w-3xl p-4">
          <Card>
            <CardHeader>
              <CardTitle>Shift not found</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">
                This shift may have been deleted or is still loading.
              </div>
              <Button variant="secondary" onClick={() => navigate('/reports')}>
                Back to Reports
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const startedAt = new Date(shift.startedAt);
  const endedAt = shift.endedAt ? new Date(shift.endedAt) : undefined;

  return (
    <AppShell showSearch={false} title="Shift Report">
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-xl">{shift.cashierName}</CardTitle>
              <div className="text-sm text-muted-foreground">
                {startedAt.toLocaleString()} → {endedAt ? endedAt.toLocaleString() : 'Still open'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={shift.status === 'open' ? 'bg-emerald-600' : undefined}>
                {shift.status.toUpperCase()}
              </Badge>
              <Button variant="secondary" className="gap-2" onClick={onDownloadPdf}>
                <Download className="h-4 w-4" />
                PDF
              </Button>
              <Button variant="secondary" className="gap-2" onClick={onShare} title="Share to WhatsApp">
                <Share2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">Transactions</div>
              <div className="text-lg font-semibold">{totals.transactionCount}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">Revenue</div>
              <div className="text-lg font-semibold">{currencySymbol}{totals.totalRevenue.toFixed(2)}</div>
            </div>
            {sensitiveVisible && (
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Profit</div>
                <div className="text-lg font-semibold">{currencySymbol}{totals.totalProfit.toFixed(2)}</div>
              </div>
            )}
            {typeof shift.openingCash === 'number' && (
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Opening cash</div>
                <div className="text-lg font-semibold">{currencySymbol}{shift.openingCash.toFixed(2)}</div>
              </div>
            )}
            {typeof shift.closingCash === 'number' && (
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">Closing cash</div>
                <div className="text-lg font-semibold">{currencySymbol}{shift.closingCash.toFixed(2)}</div>
              </div>
            )}
          </CardContent>
        </Card>

        {shiftReport && (
          <Card>
            <CardHeader>
              <CardTitle>Reconciliation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {shiftReport.difference < 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-bold text-destructive">
                  AUDIT SHIELD: SHORTAGE DETECTED — {currencySymbol}{Math.abs(shiftReport.difference).toFixed(2)}
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Expected cash</span>
                <span className="font-semibold">{currencySymbol}{shiftReport.expectedAmount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Counted cash</span>
                <span className="font-semibold">{currencySymbol}{shiftReport.actualAmount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Variance</span>
                <div className="text-right">
                  <div className={shiftReport.difference < 0 ? 'font-semibold text-destructive' : 'font-semibold text-success'}>
                    {currencySymbol}{shiftReport.difference.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {shiftReport.difference === 0
                      ? `🟢 Balanced — Good job, ${shiftReport.cashierName}!`
                      : shiftReport.difference > 0
                        ? '🟡 Overage — Someone forgot to give change or record a sale.'
                        : '🔴 Shortage — Money is missing. Investigation required.'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Transactions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {resolvedSales.length === 0 ? (
              <div className="text-sm text-muted-foreground">No sales found for this shift.</div>
            ) : (
              <div className="space-y-2">
                {[...resolvedSales]
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((s) => (
                    <Link
                      key={s.id}
                      to={`/receipt/${s.id}`}
                      className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50"
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-semibold">{s.receiptNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(s.createdAt).toLocaleString()} • {s.items?.length ?? 0} items
                        </div>
                      </div>
                      <div className="text-sm font-semibold">{currencySymbol}{(s.total ?? 0).toFixed(2)}</div>
                    </Link>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
