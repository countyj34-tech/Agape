import type { Settings } from '@/types/pos';

export type ReorderLine = {
  productId: string;
  productName: string;
  currentStock: number;
  threshold: number;
  suggestedReorderQty: number;
};

let jspdfModulePromise: Promise<{ jsPDF: any }> | null = null;

export function preloadReorderPdfDeps() {
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

function localDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildReorderLines(args: {
  productLines: Array<{ id: string; name: string; stock: number; lowStockThreshold: number }>;
  targetMultiplier?: number;
}): ReorderLine[] {
  const multiplier = Math.max(1, Math.floor(args.targetMultiplier ?? 2));

  return (args.productLines ?? [])
    .filter((p) => (p.stock ?? 0) <= (p.lowStockThreshold ?? 0))
    .map((p) => {
      const currentStock = Number(p.stock ?? 0);
      const threshold = Number(p.lowStockThreshold ?? 0);
      const targetStock = Math.max(threshold, threshold * multiplier);
      const suggestedReorderQty = Math.max(0, targetStock - currentStock);
      return {
        productId: p.id,
        productName: p.name,
        currentStock,
        threshold,
        suggestedReorderQty,
      };
    })
    .sort((a, b) => (b.suggestedReorderQty - a.suggestedReorderQty) || a.productName.localeCompare(b.productName));
}

export async function generateReorderPdfFile(args: {
  title?: string;
  lines: ReorderLine[];
  settings?: Settings | null;
  date?: Date;
}): Promise<File> {
  const { jsPDF } = await (jspdfModulePromise ?? preloadReorderPdfDeps());

  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const pageWidth = doc.internal.pageSize.getWidth();

  const shopName = args.settings?.shopName || 'Mthunzi Store';
  const dateKey = localDateKey(args.date ?? new Date());
  const title = args.title ?? 'Low-stock Reorder List';

  const lines = args.lines ?? [];

  let y = 18;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(shopName, pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(title, pageWidth / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(10);
  doc.text(`Date: ${dateKey}`, pageWidth / 2, y, { align: 'center' });
  y += 10;

  doc.line(12, y, pageWidth - 12, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Item', 12, y);
  doc.text('Stock', pageWidth - 60, y, { align: 'right' });
  doc.text('Threshold', pageWidth - 35, y, { align: 'right' });
  doc.text('Order', pageWidth - 12, y, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  if (lines.length === 0) {
    doc.text('No low-stock items.', 12, y);
    y += 6;
  } else {
    for (const l of lines) {
      doc.text(String(l.productName), 12, y);
      doc.text(String(l.currentStock), pageWidth - 60, y, { align: 'right' });
      doc.text(String(l.threshold), pageWidth - 35, y, { align: 'right' });
      doc.text(String(l.suggestedReorderQty), pageWidth - 12, y, { align: 'right' });
      y += 5;
      if (y > 270) {
        doc.addPage();
        y = 18;
      }
    }
  }

  const filename = `Reorder-${dateKey}.pdf`;

  try {
    const blob = doc.output('blob') as Blob;
    return new File([blob], filename, { type: 'application/pdf' });
  } catch {
    const ab = doc.output('arraybuffer') as ArrayBuffer;
    return new File([ab], filename, { type: 'application/pdf' });
  }
}

export async function shareOrDownloadReorderPdf(args: {
  title?: string;
  lines: ReorderLine[];
  settings?: Settings | null;
  preopenedWindow?: Window | null;
}): Promise<void> {
  const file = await generateReorderPdfFile(args);
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

export async function shareReorderPdf(args: {
  title?: string;
  lines: ReorderLine[];
  settings?: Settings | null;
}): Promise<{ shared: boolean; reason?: 'unsupported' | 'cancelled' | 'error' }> {
  const file = await generateReorderPdfFile(args);
  const title = args.title ?? 'Reorder List';

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
