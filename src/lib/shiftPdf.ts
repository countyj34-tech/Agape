import type { Sale, Settings, Shift } from '@/types/pos';

let jspdfModulePromise: Promise<{ jsPDF: any }> | null = null;

export function preloadShiftPdfDeps() {
  if (!jspdfModulePromise) {
    jspdfModulePromise = import('jspdf') as Promise<{ jsPDF: any }>;
  }
  return jspdfModulePromise;
}

function openBlobInNewTab(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Boolean(win);
}

function setWindowToBlob(win: Window, blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  try {
    win.location.href = url;
    return true;
  } catch {
    try {
      win.close();
    } catch {
      // ignore
    }
    return false;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
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

function formatDateTime(d?: Date) {
  if (!d) return '';
  const date = d.toLocaleDateString([], { year: 'numeric', month: 'short', day: '2-digit' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

export async function generateShiftPdfFile(args: {
  shift: Shift;
  sales: Sale[];
  settings?: Settings | null;
}): Promise<File> {
  const { jsPDF } = await (jspdfModulePromise ?? preloadShiftPdfDeps());

  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const shopName = args.settings?.shopName || 'Mthunzi Store';
  const currency = args.settings?.currencySymbol || 'K';

  const sales = args.sales ?? [];
  const totalRevenue = sales.reduce((sum, s) => sum + (s.total ?? 0), 0);
  const totalProfit = sales.reduce((sum, s) => sum + (s.profit ?? 0), 0);

  let y = 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(shopName, pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Cashier Shift Report', pageWidth / 2, y, { align: 'center' });
  y += 10;

  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Shift details', 12, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Cashier: ${args.shift.cashierName}`, 12, y);
  y += 6;
  doc.text(`Start: ${formatDateTime(args.shift.startedAt)}`, 12, y);
  y += 6;
  doc.text(`End: ${args.shift.endedAt ? formatDateTime(args.shift.endedAt) : 'Still open'}`, 12, y);
  y += 6;

  if (typeof args.shift.openingCash === 'number') {
    doc.text(`Opening cash: ${currency}${args.shift.openingCash.toFixed(2)}`, 12, y);
    y += 6;
  }
  if (typeof args.shift.closingCash === 'number') {
    doc.text(`Closing cash: ${currency}${args.shift.closingCash.toFixed(2)}`, 12, y);
    y += 6;
  }

  y += 4;
  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Totals', 12, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Transactions: ${sales.length}`, 12, y);
  y += 6;
  doc.text(`Revenue: ${currency}${totalRevenue.toFixed(2)}`, 12, y);
  y += 6;
  doc.text(`Profit: ${currency}${totalProfit.toFixed(2)}`, 12, y);
  y += 10;

  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Transactions', 12, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  if (sales.length === 0) {
    doc.text('No sales recorded for this shift.', 12, y);
    y += 6;
  } else {
    const lines = [...sales]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 40);

    for (const s of lines) {
      const time = formatDateTime(new Date(s.createdAt));
      const left = `${time}  ${String(s.receiptNumber ?? s.id).slice(0, 24)}`;
      const right = `${currency}${(s.total ?? 0).toFixed(2)}`;
      doc.text(left, 12, y);
      doc.text(right, pageWidth - 12, y, { align: 'right' });
      y += 5;
      if (y > 270) {
        doc.addPage();
        y = 18;
      }
    }

    if (sales.length > lines.length) {
      doc.text(`...and ${sales.length - lines.length} more`, 12, y);
      y += 6;
    }
  }

  const filename = `Shift-${args.shift.cashierName}-${String(args.shift.startedAt.toISOString().slice(0, 10))}.pdf`
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-_.]/g, '');

  try {
    const blob = doc.output('blob') as Blob;
    return new File([blob], filename, { type: 'application/pdf' });
  } catch {
    const ab = doc.output('arraybuffer') as ArrayBuffer;
    return new File([ab], filename, { type: 'application/pdf' });
  }
}

export async function shareOrDownloadShiftPdf(args: {
  shift: Shift;
  sales: Sale[];
  settings?: Settings | null;
  preopenedWindow?: Window | null;
}): Promise<void> {
  const file = await generateShiftPdfFile(args);
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

export async function shareShiftPdf(args: {
  shift: Shift;
  sales: Sale[];
  settings?: Settings | null;
}): Promise<{ shared: boolean; reason?: 'unsupported' | 'cancelled' | 'error' }> {
  const file = await generateShiftPdfFile(args);
  const title = `Shift Report (${args.shift.cashierName})`;

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
  openBlobInNewTab(file);

  return { shared: false, reason: 'unsupported' };
}
