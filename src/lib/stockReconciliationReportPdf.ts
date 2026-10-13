import type { Settings, StockReconciliationSession } from '@/types/pos';

let jspdfModulePromise: Promise<{ jsPDF: any }> | null = null;

export function preloadStockReconciliationPdfDeps() {
  if (!jspdfModulePromise) {
    jspdfModulePromise = import('jspdf') as Promise<{ jsPDF: any }>;
  }
  return jspdfModulePromise;
}

function safeFixed(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '0.00';
  return value.toFixed(decimals);
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

function addSectionTitle(doc: any, title: string, y: number, pageWidth: number) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(title, 12, y);
  doc.setLineWidth(0.2);
  doc.line(12, y + 1.5, pageWidth - 12, y + 1.5);
  return y + 6;
}

function ensureSpace(doc: any, y: number, pageHeight: number, needed = 12): number {
  if (y + needed > pageHeight - 15) {
    doc.addPage();
    return 15;
  }
  return y;
}

export async function generateStockExtractionPreviewPdfFile(args: {
  session: StockReconciliationSession;
  settings?: Settings | null;
}): Promise<File> {
  const { session, settings } = args;
  const { jsPDF } = await preloadStockReconciliationPdfDeps();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let y = 15;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Stock Sheet Extraction Preview', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const headerLines = [
    settings?.shopName ? `Prepared for: ${settings.shopName}` : '',
    `Company: ${session.companyName}`,
    `Store: ${session.storeName}`,
    `Report Date: ${session.reportDate}`,
    `Extracted: ${new Date().toLocaleString()}`,
    `Rows: ${session.extractionPreview?.length ?? 0}`,
  ].filter(Boolean);
  for (const line of headerLines) {
    doc.text(line, 12, y);
    y += 5;
  }

  y = addSectionTitle(doc, 'Extracted Stock Data (review before matching)', y + 4, pageWidth);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('Product', 12, y);
  doc.text('Opening', 95, y);
  doc.text('Refill', 115, y);
  doc.text('Closing', 135, y);
  y += 4;
  doc.setFont('helvetica', 'normal');

  const rows = session.extractionPreview ?? [];
  for (const row of rows) {
    y = ensureSpace(doc, y, pageHeight, 6);
    const opening = row.opening ?? row.quantity ?? 0;
    const refill = row.refill ?? 0;
    const closing = row.closing ?? 0;
    const name = String(row.rawName || '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const label = name.length > 42 ? `${name.slice(0, 39)}...` : name || 'Unknown';
    doc.text(label, 12, y);
    doc.text(String(opening), 95, y);
    doc.text(String(refill), 115, y);
    doc.text(String(closing), 135, y);
    y += 4;
  }

  y = ensureSpace(doc, y + 8, pageHeight, 12);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.text(
    'Review this PDF against your paper sheets. Fix names/numbers in the app, then run Match Products.',
    12,
    y
  );

  const blob = doc.output('blob');
  const safeStore = String(session.storeName || 'store').replace(/[^\w\-]+/g, '-');
  const safeDate = String(session.reportDate || 'date').replace(/[^\w\-]+/g, '-');
  const filename = `stock-extraction-${safeDate}-${safeStore}.pdf`;
  return new File([blob], filename, { type: 'application/pdf' });
}

export async function downloadStockExtractionPreviewPdf(args: {
  session: StockReconciliationSession;
  settings?: Settings | null;
}) {
  const file = await generateStockExtractionPreviewPdfFile(args);
  downloadBlob(file, file.name);
}

export async function generateStockReconciliationPdfFile(args: {
  session: StockReconciliationSession;
  settings?: Settings | null;
}): Promise<File> {
  const { session, settings } = args;
  const { jsPDF } = await (jspdfModulePromise ?? preloadStockReconciliationPdfDeps());
  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const currency = settings?.currencySymbol || 'K';

  let y = 15;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(session.companyName, pageWidth / 2, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('AI Stock Reconciliation Report', pageWidth / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(9);
  doc.text(`Branch: ${session.storeName}  |  Date: ${session.reportDate}`, pageWidth / 2, y, { align: 'center' });
  y += 8;

  if (session.narrativeReport?.trim()) {
    y = addSectionTitle(doc, 'Daily Operations Report', y, pageWidth);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const pdfNarrative = session.narrativeReport
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of pdfNarrative) {
      const wrapped = doc.splitTextToSize(line, pageWidth - 24);
      for (const part of wrapped) {
        y = ensureSpace(doc, y, pageHeight, 5);
        doc.text(part, 12, y);
        y += 4.2;
      }
    }
    y += 4;
  }

  y = addSectionTitle(doc, 'Summary', y, pageWidth);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const summaryLines = [
    `Opening Stock Items: ${session.openingStockSummary.itemCount}  |  Value: ${currency}${safeFixed(session.openingStockSummary.totalValue)}`,
    `Closing Stock Items: ${session.closingStockSummary.itemCount}  |  Value: ${currency}${safeFixed(session.closingStockSummary.totalValue)}`,
    `Stock Refill Items: ${session.refillSummary.itemCount}  |  Quantity: ${session.refillSummary.totalQuantity}`,
    `Products Sold: ${session.productsSold}  |  Units Sold: ${session.quantitySold}`,
    `Revenue: ${currency}${safeFixed(session.revenue)}  |  Estimated Profit: ${currency}${safeFixed(session.estimatedProfit)}`,
  ];
  for (const line of summaryLines) {
    y = ensureSpace(doc, y, pageHeight, 6);
    doc.text(line, 12, y);
    y += 4.5;
  }
  y += 3;

  y = addSectionTitle(doc, 'Products Sold', y, pageWidth);
  doc.setFontSize(8);
  const soldLines = session.lineItems.filter((item) => item.quantitySold > 0);
  if (!soldLines.length) {
    doc.text('No sold products detected.', 12, y);
    y += 5;
  } else {
    for (const item of soldLines) {
      y = ensureSpace(doc, y, pageHeight, 5);
      doc.text(
        `${item.productName}  |  Sold: ${item.quantitySold}  |  Revenue: ${currency}${safeFixed(item.revenue)}`,
        12,
        y
      );
      y += 4;
    }
  }
  y += 3;

  y = addSectionTitle(doc, 'Low Stock Items', y, pageWidth);
  if (!session.lowStockItems.length) {
    doc.text('None', 12, y);
    y += 5;
  } else {
    for (const item of session.lowStockItems) {
      y = ensureSpace(doc, y, pageHeight, 5);
      doc.text(`${item.productName}  |  Qty: ${item.quantity}`, 12, y);
      y += 4;
    }
  }
  y += 3;

  y = addSectionTitle(doc, 'Products Not Matched', y, pageWidth);
  if (!session.unmatchedItems.length) {
    doc.text('None', 12, y);
    y += 5;
  } else {
    for (const name of session.unmatchedItems) {
      y = ensureSpace(doc, y, pageHeight, 5);
      doc.text(name, 12, y);
      y += 4;
    }
  }
  y += 3;

  y = addSectionTitle(doc, 'Data Errors', y, pageWidth);
  if (!session.dataErrors.length) {
    doc.text('None', 12, y);
    y += 5;
  } else {
    for (const error of session.dataErrors) {
      y = ensureSpace(doc, y, pageHeight, 5);
      doc.text(error, 12, y);
      y += 4;
    }
  }
  y += 4;

  y = addSectionTitle(doc, 'Audit Trail', y, pageWidth);
  doc.setFontSize(8);
  const auditLines = [
    `Upload Time: ${session.uploadStartedAt ? new Date(session.uploadStartedAt).toLocaleString() : 'N/A'}`,
    `Processing Time: ${session.processingDurationMs ? `${(session.processingDurationMs / 1000).toFixed(1)}s` : 'N/A'}`,
    `Approval Time: ${session.approvedAt ? new Date(session.approvedAt).toLocaleString() : 'Pending'}`,
    `Approved By: ${session.approvedBy || 'Pending'}`,
    `Prepared By: ${session.preparedBy || 'MTHUNZI POS'}`,
    `Original Images: ${session.images.length}`,
  ];
  for (const line of auditLines) {
    y = ensureSpace(doc, y, pageHeight, 5);
    doc.text(line, 12, y);
    y += 4;
  }

  y = ensureSpace(doc, y + 6, pageHeight, 10);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.text('Generated By MTHUNZI POS', pageWidth / 2, y, { align: 'center' });

  const blob = doc.output('blob');
  const filename = `stock-reconciliation-${session.reportDate}-${session.storeName.replace(/\s+/g, '-')}.pdf`;
  return new File([blob], filename, { type: 'application/pdf' });
}

export async function downloadStockReconciliationPdf(args: {
  session: StockReconciliationSession;
  settings?: Settings | null;
}) {
  const file = await generateStockReconciliationPdfFile(args);
  downloadBlob(file, file.name);
}

export async function shareStockReconciliationPdfToWhatsApp(args: {
  session: StockReconciliationSession;
  settings?: Settings | null;
  phone?: string;
}) {
  const file = await generateStockReconciliationPdfFile(args);
  const text = encodeURIComponent(
    `AI Stock Reconciliation Report\n${args.session.companyName}\n${args.session.storeName}\n${args.session.reportDate}`
  );

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      title: 'Stock Reconciliation Report',
      text: decodeURIComponent(text),
      files: [file],
    });
    return;
  }

  downloadBlob(file, file.name);
  const phoneDigits = (args.phone || '').replace(/\D/g, '');
  const url = phoneDigits
    ? `https://wa.me/${phoneDigits}?text=${text}`
    : `https://wa.me/?text=${text}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
