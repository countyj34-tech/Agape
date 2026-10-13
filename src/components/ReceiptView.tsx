import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import type { Sale } from '@/types/pos';
import { format } from 'date-fns';
import { Share2, Download, Home } from 'lucide-react';
import { toast } from 'sonner';
import { computeSalesTaxForSale, labelForSalesTaxMode } from '@/lib/taxEngine';
import { encodeSmartInvoiceQrData } from '@/lib/smartInvoice';
import { QRCodeSVG } from 'qrcode.react';
import { downloadReceiptPdf, shareReceiptPdfToWhatsApp } from '@/lib/receiptPdf';
import { MTZ_SUPPORT } from '@/lib/systemInfo';

interface ReceiptViewProps {
  sale: Sale;
  onClose?: () => void;
  onBackToHome?: () => void;
}

export function ReceiptView({ sale, onClose, onBackToHome }: ReceiptViewProps) {
  const { settings } = useSupabaseAuth();
  const [isGenerating, setIsGenerating] = useState(false);

  const currencySymbol = settings?.currencySymbol || 'K';
  const shopName = settings?.shopName || 'Mthunzi-Tech-Labs';
  const salesTax = computeSalesTaxForSale(sale, settings);
  const salesTaxAmount = Math.max(0, Number(sale.salesTaxAmount ?? salesTax.taxAmount ?? 0));
  const salesTaxRate = Math.max(0, Number(sale.salesTaxRate ?? salesTax.rate ?? 0));
  const salesTaxMode = (sale.salesTaxMode ?? salesTax.mode) as 'none' | 'tot' | 'vat';
  const salesTaxLabel = labelForSalesTaxMode(salesTaxMode);
  const showSalesTax = salesTaxRate > 0 && salesTaxAmount > 0;
  const smartInvoiceQr = encodeSmartInvoiceQrData(sale, settings);

  const handleDownload = async () => {
    try {
      setIsGenerating(true);
      await downloadReceiptPdf({ sale, settings });
      toast.success('Receipt PDF downloaded');
    } catch (e) {
      console.error(e);
      toast.error('Failed to generate PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleShare = async () => {
    try {
      setIsGenerating(true);
      const result = await shareReceiptPdfToWhatsApp({ sale, settings });
      if (result.shared) toast.success('Receipt shared');
      else if (result.reason === 'unsupported') toast.message('PDF downloaded. Attach it in WhatsApp.');
      else if (result.reason === 'cancelled') toast.message('Share cancelled');
      else toast.error('Failed to share');
    } catch (e) {
      console.error(e);
      toast.error('Failed to share');
    } finally {
      setIsGenerating(false);
    }
  };

  const dateStr = format(new Date(sale.createdAt), 'PPpp');

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="w-full max-w-sm rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 260 }}
        >
          <div className="space-y-4 p-4">
            <div className="text-center">
              <h2 className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
                Mthunzi-Tech-Labs
              </h2>
              <p className="text-sm font-medium">{shopName}</p>
              <p className="text-xs text-muted-foreground">{dateStr}</p>
            </div>

            {/* Thermal-style ticket */}
            <div
              className="mx-auto max-w-xs rounded-lg bg-zinc-50 p-4 text-xs text-zinc-900 shadow-inner"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold tracking-wide">RECEIPT</span>
                <span className="font-mono text-[10px] text-zinc-500">
                  #{sale.receiptNumber}
                </span>
              </div>
              <Separator className="my-2" />

              <div className="space-y-1">
                {sale.items.map((item) => {
                  const lineTotal = item.unitPrice * item.quantity;
                  return (
                    <div key={item.productId + item.productName} className="flex justify-between">
                      <div className="flex flex-col">
                        <span className="font-medium">{item.productName}</span>
                        <span className="text-[10px] text-zinc-500">
                          {item.quantity} × {currencySymbol}{item.unitPrice.toFixed(2)}
                        </span>
                      </div>
                      <span className="font-semibold">
                        {currencySymbol}{lineTotal.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <Separator className="my-2" />

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{currencySymbol}{sale.subtotal.toFixed(2)}</span>
                </div>
                {sale.discount > 0 && (
                  <div className="flex justify-between text-red-500">
                    <span>Discount</span>
                    <span>-{currencySymbol}{sale.discount.toFixed(2)}</span>
                  </div>
                )}
                {showSalesTax && (
                  <div className="flex justify-between">
                    <span>{salesTaxLabel} ({salesTaxRate.toFixed(0)}%)</span>
                    <span>{currencySymbol}{salesTaxAmount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-semibold">
                  <span>Total</span>
                  <span>{currencySymbol}{sale.total.toFixed(2)}</span>
                </div>
                {sale.amountPaid != null && (
                  <div className="flex justify-between">
                    <span>Paid</span>
                    <span>{currencySymbol}{sale.amountPaid.toFixed(2)}</span>
                  </div>
                )}
                {sale.changeGiven != null && sale.changeGiven > 0 && (
                  <div className="flex justify-between">
                    <span>Change</span>
                    <span>{currencySymbol}{sale.changeGiven.toFixed(2)}</span>
                  </div>
                )}
                {sale.balanceDue != null && sale.balanceDue > 0 && (
                  <div className="flex justify-between text-amber-600">
                    <span>Balance</span>
                    <span>{currencySymbol}{sale.balanceDue.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <Separator className="my-2" />

              {sale.zraSmartInvoiceEnabled ? (
                <div className="space-y-1">
                  {sale.zraTpin && (
                    <div className="flex justify-between">
                      <span>TPIN</span>
                      <span>{sale.zraTpin}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Invoice Number</span>
                    <span>{sale.zraInvoiceNumber || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Verification Code</span>
                    <span>{sale.zraVerificationCode || '—'}</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 py-1">
                    <div className="rounded-md bg-white p-2">
                      <QRCodeSVG value={smartInvoiceQr || ' '} size={112} />
                    </div>
                    <p className="text-center text-[10px] text-zinc-500">QR Code</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-1">
                  <div className="rounded-md bg-white p-2">
                    <QRCodeSVG value={smartInvoiceQr} size={112} />
                  </div>
                  <p className="text-center text-[10px] text-zinc-500">
                    Smart Invoice (scan to verify)
                  </p>
                </div>
              )}

              <div className="space-y-1 text-center text-[10px] text-zinc-500">
                <p>{settings?.receiptFooter || 'Thank you for shopping with us!'}</p>
                <p>{MTZ_SUPPORT.receiptSignature}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1 gap-2"
                variant="default"
                size="sm"
                disabled={isGenerating}
                onClick={handleShare}
                title="Share to WhatsApp"
              >
                <Share2 className="h-4 w-4" />
              </Button>
              <Button
                className="flex-1 gap-2"
                variant="outline"
                size="sm"
                disabled={isGenerating}
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
            </div>

            <div className="flex justify-center gap-2 text-xs">
              {onBackToHome && (
                <Button variant="ghost" size="sm" onClick={onBackToHome} className="gap-1">
                  <Home className="h-3 w-3" />
                  Home
                </Button>
              )}
              {onClose && (
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
