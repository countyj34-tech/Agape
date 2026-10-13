import type { Sale, Settings } from '@/types/pos';
import { computeSalesTaxForSale, labelForSalesTaxMode } from '@/lib/taxEngine';
import { encodeSmartInvoiceQrData } from '@/lib/smartInvoice';
import { MTZ_SUPPORT } from '@/lib/systemInfo';

let depsPromise:
  | Promise<{
      jsPDF: any;
      JsBarcode: any;
      QRCode: any;
    }>
  | null = null;

export function preloadReceiptPdfDeps() {
  if (!depsPromise) {
    depsPromise = (async () => {
      const [{ jsPDF }, jsbarcodeMod, qrcodeMod] = await Promise.all([
        import('jspdf') as Promise<{ jsPDF: any }>,
        import('jsbarcode'),
        import('qrcode'),
      ]);

      const JsBarcode = (jsbarcodeMod as any)?.default ?? jsbarcodeMod;
      const QRCode = (qrcodeMod as any)?.default ?? qrcodeMod;

      return { jsPDF, JsBarcode, QRCode };
    })();
  }
  return depsPromise;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openBlobInNewTab(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Boolean(win);
}

async function barcodePngDataUrl(args: {
  JsBarcode: any;
  value: string;
  widthPx: number;
}): Promise<string> {
  const canvas = document.createElement('canvas');
  // A bit wider than target so jsbarcode can scale nicely.
  canvas.width = Math.max(480, args.widthPx);
  canvas.height = 120;

  args.JsBarcode(canvas, args.value, {
    format: 'CODE128',
    displayValue: true,
    font: 'monospace',
    fontSize: 18,
    textMargin: 4,
    height: 60,
    margin: 0,
  });

  return canvas.toDataURL('image/png');
}

async function qrPngDataUrl(args: {
  QRCode: any;
  value: string;
  sizePx: number;
}): Promise<string> {
  // qrcode library API: toDataURL(text, options)
  return await args.QRCode.toDataURL(args.value, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: args.sizePx,
  });
}

export async function generateReceiptPdfFile(args: {
  sale: Sale;
  settings?: Settings | null;
}): Promise<File> {
  const { sale, settings } = args;
  const { jsPDF, JsBarcode, QRCode } = await preloadReceiptPdfDeps();

  // Thermal-style receipt page size (more realistic than A6).
  const thermalWidth = settings?.thermalPrinterWidth === '58mm' ? 58 : 80;
  // Large page height to fit most receipts; jsPDF doesn't support truly dynamic height.
  const doc = new jsPDF({ format: [thermalWidth, 280], unit: 'mm' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const marginX = 4;
  const rightX = pageWidth - marginX;

  const shopName = settings?.shopName || 'Mthunzi Store';
  const address = String(settings?.shopAddress || '').trim();
  const phone = String(settings?.shopPhone || '').trim();
  const currency = settings?.currencySymbol || 'K';

  const salesTax = computeSalesTaxForSale(sale, settings);
  const salesTaxAmount = Math.max(0, Number(sale.salesTaxAmount ?? salesTax.taxAmount ?? 0));
  const salesTaxRate = Math.max(0, Number(sale.salesTaxRate ?? salesTax.rate ?? 0));
  const salesTaxMode = (sale.salesTaxMode ?? salesTax.mode) as 'none' | 'tot' | 'vat';
  const salesTaxLabel = labelForSalesTaxMode(salesTaxMode);
  const showSalesTax = salesTaxRate > 0 && salesTaxAmount > 0;

  const receiptNumber = String(sale.receiptNumber || sale.id);

  // Header
  let y = 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(shopName, pageWidth / 2, y, { align: 'center' });
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  if (address) {
    const lines = doc.splitTextToSize(address, pageWidth - marginX * 2);
    doc.text(lines, pageWidth / 2, y, { align: 'center' });
    y += Math.max(3, lines.length * 3.2);
  }
  if (phone) {
    doc.text(phone, pageWidth / 2, y, { align: 'center' });
    y += 4;
  }

  const date = new Date(sale.createdAt);
  doc.setFontSize(8);
  doc.text(date.toLocaleString(), pageWidth / 2, y, { align: 'center' });
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.text(`RECEIPT`, pageWidth / 2, y, { align: 'center' });
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.text(`No: ${receiptNumber}`, pageWidth / 2, y, { align: 'center' });
  y += 3;

  // Barcode
  const barcode = await barcodePngDataUrl({ JsBarcode, value: receiptNumber, widthPx: 600 });
  const barcodeW = pageWidth - marginX * 2;
  const barcodeH = 16;
  doc.addImage(barcode, 'PNG', marginX, y, barcodeW, barcodeH);
  y += barcodeH + 5;

  // Divider
  doc.setDrawColor(180);
  doc.line(marginX, y, rightX, y);
  y += 5;

  // Items
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('ITEM', marginX, y);
  doc.text('AMOUNT', rightX, y, { align: 'right' });
  y += 4;

  doc.setFont('helvetica', 'normal');
  for (const item of sale.items) {
    const qty = Number(item.quantity ?? 0);
    const unitPrice = Number(item.unitPrice ?? 0);
    const lineTotal = Number(item.total ?? qty * unitPrice);

    const left = `${item.productName} x${qty}`;
    const leftLines = doc.splitTextToSize(left, pageWidth - marginX * 2 - 16);

    if (y > pageHeight - 28) {
      doc.addPage();
      y = 10;
    }

    doc.text(leftLines, marginX, y);
    doc.text(`${currency}${lineTotal.toFixed(2)}`, rightX, y, { align: 'right' });
    y += Math.max(4, leftLines.length * 3.2);
  }

  y += 1;
  doc.setDrawColor(180);
  doc.line(marginX, y, rightX, y);
  y += 5;

  // Totals
  const line = (label: string, value: number, bold = false) => {
    if (y > pageHeight - 28) {
      doc.addPage();
      y = 10;
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, marginX, y);
    const formatted = value < 0 ? `-${currency}${Math.abs(value).toFixed(2)}` : `${currency}${value.toFixed(2)}`;
    doc.text(formatted, rightX, y, { align: 'right' });
    y += 4;
  };

  line('Subtotal', Number(sale.subtotal ?? 0));
  if (Number(sale.discount ?? 0) > 0) line('Discount', -Math.abs(Number(sale.discount ?? 0)));
  if (showSalesTax) line(`${salesTaxLabel} (${salesTaxRate.toFixed(0)}%)`, salesTaxAmount);
  line('Total', Number(sale.total ?? 0), true);

  const amountPaid = Number(sale.amountPaid ?? 0);
  if (amountPaid > 0) line('Paid', amountPaid);

  const changeGiven = Number(sale.changeGiven ?? 0);
  if (changeGiven > 0) line('Change', changeGiven);

  const balanceDue = Number(sale.balanceDue ?? 0);
  if (balanceDue > 0) line('Balance', balanceDue);

  if (sale.zraSmartInvoiceEnabled) {
    y += 2;
    doc.setDrawColor(180);
    doc.line(marginX, y, rightX, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    if (sale.zraTpin) {
      doc.text(`TPIN: ${sale.zraTpin}`, marginX, y);
      y += 4;
    }
    doc.text(`Invoice Number: ${sale.zraInvoiceNumber || ''}`, marginX, y);
    y += 4;
    doc.text(`Verification Code: ${sale.zraVerificationCode || ''}`, marginX, y);
    y += 4;
  }

  y += 2;
  doc.setDrawColor(180);
  doc.line(marginX, y, rightX, y);
  y += 5;

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  const footer = String(settings?.receiptFooter || 'Thank you for shopping with us!').trim();
  if (footer) {
    doc.text(footer, pageWidth / 2, y, { align: 'center' });
    y += 4;
  }

  doc.setFontSize(6);
  doc.text(MTZ_SUPPORT.receiptSignature, pageWidth / 2, y, { align: 'center' });
  y += 6;

  // Smart invoice QR (clean, no raw payload printed)
  const qrValue = encodeSmartInvoiceQrData(sale, settings);

  const qr = await qrPngDataUrl({ QRCode, value: qrValue, sizePx: 240 });
  const qrSize = 22;
  if (y + qrSize + 10 > pageHeight) {
    doc.addPage();
    y = 12;
  }
  doc.addImage(qr, 'PNG', (pageWidth - qrSize) / 2, y, qrSize, qrSize);
  y += qrSize + 3;
  doc.setFontSize(6);
  doc.text(
    sale.zraSmartInvoiceEnabled ? 'QR Code' : 'Smart Invoice QR (scan to verify)',
    pageWidth / 2,
    y,
    { align: 'center' }
  );

  // Output as file
  const filename = `receipt-${receiptNumber}.pdf`;
  try {
    const blob = doc.output('blob') as Blob;
    return new File([blob], filename, { type: 'application/pdf' });
  } catch {
    const ab = doc.output('arraybuffer') as ArrayBuffer;
    return new File([ab], filename, { type: 'application/pdf' });
  }
}

export async function downloadReceiptPdf(args: { sale: Sale; settings?: Settings | null }): Promise<File> {
  const file = await generateReceiptPdfFile(args);
  downloadBlob(file, file.name);
  openBlobInNewTab(file);
  return file;
}

export async function shareReceiptPdfToWhatsApp(args: {
  sale: Sale;
  settings?: Settings | null;
}): Promise<{ shared: boolean; reason?: 'unsupported' | 'cancelled' | 'error' }> {
  const file = await generateReceiptPdfFile(args);

  const navAny = navigator as any;
  const canShareFile = Boolean(navAny?.canShare?.({ files: [file] }) && navigator.share);

  if (canShareFile) {
    try {
      // Important: do NOT include text/url here. Some platforms append the current page link when text is present.
      await navigator.share({ files: [file] });
      return { shared: true };
    } catch (e: any) {
      const name = String(e?.name ?? '');
      if (name.toLowerCase().includes('abort')) return { shared: false, reason: 'cancelled' };
      return { shared: false, reason: 'error' };
    }
  }

  // Fallback (desktop browsers): we can't attach files directly to WhatsApp from the browser.
  // Best-effort: download/open the PDF and open WhatsApp without a caption/link.
  downloadBlob(file, file.name);
  openBlobInNewTab(file);

  window.open('https://wa.me/', '_blank', 'noopener,noreferrer');

  return { shared: false, reason: 'unsupported' };
}
