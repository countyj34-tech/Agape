import type { DailySummary, Settings } from '@/types/pos';

let jspdfModulePromise: Promise<{ jsPDF: any }> | null = null;

export function preloadEodPdfDeps() {
  if (!jspdfModulePromise) {
    jspdfModulePromise = import('jspdf') as Promise<{ jsPDF: any }>;
  }
  return jspdfModulePromise;
}

function safeToFixed(value: number, decimals: number = 2): string {
  if (typeof value !== 'number' || isNaN(value)) {
    return '0.00';
  }
  return value.toFixed(decimals);
}

function openBlobInNewTab(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');

  // Give the new tab enough time to load before revoking.
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
export async function generateEodPdfFile(args: {
  summary: DailySummary;
  settings?: Settings | null;
}): Promise<File> {
  const { summary, settings } = args;
  const { jsPDF } = await (jspdfModulePromise ?? preloadEodPdfDeps());

  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const shopName = settings?.shopName || 'Mthunzi Store';
  const currency = settings?.currencySymbol || 'K';

  let y = 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(shopName, pageWidth / 2, y, { align: 'center' });
  y += 7;

  // Optional branch/store name (for multi-store setups)
  if (summary.storeName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(`Store: ${summary.storeName}`, pageWidth / 2, y, { align: 'center' });
    y += 5;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`End-of-Day Summary`, pageWidth / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(10);
  const dateText = String(summary.date ?? '');
  if (dateText.includes('..')) {
    const [from, to] = dateText.split('..');
    doc.text(`Range: ${from} to ${to}`, pageWidth / 2, y, { align: 'center' });
  } else {
    doc.text(`Date: ${dateText}`, pageWidth / 2, y, { align: 'center' });
  }
  y += 10;

  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Totals', 12, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Total revenue: ${currency}${safeToFixed(summary.totalRevenue)}`, 12, y);
  y += 6;
  doc.text(`Total profit: ${currency}${safeToFixed(summary.totalProfit)}`, 12, y);
  y += 6;
  doc.text(`Transactions: ${summary.transactionCount}`, 12, y);
  y += 10;

  const hasReconciliation =
    typeof summary.cashIn === 'number' ||
    typeof summary.cardIn === 'number' ||    typeof summary.transferIn === 'number' ||    typeof summary.mobileInTotal === 'number' ||
    typeof summary.creditIssued === 'number' ||
    typeof summary.expensesTotal === 'number' ||
    typeof summary.netProfitAfterExpenses === 'number';

  if (hasReconciliation) {
    doc.line(12, y, pageWidth - 12, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Reconciliation', 12, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);

    const line = (label: string, value?: number) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      doc.text(`${label}: ${currency}${safeToFixed(value)}`, 12, y);
      y += 6;
    };

    line('Cash in', summary.cashIn);
    line('Card in', summary.cardIn);
    line('Bank transfer', summary.transferIn);
    line('Mobile in', summary.mobileInTotal);

    const mobileBy = summary.mobileInByProvider ?? undefined;
    if (mobileBy) {
      const keys: Array<'mtn' | 'airtel' | 'zamtel' | 'other'> = ['mtn', 'airtel', 'zamtel', 'other'];
      for (const k of keys) {
        const v = mobileBy[k];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          doc.setFontSize(10);
          doc.text(`  ${k.toUpperCase()}: ${currency}${safeToFixed(v)}`, 14, y);
          y += 5;
          doc.setFontSize(11);
        }
      }
    }
    line('Credit issued', summary.creditIssued);
    line('Credit payments', summary.creditPayments);
    line('Expenses', summary.expensesTotal);

    const expBy = summary.expensesMobileBySource ?? undefined;
    if (expBy) {
      const keys: Array<'mtn' | 'airtel' | 'zamtel' | 'other'> = ['mtn', 'airtel', 'zamtel', 'other'];
      for (const k of keys) {
        const v = expBy[k];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          doc.setFontSize(10);
          doc.text(`  ${k.toUpperCase()} exp: ${currency}${safeToFixed(v)}`, 14, y);
          y += 5;
          doc.setFontSize(11);
        }
      }
    }
    line('Net profit (after expenses)', summary.netProfitAfterExpenses);
    y += 4;
  }

  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Sold items', 12, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  if (summary.topSellers.length === 0) {
    doc.text('No sales.', 12, y);
    y += 6;
  } else {
    for (const s of summary.topSellers) {
      const avgPrice = s.quantitySold > 0 ? s.revenue / s.quantitySold : 0;
      const base = `${s.productName} (x${s.quantitySold}) @ ${currency}${safeToFixed(avgPrice)}`;
      const left =
        typeof s.remainingStock === 'number'
          ? `${base} · ${s.remainingStock} left`
          : base;
      const right = `${currency}${safeToFixed(s.revenue)}`;
      doc.text(left, 12, y);
      doc.text(right, pageWidth - 12, y, { align: 'right' });
      y += 5;
      if (y > 270) {
        doc.addPage();
        y = 18;
      }
    }
  }

  y += 6;
  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Low stock items', 12, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  if (summary.lowStockItems.length === 0) {
    doc.text('None.', 12, y);
    y += 6;
  } else {
    for (const p of summary.lowStockItems.slice(0, 20)) {
      const left = `${p.productName}`;
      const right = `${p.currentStock} left (threshold ${p.threshold})`;
      doc.text(left, 12, y);
      doc.text(right, pageWidth - 12, y, { align: 'right' });
      y += 5;
      if (y > 270) {
        doc.addPage();
        y = 18;
      }
    }
  }

  y += 6;
  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Current stock (all products)', 12, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const snapshot = summary.inventorySnapshot ?? [];
  if (snapshot.length === 0) {
    doc.text('Not available.', 12, y);
    y += 6;
  } else {
    for (const p of snapshot) {
      const left = `${p.productName}`;
      const right = `${p.currentStock} left`;
      doc.text(left, 12, y);
      doc.text(right, pageWidth - 12, y, { align: 'right' });
      y += 5;
      if (y > 270) {
        doc.addPage();
        y = 18;
      }
    }
  }

  // Prefer blob output where supported
  try {
    const blob = doc.output('blob') as Blob;
    const filename = dateText.includes('..')
      ? (() => {
          const [from, to] = dateText.split('..');
          return `EOD-${from}-to-${to}.pdf`;
        })()
      : `EOD-${dateText}.pdf`;
    return new File([blob], filename, { type: 'application/pdf' });
  } catch {
    const ab = doc.output('arraybuffer') as ArrayBuffer;
    const filename = dateText.includes('..')
      ? (() => {
          const [from, to] = dateText.split('..');
          return `EOD-${from}-to-${to}.pdf`;
        })()
      : `EOD-${dateText}.pdf`;
    return new File([ab], filename, { type: 'application/pdf' });
  }
}

export async function shareOrDownloadEodPdf(args: {
  summary: DailySummary;
  settings?: Settings | null;
  preopenedWindow?: Window | null;
}): Promise<void> {
  const file = await generateEodPdfFile(args);

  // Export: download AND open the PDF immediately (best-effort).
  // If popups are blocked, the download will still happen.
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

export async function shareEodPdfToWhatsApp(args: {
  summary: DailySummary;
  settings?: Settings | null;
}): Promise<{ shared: boolean; reason?: 'unsupported' | 'cancelled' | 'error' }> {
  const file = await generateEodPdfFile(args);
  const title = `EOD ${String(args.summary.date ?? '')}`;

  const navAny = navigator as any;
  const canShareFile = Boolean(navAny?.canShare?.({ files: [file] }) && navigator.share);

  if (canShareFile) {
    try {
      // On most Android devices this opens the native share sheet where WhatsApp
      // can be selected and the PDF is attached.
      await navigator.share({ title, files: [file] });
      return { shared: true };
    } catch (e: any) {
      // AbortError is the common “user cancelled” case.
      const name = String(e?.name ?? '');
      if (name.toLowerCase().includes('abort')) return { shared: false, reason: 'cancelled' };
      return { shared: false, reason: 'error' };
    }
  }

  // Fallback: we can't attach files directly to WhatsApp from the browser.
  // Best effort: download + open the PDF, then open WhatsApp with a caption.
  downloadBlob(file, file.name);
  openBlobInNewTab(file);

  const caption = `EOD Report (PDF): ${args.summary.date}. If WhatsApp did not open with the PDF attached, please attach the downloaded PDF file: ${file.name}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(caption)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');

  return { shared: false, reason: 'unsupported' };
}
