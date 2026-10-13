import type { DailyInventoryAudit, Settings } from '@/types/pos';

let jspdfModulePromise: Promise<{ jsPDF: any }> | null = null;

export function preloadAuditPdfDeps() {
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

function safeToInt(value: number | undefined): string {
  if (typeof value !== 'number' || isNaN(value)) {
    return '0';
  }
  return Math.round(value).toString();
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

export async function generateAuditPdfFile(args: {
  audit: DailyInventoryAudit;
  settings?: Settings | null;
}): Promise<File> {
  const { audit, settings } = args;
  const { jsPDF } = await (jspdfModulePromise ?? preloadAuditPdfDeps());

  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const shopName = settings?.shopName || 'Mthunzi Store';
  const currency = settings?.currencySymbol || 'K';

  let y = 15;

  // ===== HEADER =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(shopName, pageWidth / 2, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Daily Inventory Audit Report`, pageWidth / 2, y, { align: 'center' });
  y += 6;

  // ===== BASIC INFO =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Audit Information', 12, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Branch: ${audit.storeName}`, 12, y);
  y += 4;
  doc.text(`Date: ${audit.auditDate}`, 12, y);
  y += 4;
  doc.text(`Audited by: ${audit.auditedBy}`, 12, y);
  y += 4;
  if (audit.auditedByPhone) {
    doc.text(`Contact: ${audit.auditedByPhone}`, 12, y);
    y += 4;
  }

  y += 3;
  doc.line(12, y, pageWidth - 12, y);
  y += 6;

  // ===== KEY METRICS =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Financial Summary', 12, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const metrics = [
    { label: 'Opening Stock Value', value: `${currency}${safeToFixed(audit.openingStockValue)}` },
    { label: 'Closing Stock Value', value: `${currency}${safeToFixed(audit.closingStockValue)}` },
    { label: 'Sales Value', value: `${currency}${safeToFixed(audit.salesValue)}` },
    { label: 'Gross Profit', value: `${currency}${safeToFixed(audit.grossProfit)}` },
  ];

  metrics.forEach((metric) => {
    doc.text(`${metric.label}:`, 12, y);
    doc.text(metric.value, pageWidth - 30, y, { align: 'right' });
    y += 4;
  });

  y += 2;
  doc.line(12, y, pageWidth - 12, y);
  y += 6;

  // ===== INVENTORY METRICS =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Inventory Metrics', 12, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const inventoryMetrics = [
    { label: 'Products Sold', value: safeToInt(audit.productsSold) },
    { label: 'Stock Difference', value: safeToInt(audit.stockDifference) },
    { label: 'Inventory Accuracy', value: `${safeToFixed(audit.inventoryAccuracy, 1)}%` },
    { label: 'Missing Products', value: safeToInt(audit.missingProducts.length) },
    { label: 'Extra Products', value: safeToInt(audit.extraProducts.length) },
    { label: 'Out of Stock', value: safeToInt(audit.outOfStockProducts.length) },
  ];

  inventoryMetrics.forEach((metric) => {
    doc.text(`${metric.label}:`, 12, y);
    doc.text(metric.value, pageWidth - 30, y, { align: 'right' });
    y += 4;
  });

  y += 2;

  // Check if we need a new page
  if (y > pageHeight - 30) {
    doc.addPage();
    y = 15;
  }

  doc.line(12, y, pageWidth - 12, y);
  y += 6;

  // ===== DISCREPANCIES (if any) =====
  if (
    audit.missingProducts.length > 0 ||
    audit.extraProducts.length > 0 ||
    audit.outOfStockProducts.length > 0
  ) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Discrepancies & Alerts', 12, y);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    if (audit.missingProducts.length > 0) {
      doc.text(`Missing Products (${audit.missingProducts.length}):`, 12, y);
      y += 3;
      audit.missingProducts.slice(0, 5).forEach((productId) => {
        doc.text(`  • ${productId}`, 14, y);
        y += 3;
        if (y > pageHeight - 20) {
          doc.addPage();
          y = 15;
        }
      });
      if (audit.missingProducts.length > 5) {
        doc.text(`  ... and ${audit.missingProducts.length - 5} more`, 14, y);
        y += 3;
      }
      y += 2;
    }

    if (audit.extraProducts.length > 0) {
      doc.text(`Extra Products (${audit.extraProducts.length}):`, 12, y);
      y += 3;
      audit.extraProducts.slice(0, 5).forEach((productId) => {
        doc.text(`  • ${productId}`, 14, y);
        y += 3;
        if (y > pageHeight - 20) {
          doc.addPage();
          y = 15;
        }
      });
      if (audit.extraProducts.length > 5) {
        doc.text(`  ... and ${audit.extraProducts.length - 5} more`, 14, y);
        y += 3;
      }
      y += 2;
    }

    if (audit.outOfStockProducts.length > 0) {
      doc.text(`Out of Stock (${audit.outOfStockProducts.length}):`, 12, y);
      y += 3;
      audit.outOfStockProducts.slice(0, 5).forEach((productId) => {
        doc.text(`  • ${productId}`, 14, y);
        y += 3;
        if (y > pageHeight - 20) {
          doc.addPage();
          y = 15;
        }
      });
      if (audit.outOfStockProducts.length > 5) {
        doc.text(`  ... and ${audit.outOfStockProducts.length - 5} more`, 14, y);
        y += 3;
      }
      y += 2;
    }
  }

  y += 5;
  doc.line(12, y, pageWidth - 12, y);
  y += 6;

  // ===== FOOTER =====
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Status: ✅ Inventory Completed', 12, y);
  y += 4;
  doc.text('Prepared by: Mthunzi POS', 12, y);
  y += 4;
  doc.text(`Generated: ${new Date().toLocaleString()}`, 12, y);

  // Convert to File
  const pdfBlob = doc.output('blob') as Blob;
  const fileName = `Audit_${audit.auditDate}_${audit.storeName.replace(/\s+/g, '_')}.pdf`;
  return new File([pdfBlob], fileName, { type: 'application/pdf' });
}

export async function shareAuditPdfToWhatsApp(args: {
  audit: DailyInventoryAudit;
  settings?: Settings | null;
}): Promise<{ shared: boolean; reason?: 'unsupported' | 'cancelled' | 'error' }> {
  const file = await generateAuditPdfFile(args);
  const title = `Daily Audit - ${args.audit.auditDate}`;

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

  // Fallback: download PDF and open WhatsApp
  downloadBlob(file, file.name);
  openBlobInNewTab(file);

  const caption = `Daily Inventory Audit Report\n📅 Date: ${args.audit.auditDate}\n🏪 Store: ${args.audit.storeName}\n\nPlease find the detailed PDF report attached.`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(caption)}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');

  return { shared: false, reason: 'unsupported' };
}

export async function downloadAuditPdf(args: {
  audit: DailyInventoryAudit;
  settings?: Settings | null;
}): Promise<void> {
  const file = await generateAuditPdfFile(args);
  downloadBlob(file, file.name);
}
