import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/layout/AppShell';
import { AdminGate } from '@/components/admin/AdminGate';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useStore } from '@/contexts/StoreContext';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { dexieDb } from '@/lib/db';
import type { Product, Sale } from '@/types/pos';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

function getTodayBounds() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export default function StockMasterPage() {
  const { settings } = useSupabaseAuth();
  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();
  const { currentStoreId, currentStore, isGlobalView } = useStore();

  const { start: startOfDay, end: endOfDay } = useMemo(getTodayBounds, []);

  const products = useLiveQuery(
    async () => {
      const all = await dexieDb.products.toArray();
      return all
        .filter((p) => (isGlobalView || !p.storeId || p.storeId === currentStoreId))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    [currentStoreId, isGlobalView]
  );

  const todaySales = useLiveQuery(
    async () => {
      const all = await dexieDb.sales.toArray();
      return all.filter((s) => {
        const created = s.createdAt instanceof Date ? s.createdAt : new Date(String(s.createdAt));
        if (created < startOfDay || created > endOfDay) return false;
        return isGlobalView || s.storeId === currentStoreId;
      }) as Sale[];
    },
    [currentStoreId, isGlobalView]
  );

  const resolvedProducts: Product[] = products ?? [];
  const resolvedSales: Sale[] = todaySales ?? [];

  const totalWarehouseValue = resolvedProducts.reduce((sum, p) => sum + p.buyingPrice * p.stock, 0);

  const totalTodayRevenue = resolvedSales.reduce((sum, s) => sum + (s.total ?? 0), 0);

  async function handleExportStockSheet() {
    try {
      if (!resolvedProducts.length) {
        toast.message('No products to export');
        return;
      }

      const { jsPDF } = await import('jspdf');

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      const shopName = settings?.shopName || 'Mthunzi Store';
      const storeName = currentStore?.name || 'All Stores';

      let y = 12;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(shopName, pageWidth / 2, y, { align: 'center' });
      y += 7;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      const dateText = new Date().toLocaleDateString();
      doc.text(`Stock Sheet · ${storeName} · ${dateText}`, pageWidth / 2, y, { align: 'center' });
      y += 8;

      doc.setLineWidth(0.2);
      doc.line(10, y, pageWidth - 10, y);
      y += 6;

      doc.setFontSize(10);
      doc.text(
        `Total warehouse value: ${currencySymbol}${totalWarehouseValue.toFixed(2)} | Today revenue: ${currencySymbol}${totalTodayRevenue.toFixed(2)}`,
        10,
        y
      );
      y += 6;

      const headers = ['Item', 'Buying', 'Selling', 'Stock', 'Total'];
      const colX = [10, 110, 140, 170, 190];

      function drawHeaderRow() {
        doc.setFont('helvetica', 'bold');
        headers.forEach((h, idx) => {
          doc.text(h, colX[idx], y);
        });
        y += 5;
        doc.setLineWidth(0.1);
        doc.line(10, y, pageWidth - 10, y);
        y += 4;
      }

      function ensureSpaceForRow() {
        if (y + 10 <= pageHeight - 10) return;
        doc.addPage();
        y = 12;
        drawHeaderRow();
      }

      drawHeaderRow();
      doc.setFont('helvetica', 'normal');

      for (const p of resolvedProducts) {
        ensureSpaceForRow();

        const totalValue = p.buyingPrice * p.stock;
        const name = p.name || '';

        doc.text(name.length > 40 ? `${name.slice(0, 37)}...` : name, colX[0], y, {
          maxWidth: 95,
        });
        doc.text(`${currencySymbol}${p.buyingPrice.toFixed(2)}`, colX[1], y);
        doc.text(`${currencySymbol}${p.sellingPrice.toFixed(2)}`, colX[2], y);
        doc.text(String(p.stock), colX[3], y);
        doc.text(`${currencySymbol}${totalValue.toFixed(2)}`, colX[4], y);

        y += 5;
      }

      const file = new File([doc.output('blob')], `stock-sheet-${storeName}-${dateText}.pdf`, {
        type: 'application/pdf',
      });

      const url = URL.createObjectURL(file);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) {
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success('Stock sheet PDF ready');
    } catch (e) {
      console.error('Failed to export stock sheet', e);
      toast.error('Failed to export stock sheet');
    }
  }

  return (
    <AdminGate>
      <AppShell title="Stock Master">
        <div className="space-y-4 p-4">
          {currentStore && (
            <p className="text-xs text-muted-foreground">
              Store: <span className="font-semibold">{currentStore.name}</span>
              {currentStore.location_name ? ` · ${currentStore.location_name}` : ''}
            </p>
          )}

          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Stock Master</CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 gap-2 sm:mt-0"
                onClick={handleExportStockSheet}
              >
                <Download className="h-4 w-4" />
                Export Stock Sheet (PDF)
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Buying Price</TableHead>
                      <TableHead>Selling Price</TableHead>
                      <TableHead>Current Stock</TableHead>
                      <TableHead>Total Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resolvedProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          No products found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      resolvedProducts.map((p) => {
                        const totalValue = p.buyingPrice * p.stock;
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="min-w-[160px] font-medium">{p.name}</TableCell>
                            <TableCell>{formatCurrency(p.buyingPrice)}</TableCell>
                            <TableCell>{formatCurrency(p.sellingPrice)}</TableCell>
                            <TableCell>{p.stock}</TableCell>
                            <TableCell>{formatCurrency(totalValue)}</TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Card className="flex-1">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Total Warehouse Value</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-2xl font-bold">
                      {formatCurrency(totalWarehouseValue)}
                    </p>
                    <p className="text-xs text-muted-foreground">Based on buying price × current stock.</p>
                  </CardContent>
                </Card>

                <Card className="flex-1">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Sold Items Summary (Today)</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-1">
                    <p className="text-2xl font-bold">
                      {formatCurrency(totalTodayRevenue)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Total revenue from items sold today for this store.
                    </p>
                    <Badge variant="outline" className="text-[10px] font-normal uppercase tracking-wide">
                      Physical Reconciliation Helper
                    </Badge>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    </AdminGate>
  );
}
