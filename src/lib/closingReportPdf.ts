import type { Settings, ShiftReport } from '@/types/pos';
import { preloadEodPdfDeps } from '@/lib/eodPdf';

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
  const win = window.open(url, '_blank');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Boolean(win);
}

function setWindowToBlob(win: Window | null, blob: Blob): boolean {
  if (!win) {
    return false;
  }

  const url = URL.createObjectURL(blob);
  try {
    win.location.href = url;
    return true;
  } catch {
    try {
      win.close();
    } catch {
      // Ignore if closing also fails.
    }
    return false;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function generateClosingReportPdfFile(args: {
  shiftReport: ShiftReport;
  stockValue: number;
  digitalTotal: number;
  // Optional daily statement extras for a richer closing view
  totalSales?: number;
  newStockCost?: number;
  settings?: Settings | null;
  discrepancyNote?: string;
}): Promise<File> {
  const { shiftReport, stockValue, digitalTotal, totalSales, newStockCost, settings, discrepancyNote } = args;
  const { jsPDF } = await preloadEodPdfDeps();

  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const shopName = settings?.shopName || 'Mthunzi Store';
  const currency = settings?.currencySymbol || 'K';

  const createdAt = shiftReport.createdAt instanceof Date
    ? shiftReport.createdAt
    : new Date(String(shiftReport.createdAt));

  let y = 18;

  // Header branding
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(shopName, pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Closing Report', pageWidth / 2, y, { align: 'center' });
  y += 6;

  const dateStr = createdAt.toLocaleDateString();
  const timeStr = createdAt.toLocaleTimeString();
  doc.setFontSize(10);
  doc.text(`Shift cashier: ${shiftReport.cashierName}`, pageWidth / 2, y, { align: 'center' });
  y += 5;
  doc.text(`Created: ${dateStr} ${timeStr}`, pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  // Actual vs expected
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Actual vs Expected (Cash)', 12, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);

  const row = (label: string, value: number, bold = false, color?: [number, number, number]) => {
    if (bold) {
      doc.setFont('helvetica', 'bold');
    } else {
      doc.setFont('helvetica', 'normal');
    }
    if (color) {
      doc.setTextColor(color[0], color[1], color[2]);
    } else {
      doc.setTextColor(0, 0, 0);
    }
    doc.text(label, 12, y);
    const text = `${currency}${value.toFixed(2)}`;
    doc.text(text, pageWidth - 12, y, { align: 'right' });
    y += 6;
  };

  row('Expected cash (system)', shiftReport.expectedAmount);
  row('Counted cash (drawer)', shiftReport.actualAmount);

  const diff = shiftReport.difference;
  const isOver = diff > 0.0001;
  const isShort = diff < -0.0001;
  const diffColor: [number, number, number] | undefined = isOver
    ? [22, 163, 74] // green
    : isShort
    ? [239, 68, 68] // red
    : undefined;

  row(
    'Overage / Shortage',
    diff,
    true,
    diffColor,
  );

  const statusLabel =
    shiftReport.status === 'balanced'
      ? 'Balanced'
      : shiftReport.status === 'overage'
      ? 'Overage'
      : 'Shortage';

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.text(`Status: ${statusLabel}`, 12, y);
  y += 8;

  doc.setTextColor(0, 0, 0);
  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  // Digital sales summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Digital sales (card + mobile)', 12, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  row('Total digital takings', digitalTotal);

  if (typeof totalSales === 'number') {
    doc.setTextColor(0, 0, 0);
    y += 4;
    row('Total sales for day', totalSales);
  }

  doc.setTextColor(0, 0, 0);
  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  // Stock value
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Stock value on shelf', 12, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  row('Total cost value (buying price × stock)', stockValue);

  if (typeof newStockCost === 'number') {
    doc.setTextColor(0, 0, 0);
    y += 4;
    row('New stock received today (cost)', newStockCost);
  }

  doc.setTextColor(0, 0, 0);
  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  // Discrepancy note
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Reason for discrepancy', 12, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const note = (discrepancyNote || '').trim();
  if (!note) {
    doc.text('— (no note recorded)', 12, y);
    y += 6;
  } else {
    const maxWidth = pageWidth - 24;
    const lines = doc.splitTextToSize(note, maxWidth);
    doc.text(lines, 12, y);
    y += lines.length * 5 + 2;
  }

  y += 6;
  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  // Footer branding
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Powered by Mthunzi-Tech-Labs', pageWidth / 2, y, { align: 'center' });

  // Output file
  const filename = `Closing-Report-${dateStr.replace(/\//g, '-')}.pdf`;

  try {
    const blob = doc.output('blob') as Blob;
    return new File([blob], filename, { type: 'application/pdf' });
  } catch {
    const ab = doc.output('arraybuffer') as ArrayBuffer;
    return new File([ab], filename, { type: 'application/pdf' });
  }
}

export async function shareOrDownloadClosingReportPdf(args: {
  shiftReport: ShiftReport;
  stockValue: number;
  digitalTotal: number;
  totalSales?: number;
  newStockCost?: number;
  settings?: Settings | null;
  discrepancyNote?: string;
  preopenedWindow?: Window | null;
}): Promise<void> {
  const file = await generateClosingReportPdfFile(args);

  downloadBlob(file, file.name);
  if (args.preopenedWindow) {
    const navigated = setWindowToBlob(args.preopenedWindow, file);
    if (!navigated) {
      openBlobInNewTab(file);
    }
  } else {
    openBlobInNewTab(file);
  }
}

export async function shareClosingReportPdfToWhatsApp(args: {
  shiftReport: ShiftReport;
  stockValue: number;
  digitalTotal: number;
  totalSales?: number;
  newStockCost?: number;
  settings?: Settings | null;
  discrepancyNote?: string;
}): Promise<{ shared: boolean; reason?: 'unsupported' | 'cancelled' | 'error' }> {
  const file = await generateClosingReportPdfFile(args);
  const title = `Closing Report ${args.shiftReport.createdAt instanceof Date ? args.shiftReport.createdAt.toLocaleDateString() : new Date(String(args.shiftReport.createdAt)).toLocaleDateString()}`;
  const navAny = navigator as any;
  const canShareFile = Boolean(navAny?.canShare?.({ files: [file] }) && navigator.share);

  if (canShareFile) {
    try {
      await navigator.share({ title, files: [file] });
      return { shared: true };
    } catch (e: any) {
      const name = String(e?.name ?? '');
      if (name.toLowerCase().includes('abort')) return { shared: false, reason: 'cancelled' };
      return { shared: false, reason: 'error' };
    }
  }

  downloadBlob(file, file.name);
  const caption = `Closing Report: ${title}. If WhatsApp did not attach the PDF automatically, please attach the downloaded file: ${file.name}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(caption)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
  return { shared: false, reason: 'unsupported' };
}
