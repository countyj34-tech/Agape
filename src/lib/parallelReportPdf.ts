// PDF generation for Mthunzi Parallel reports
import type { ParallelReport, ParallelBusiness, ParallelBranch } from '@/types/pos';

let jspdfModulePromise: Promise<{ jsPDF: any }> | null = null;

export function preloadParallelPdfDeps() {
  if (!jspdfModulePromise) {
    jspdfModulePromise = import('jspdf') as Promise<{ jsPDF: any }>;
  }
  return jspdfModulePromise;
}

function safeToFixed(value: number | undefined, decimals: number = 2): string {
  if (typeof value !== 'number' || isNaN(value)) {
    return '0.00';
  }
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

export async function generateParallelReportPDF(args: {
  report: ParallelReport;
  business: ParallelBusiness;
  branch: ParallelBranch;
}): Promise<Blob> {
  const { report, business, branch } = args;
  const { jsPDF } = await (jspdfModulePromise ?? preloadParallelPdfDeps());

  const doc = new jsPDF({ format: 'a4', unit: 'mm' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;

  let y = margin;

  // ===== HEADER =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(34, 197, 94); // Green color
  doc.text('Mthunzi Parallel', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text('Inventory Intelligence Report', pageWidth / 2, y, { align: 'center' });
  y += 2;
  doc.setFontSize(9);
  doc.text('Professional Stock Analysis & Recommendations', pageWidth / 2, y, { align: 'center' });
  y += 10;

  // ===== BUSINESS INFO =====
  doc.setFillColor(240, 253, 244);
  doc.rect(margin, y - 2, contentWidth, 22, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(34, 197, 94);
  doc.text(business.name, margin + 5, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  doc.text(`Branch: ${branch.name}`, margin + 5, y);
  y += 5;
  doc.text(`Report Date: ${report.reportDate}`, margin + 5, y);
  y += 10;

  // ===== KEY METRICS - TOP ROW =====
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(34, 197, 94);
  doc.text('Key Metrics', margin, y);
  y += 7;

  const metricBoxWidth = (contentWidth - 8) / 3;
  const boxHeight = 16;
  const metricsY = y;

  // Metric boxes
  const metrics = [
    { label: 'Opening Stock', value: `${business.currencySymbol}${safeToFixed(report.openingStockValue)}` },
    { label: 'Closing Stock', value: `${business.currencySymbol}${safeToFixed(report.closingStockValue)}` },
    { label: 'Sales Value', value: `${business.currencySymbol}${safeToFixed(report.salesValue)}` },
  ];

  metrics.forEach((metric, idx) => {
    const boxX = margin + idx * (metricBoxWidth + 4);
    doc.setFillColor(229, 231, 235);
    doc.rect(boxX, metricsY, metricBoxWidth, boxHeight, 'F');
    doc.setDrawColor(209, 213, 219);
    doc.rect(boxX, metricsY, metricBoxWidth, boxHeight);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(metric.label, boxX + metricBoxWidth / 2, metricsY + 4, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(34, 197, 94);
    doc.text(metric.value, boxX + metricBoxWidth / 2, metricsY + 11, { align: 'center' });
  });

  y = metricsY + boxHeight + 8;

  // ===== PERFORMANCE SECTION =====
  const perfBoxes = [
    { label: 'Gross Profit', value: `${business.currencySymbol}${safeToFixed(report.grossProfit)}` },
    { label: 'Products Sold', value: `${report.productsSold} items` },
    { label: 'Inventory Accuracy', value: `${safeToFixed(report.inventoryAccuracy, 1)}%` },
  ];

  perfBoxes.forEach((perf, idx) => {
    const boxX = margin + idx * (metricBoxWidth + 4);
    doc.setFillColor(240, 253, 244);
    doc.rect(boxX, y, metricBoxWidth, boxHeight, 'F');
    doc.setDrawColor(34, 197, 94);
    doc.setLineWidth(0.5);
    doc.rect(boxX, y, metricBoxWidth, boxHeight);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(perf.label, boxX + metricBoxWidth / 2, y + 4, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(34, 197, 94);
    doc.text(perf.value, boxX + metricBoxWidth / 2, y + 11, { align: 'center' });
  });

  y += boxHeight + 8;

  // ===== TOP SELLING PRODUCTS =====
  if (report.topSellingProducts && report.topSellingProducts.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(34, 197, 94);
    doc.text('Top Selling Products', margin, y);
    y += 6;

    const tableTop = y;
    const topItems = report.topSellingProducts.slice(0, 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.setFillColor(34, 197, 94);
    doc.rect(margin, tableTop - 1, contentWidth, 5, 'F');
    doc.text('Product', margin + 2, tableTop + 2);
    doc.text('Qty Sold', margin + 90, tableTop + 2);
    doc.text('Total Value', margin + 130, tableTop + 2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);

    let tableY = tableTop + 6;
    topItems.forEach((item, idx) => {
      if (tableY > pageHeight - 15) {
        doc.addPage();
        tableY = margin;
      }

      if (idx % 2 === 0) {
        doc.setFillColor(245, 245, 245);
        doc.rect(margin, tableY - 2, contentWidth, 5, 'F');
      }

      doc.text(item.productName.substring(0, 40), margin + 2, tableY);
      doc.text(String(item.quantity), margin + 95, tableY);
      doc.text(`${business.currencySymbol}${safeToFixed(item.totalValue)}`, margin + 130, tableY);
      tableY += 5;
    });

    y = tableY + 3;
  }

  // ===== INVENTORY STATUS =====
  if (
    (report.outOfStockProducts && report.outOfStockProducts.length > 0) ||
    (report.lowStockProducts && report.lowStockProducts.length > 0) ||
    (report.missingProducts && report.missingProducts.length > 0)
  ) {
    if (y > pageHeight - 40) {
      doc.addPage();
      y = margin;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(239, 68, 68); // Red for issues
    doc.text('Inventory Issues', margin, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);

    if (report.outOfStockProducts && report.outOfStockProducts.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(239, 68, 68);
      doc.text(`Out of Stock (${report.outOfStockProducts.length}):`, margin, y);
      y += 4;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const outOfStockText = report.outOfStockProducts.slice(0, 3).map((p) => p.productName).join(', ');
      const splitText = doc.splitTextToSize(outOfStockText, contentWidth - 5);
      doc.text(splitText, margin + 5, y);
      y += splitText.length * 3 + 2;
    }

    if (report.lowStockProducts && report.lowStockProducts.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(245, 158, 11); // Orange for warnings
      doc.text(`Low Stock (${report.lowStockProducts.length}):`, margin, y);
      y += 4;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const lowStockText = report.lowStockProducts.slice(0, 3).map((p) => p.productName).join(', ');
      const splitText = doc.splitTextToSize(lowStockText, contentWidth - 5);
      doc.text(splitText, margin + 5, y);
      y += splitText.length * 3 + 2;
    }

    if (report.missingProducts && report.missingProducts.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(239, 68, 68);
      doc.text(`Missing Products (${report.missingProducts.length}):`, margin, y);
      y += 4;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const missingText = report.missingProducts.slice(0, 5).join(', ');
      const splitText = doc.splitTextToSize(missingText, contentWidth - 5);
      doc.text(splitText, margin + 5, y);
      y += splitText.length * 3 + 2;
    }
  }

  // ===== RECOMMENDATIONS =====
  if (report.recommendations && report.recommendations.length > 0) {
    if (y > pageHeight - 40) {
      doc.addPage();
      y = margin;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(59, 130, 246); // Blue
    doc.text('Recommendations', margin, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);

    report.recommendations.slice(0, 5).forEach((rec) => {
      const splitText = doc.splitTextToSize(`• ${rec}`, contentWidth - 5);
      doc.text(splitText, margin + 5, y);
      y += splitText.length * 3 + 1;
    });
  }

  // ===== FOOTER =====
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);

  const footerY = pageHeight - 10;
  doc.text('Prepared by Mthunzi-Tech-Labs', pageWidth / 2, footerY, { align: 'center' });
  if (report.approvedAt) {
    doc.text(`Approved: ${new Date(report.approvedAt).toLocaleDateString()}`, pageWidth / 2, footerY + 4, { align: 'center' });
  }

  return doc.output('blob') as Blob;
}

export async function downloadParallelReportPDF(args: {
  report: ParallelReport;
  business: ParallelBusiness;
  branch: ParallelBranch;
}): Promise<void> {
  const blob = await generateParallelReportPDF(args);
  const fileName = `Parallel-Report-${args.report.reportDate}-${args.branch.name.replace(/\s+/g, '-')}.pdf`;
  downloadBlob(blob, fileName);
}
