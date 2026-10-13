import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { getAllProducts } from '@/lib/db';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { QRCodeSVG } from 'qrcode.react';

export default function ShelfLabelsPage() {
  const { settings } = useSupabaseAuth();
  const { format: formatCurrency, currencySymbol } = useCurrencyFormatter();
  const shopName = settings?.shopName || 'Mthunzi Store';

  const products = useLiveQuery(async () => {
    const all = await getAllProducts();
    return all.filter((p) => p.barcode); // Only label products that can be scanned
  }, []);

  const handlePrint = () => {
    window.print();
  };

  return (
    <AppShell title="Shelf Labels" hideNav={false}>
      <div className="mx-auto max-w-5xl space-y-4 p-4 print:max-w-none print:p-0">
        <div className="flex items-center justify-between gap-2 print:hidden">
          <div>
            <h1 className="text-lg font-semibold">Shelf Labels</h1>
            <p className="text-sm text-muted-foreground">
              QR labels generated from your local inventory. Print and place them on shelves – your
              team just scans the label to add items to the cart.
            </p>
          </div>
          <Button onClick={handlePrint} size="sm">
            Print A4 Sheet
          </Button>
        </div>

        {!products ? (
          <p className="text-sm text-muted-foreground">Loading products…</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No products with barcodes found. Add products in the Inventory page first.
          </p>
        ) : (
          <Card className="border-dashed print:border-none">
            <CardHeader className="print:hidden">
              <CardTitle>Labels for {shopName}</CardTitle>
            </CardHeader>
            <CardContent className="print:p-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-3">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="flex h-40 flex-col items-center justify-between rounded-md border p-2 text-center text-xs print:h-36 print:border-0"
                  >
                    <div className="flex-1 flex flex-col items-center justify-center gap-1">
                      <span className="line-clamp-2 font-semibold leading-tight">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground">{shopName}</span>
                    </div>
                    <QRCodeSVG
                      value={p.barcode || p.id}
                      size={72}
                      includeMargin={false}
                      className="mx-auto"
                    />
                    <div className="mt-1 flex w-full items-center justify-between text-[11px] font-medium">
                      <span>{p.barcode}</span>
                      <span>
                        {currencySymbol}
                        {formatCurrency(p.sellingPrice)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
