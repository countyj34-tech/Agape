import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { dexieDb } from '@/lib/db';
import type { Sale } from '@/types/pos';
import { Check, Download, Printer, Share2, Home, Bluetooth } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useLiveQuery } from 'dexie-react-hooks';
import { ReceiptView } from '@/components/ReceiptView';
import { useBluetoothPrinter } from '@/hooks/useBluetoothPrinter';
import { computeSalesTaxForSale, labelForSalesTaxMode } from '@/lib/taxEngine';
import { encodeSmartInvoiceQrData } from '@/lib/smartInvoice';
import { QRCodeSVG } from 'qrcode.react';
import { downloadReceiptPdf, shareReceiptPdfToWhatsApp } from '@/lib/receiptPdf';

export default function ReceiptPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const { settings } = useSupabaseAuth();
  const { format: formatCurrency } = useCurrencyFormatter();

  const routeSaleId = params.id;
  const saleFromState = location.state?.sale as Sale | undefined;

  const [retryNonce, setRetryNonce] = useState(0);
  const [showOverlayReceipt, setShowOverlayReceipt] = useState(Boolean(saleFromState));

  const { state: printerState, discoverAndConnect, printSale } = useBluetoothPrinter();

  // undefined = loading, null = not found
  const saleFromDb = useLiveQuery(
    async () => {
      if (!routeSaleId) return null;
      const s = (await dexieDb.sales.get(routeSaleId)) as Sale | undefined;
      return s ?? null;
    },
    [routeSaleId, retryNonce]
  );

  const sale = saleFromState?.id === routeSaleId ? saleFromState : saleFromDb ?? undefined;
  const shopName = settings?.shopName || 'Mthunzi Store';

  const salesTax = sale ? computeSalesTaxForSale(sale, settings) : null;
  const salesTaxAmount = sale
    ? Math.max(0, Number(sale.salesTaxAmount ?? salesTax?.taxAmount ?? 0))
    : 0;
  const salesTaxRate = sale
    ? Math.max(0, Number(sale.salesTaxRate ?? salesTax?.rate ?? 0))
    : 0;
  const salesTaxMode = sale ? ((sale.salesTaxMode ?? salesTax?.mode ?? 'none') as 'none' | 'tot' | 'vat') : 'none';
  const salesTaxLabel = labelForSalesTaxMode(salesTaxMode);
  const showSalesTax = Boolean(sale && salesTaxRate > 0 && salesTaxAmount > 0);
  const smartInvoiceQr = sale ? encodeSmartInvoiceQrData(sale, settings) : '';

  const amountPaid = Math.max(0, sale?.amountPaid ?? 0);
  const balanceDue = Math.max(0, sale?.balanceDue ?? 0);
  const effectivePaidNow = sale
    ? amountPaid > 0
      ? amountPaid
      : sale.paymentMethod === 'credit'
        ? 0
        : sale.total
    : 0;

  if (!routeSaleId) {
    navigate('/');
    return null;
  }

  if (saleFromDb === undefined && !saleFromState) {
    return (
      <AppShell title="Receipt" hideNav hideFooter>
        <div className="mx-auto max-w-sm space-y-4 p-4">
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="text-sm text-muted-foreground">Loading receipt…</p>
              <Button variant="outline" onClick={() => setRetryNonce((n) => n + 1)}>
                Try Again
              </Button>
              <Button variant="outline" onClick={() => navigate('/sales')}>
                Back to Sales
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (!sale) {
    return (
      <AppShell title="Receipt" hideNav hideFooter>
        <div className="mx-auto max-w-sm space-y-4 p-4">
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="text-sm font-medium">Receipt not found</p>
              <p className="text-sm text-muted-foreground">
                This receipt may have been deleted, or it belongs to another device.
              </p>
              <Button variant="outline" onClick={() => setRetryNonce((n) => n + 1)}>
                Try Again
              </Button>
              <Button variant="outline" onClick={() => navigate('/sales')}>
                Back to Sales
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const handleDownloadPDF = async () => {
    try {
      await downloadReceiptPdf({ sale, settings });
      toast.success('Receipt PDF downloaded');
    } catch (error) {
      console.error(error);
      toast.error('Failed to generate PDF');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleBluetoothPrint = async () => {
    if (!sale) return;
    if (!settings) {
      toast.error('Settings not loaded');
      return;
    }

    try {
      if (printerState.kind === 'unsupported') {
        toast.error('Bluetooth printing is not supported in this browser. Use Chrome/Edge.');
        return;
      }
      if (printerState.kind === 'disconnected' || printerState.kind === 'error') {
        await discoverAndConnect();
      }
      await printSale(sale, settings);
      toast.success('Receipt sent to printer');
    } catch (e) {
      console.error(e);
      toast.error((e as Error)?.message || 'Bluetooth print failed');
    }
  };

  const handleShare = async () => {
    try {
      const result = await shareReceiptPdfToWhatsApp({ sale, settings });
      if (result.shared) toast.success('Receipt shared');
      else if (result.reason === 'unsupported') toast.message('PDF downloaded. Attach it in WhatsApp.');
      else if (result.reason === 'cancelled') toast.message('Share cancelled');
      else toast.error('Failed to share');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error(error);
        toast.error('Failed to share');
      }
    }
  };

  return (
    <AppShell title="Receipt" hideNav hideFooter>
      <div className="mx-auto max-w-sm space-y-4 p-4">
        <Card className="border-emerald-500/80 shadow-lg shadow-emerald-500/20">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img
                  src="/icons/icon-192.svg"
                  alt="Mthunzi-Tech-Labs logo"
                  className="h-7 w-7 rounded-md object-contain"
                />
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Mthunzi-Tech-Labs
                  </span>
                  <span className="text-xs font-medium">{shopName}</span>
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <Check className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Payment Successful</p>
                  <p className="text-xs text-muted-foreground">
                    Sale completed and saved on this device.
                  </p>
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>{format(new Date(sale.createdAt), 'dd MMM yyyy')}</p>
                <p>{format(new Date(sale.createdAt), 'HH:mm')}</p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Store</span>
                <span className="font-medium">{shopName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Receipt</span>
                <span className="font-mono text-[11px]">{sale.receiptNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatCurrency(sale.total)}</span>
              </div>
            </div>

            <Separator />

            <div className="space-y-2 text-xs">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Items
              </p>
              <div className="space-y-1">
                {sale.items.map((item) => (
                  <div key={item.productId + item.productName} className="flex justify-between">
                    <div className="flex flex-col">
                      <span className="font-medium">{item.productName}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {item.quantity} × {formatCurrency(item.unitPrice)}
                      </span>
                    </div>
                    <span className="font-semibold">
                      {formatCurrency(item.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(sale.subtotal)}</span>
              </div>
              {sale.discount > 0 && (
                <div className="flex justify-between text-destructive">
                  <span>Discount</span>
                  <span>-{formatCurrency(sale.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-semibold">
                <span>Total</span>
                <span>{formatCurrency(sale.total)}</span>
              </div>
              {showSalesTax && salesTax && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Tax ({salesTaxLabel} {salesTaxRate.toFixed(0)}%)
                  </span>
                  <span className="font-medium">{formatCurrency(salesTaxAmount)}</span>
                </div>
              )}
              {amountPaid > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <span>{formatCurrency(effectivePaidNow)}</span>
                </div>
              )}
              {balanceDue > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>Balance</span>
                  <span>{formatCurrency(balanceDue)}</span>
                </div>
              )}
            </div>

            <Separator />

            {sale.zraSmartInvoiceEnabled ? (
              <div className="space-y-2 text-xs">
                <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  ZRA Smart Invoice
                </p>
                {sale.zraTpin && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">TPIN</span>
                    <span className="font-medium">{sale.zraTpin}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice Number</span>
                  <span className="font-medium">{sale.zraInvoiceNumber || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Verification Code</span>
                  <span className="font-medium">{sale.zraVerificationCode || '—'}</span>
                </div>
                <div className="flex flex-col items-center gap-2 pt-2">
                  <div className="rounded-md bg-white p-2">
                    <QRCodeSVG value={smartInvoiceQr || ' '} size={140} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">QR Code</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="rounded-md bg-white p-2">
                  <QRCodeSVG value={smartInvoiceQr} size={140} />
                </div>
                <p className="text-[10px] text-muted-foreground">Smart Invoice QR (scan to verify)</p>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1 gap-2" variant="default" size="sm" onClick={handleDownloadPDF}>
                <Download className="h-4 w-4" />
                Download PDF
              </Button>
              <Button
                className="flex-1 gap-2"
                variant="outline"
                size="sm"
                onClick={() => {
                  navigate('/');
                }}
              >
                <Home className="h-4 w-4" />
                New Sale
              </Button>
            </div>

            <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
              <Printer className="h-3 w-3" />
              <span>For best results, print in portrait on a thermal printer.</span>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="grid grid-cols-4 gap-2 print:hidden">
          <Button variant="outline" onClick={handleDownloadPDF} className="flex-col gap-1 py-6">
            <Download className="h-5 w-5" />
            <span className="text-xs">PDF</span>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (printerState.kind === 'connected') handleBluetoothPrint();
              else handlePrint();
            }}
            className="flex-col gap-1 py-6"
          >
            <Printer className="h-5 w-5" />
            <span className="text-xs">Print</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleBluetoothPrint}
            className="flex-col gap-1 py-6"
            title={
              printerState.kind === 'connected'
                ? `Connected: ${printerState.deviceName}`
                : printerState.kind === 'connecting'
                  ? 'Connecting…'
                  : printerState.kind === 'unsupported'
                    ? 'Bluetooth unsupported'
                    : 'Not connected'
            }
          >
            <Bluetooth className="h-5 w-5" />
            <span className="text-xs">Bluetooth</span>
          </Button>
          <Button variant="outline" onClick={handleShare} className="flex-col gap-1 py-6" title="Share to WhatsApp">
            <Share2 className="h-5 w-5" />
          </Button>
        </div>

        {/* New Sale Button */}
        <Button
          size="lg"
          onClick={() => navigate('/')}
          className="w-full gap-2 print:hidden"
        >
          <Home className="h-5 w-5" />
          New Sale
        </Button>
      </div>
    </AppShell>
  );
}
