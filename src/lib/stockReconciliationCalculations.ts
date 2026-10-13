import type { Product, StockReconciliationLineItem, StockReconciliationOcrRow, StockReconciliationSession } from '@/types/pos';
import {
  aggregateOcrRows,
  clusterOcrRowNames,
  findMatchingOcrRow,
  matchProductByName,
} from '@/lib/stockReconciliationMatching';
import { cleanOcrProductName, isLikelyValidStockRow } from '@/lib/stockReconciliationClean';

export function calculateQuantitySold(
  opening: number,
  closing: number,
  refill: number
): number {
  return Math.max(0, opening + refill - closing);
}

export function buildExtractionPreview(args: {
  openingRows: StockReconciliationOcrRow[];
  closingRows: StockReconciliationOcrRow[];
  refillRows: StockReconciliationOcrRow[];
  combinedRows?: StockReconciliationOcrRow[];
}): StockReconciliationOcrRow[] {
  const opening = clusterOcrRowNames(aggregateOcrRows(args.openingRows));
  const closing = clusterOcrRowNames(aggregateOcrRows(args.closingRows));
  const refill = clusterOcrRowNames(aggregateOcrRows(args.refillRows));
  const combined = clusterOcrRowNames(aggregateOcrRows(args.combinedRows ?? []));

  const nameSet = new Set<string>();
  for (const row of [...opening, ...closing, ...refill, ...combined]) {
    if (row.rawName.trim()) nameSet.add(row.rawName);
  }

  const preview: StockReconciliationOcrRow[] = [];
  for (const displayName of nameSet) {
    const openingRow = findMatchingOcrRow(displayName, opening);
    const closingRow = findMatchingOcrRow(displayName, closing);
    const refillRow = findMatchingOcrRow(displayName, refill);
    const combinedRow = findMatchingOcrRow(displayName, combined);

    const openingStock =
      combinedRow?.opening ?? combinedRow?.quantity ?? openingRow?.quantity ?? 0;
    const closingStock = combinedRow?.closing ?? closingRow?.quantity ?? 0;
    const refillStock = combinedRow?.refill ?? refillRow?.quantity ?? 0;

    const cleanName = cleanOcrProductName(displayName);
    if (!cleanName) continue;

    preview.push({
      rawName: cleanName,
      quantity: openingStock,
      opening: openingStock,
      closing: closingStock,
      refill: refillStock,
      unitPrice: openingRow?.unitPrice ?? closingRow?.unitPrice ?? combinedRow?.unitPrice,
    });
  }

  // Re-merge after cleaning (e.g. "/Castle Lite" and "Castle Lite" → one row)
  const merged = new Map<string, StockReconciliationOcrRow>();
  for (const row of preview) {
    const key = row.rawName.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      continue;
    }
    existing.opening = Math.max(existing.opening ?? 0, row.opening ?? 0);
    existing.closing = Math.max(existing.closing ?? 0, row.closing ?? 0);
    existing.refill = Math.max(existing.refill ?? 0, row.refill ?? 0);
    existing.quantity = Math.max(existing.quantity, row.quantity);
  }

  return Array.from(merged.values())
    .filter(isLikelyValidStockRow)
    .sort((a, b) => a.rawName.localeCompare(b.rawName));
}

export function buildReconciliationLineItems(args: {
  openingRows: StockReconciliationOcrRow[];
  closingRows: StockReconciliationOcrRow[];
  refillRows: StockReconciliationOcrRow[];
  products: Product[];
  /** Rows from combined sheets that already include opening/closing/refill */
  combinedRows?: StockReconciliationOcrRow[];
  /** After human review of extraction PDF / table */
  previewRows?: StockReconciliationOcrRow[];
}): StockReconciliationLineItem[] {
  if (args.previewRows?.length) {
    const lineItems: StockReconciliationLineItem[] = [];
    for (const row of args.previewRows) {
      const displayName = cleanOcrProductName(row.rawName);
      if (!displayName) continue;
      const openingStock = row.opening ?? row.quantity ?? 0;
      const closingStock = row.closing ?? 0;
      const refillStock = row.refill ?? 0;
      const quantitySold = calculateQuantitySold(openingStock, closingStock, refillStock);

      const matchedProduct = matchProductByName(displayName, args.products);
      const unitPrice = matchedProduct?.sellingPrice ?? row.unitPrice ?? 0;
      const buyingPrice = matchedProduct?.buyingPrice ?? 0;
      const revenue = quantitySold * unitPrice;
      const estimatedProfit = quantitySold * Math.max(0, unitPrice - buyingPrice);

      const issues: string[] = [];
      if (!matchedProduct) issues.push('Product not matched to POS database');
      if (openingStock + refillStock < closingStock) {
        issues.push('Closing stock exceeds opening + refill');
      }

      let status: StockReconciliationLineItem['status'] = 'matched';
      if (!matchedProduct) status = 'unmatched';
      if (issues.length > 0 && matchedProduct) status = 'error';

      lineItems.push({
        id: crypto.randomUUID(),
        productId: matchedProduct?.id,
        productName: matchedProduct?.name ?? displayName,
        rawName: displayName,
        openingStock,
        closingStock,
        refillStock,
        quantitySold,
        unitPrice,
        ocrUnitPrice: row.unitPrice,
        revenue,
        estimatedProfit,
        status,
        issues: issues.length > 0 ? issues : undefined,
      });
    }
    return lineItems.sort((a, b) => a.productName.localeCompare(b.productName));
  }

  const opening = clusterOcrRowNames(aggregateOcrRows(args.openingRows));
  const closing = clusterOcrRowNames(aggregateOcrRows(args.closingRows));
  const refill = clusterOcrRowNames(aggregateOcrRows(args.refillRows));
  const combined = clusterOcrRowNames(aggregateOcrRows(args.combinedRows ?? []));

  const nameSet = new Set<string>();
  for (const row of [...opening, ...closing, ...refill, ...combined]) {
    nameSet.add(row.rawName);
  }

  const lineItems: StockReconciliationLineItem[] = [];

  for (const displayName of nameSet) {
    if (!isLikelyValidStockRow({ rawName: displayName, quantity: 1 })) continue;

    const openingRow = findMatchingOcrRow(displayName, opening);
    const closingRow = findMatchingOcrRow(displayName, closing);
    const refillRow = findMatchingOcrRow(displayName, refill);
    const combinedRow = findMatchingOcrRow(displayName, combined);

    const openingStock =
      combinedRow?.opening ??
      combinedRow?.quantity ??
      openingRow?.quantity ??
      0;
    const closingStock = combinedRow?.closing ?? closingRow?.quantity ?? 0;
    const refillStock = combinedRow?.refill ?? refillRow?.quantity ?? 0;
    const quantitySold = calculateQuantitySold(openingStock, closingStock, refillStock);

    const matchedProduct = matchProductByName(displayName, args.products);
    const unitPrice =
      matchedProduct?.sellingPrice ??
      openingRow?.unitPrice ??
      closingRow?.unitPrice ??
      combinedRow?.unitPrice ??
      0;
    const buyingPrice = matchedProduct?.buyingPrice ?? 0;
    const revenue = quantitySold * unitPrice;
    const estimatedProfit = quantitySold * Math.max(0, unitPrice - buyingPrice);

    const issues: string[] = [];
    if (!matchedProduct) issues.push('Product not matched to POS database');
    if (openingStock === 0 && closingStock === 0 && refillStock === 0) {
      issues.push('All stock values are zero');
    }
    if (openingStock + refillStock < closingStock) {
      issues.push('Closing stock exceeds opening + refill');
    }

    let status: StockReconciliationLineItem['status'] = 'matched';
    if (!matchedProduct) status = 'unmatched';
    if (issues.length > 0 && matchedProduct) status = 'error';

    lineItems.push({
      id: crypto.randomUUID(),
      productId: matchedProduct?.id,
      productName: matchedProduct?.name ?? displayName,
      rawName: displayName,
      openingStock,
      closingStock,
      refillStock,
      quantitySold,
      unitPrice,
      ocrUnitPrice: openingRow?.unitPrice ?? closingRow?.unitPrice ?? combinedRow?.unitPrice,
      revenue,
      estimatedProfit,
      status,
      issues: issues.length > 0 ? issues : undefined,
    });
  }

  return lineItems.sort((a, b) => a.productName.localeCompare(b.productName));
}

export function summarizeReconciliationSession(
  session: Pick<StockReconciliationSession, 'lineItems' | 'ocrResults'>,
  products: Product[]
): Pick<
  StockReconciliationSession,
  | 'openingStockSummary'
  | 'closingStockSummary'
  | 'refillSummary'
  | 'productsSold'
  | 'quantitySold'
  | 'revenue'
  | 'estimatedProfit'
  | 'lowStockItems'
  | 'unmatchedItems'
  | 'dataErrors'
> {
  const lineItems = session.lineItems;

  const openingStockSummary = {
    itemCount: session.ocrResults?.opening.length ?? 0,
    totalValue: lineItems.reduce((sum, item) => sum + item.openingStock * item.unitPrice, 0),
  };

  const closingStockSummary = {
    itemCount: session.ocrResults?.closing.length ?? 0,
    totalValue: lineItems.reduce((sum, item) => sum + item.closingStock * item.unitPrice, 0),
  };

  const refillSummary = {
    itemCount: session.ocrResults?.refill.length ?? 0,
    totalQuantity: lineItems.reduce((sum, item) => sum + item.refillStock, 0),
  };

  const productsSold = lineItems.filter((item) => item.quantitySold > 0).length;
  const quantitySold = lineItems.reduce((sum, item) => sum + item.quantitySold, 0);
  const revenue = lineItems.reduce((sum, item) => sum + item.revenue, 0);
  const estimatedProfit = lineItems.reduce((sum, item) => sum + item.estimatedProfit, 0);

  const lowStockItems = lineItems
    .filter((item) => item.productId && item.closingStock > 0)
    .map((item) => {
      const product = products.find((p) => p.id === item.productId);
      const threshold = product?.lowStockThreshold ?? 5;
      return { item, threshold };
    })
    .filter(({ item, threshold }) => item.closingStock <= threshold)
    .map(({ item }) => ({
      productId: item.productId!,
      productName: item.productName,
      quantity: item.closingStock,
    }));

  const unmatchedItems = lineItems
    .filter((item) => item.status === 'unmatched')
    .map((item) => item.rawName);

  const dataErrors = lineItems
    .flatMap((item) => item.issues ?? [])
    .filter((issue, index, arr) => arr.indexOf(issue) === index);

  return {
    openingStockSummary,
    closingStockSummary,
    refillSummary,
    productsSold,
    quantitySold,
    revenue,
    estimatedProfit,
    lowStockItems,
    unmatchedItems,
    dataErrors,
  };
}

export function recalculateLineItem(
  item: StockReconciliationLineItem,
  products: Product[]
): StockReconciliationLineItem {
  const product = item.productId ? products.find((p) => p.id === item.productId) : undefined;
  const unitPrice = product?.sellingPrice ?? item.unitPrice;
  const buyingPrice = product?.buyingPrice ?? 0;
  const quantitySold = calculateQuantitySold(item.openingStock, item.closingStock, item.refillStock);

  return {
    ...item,
    productName: product?.name ?? item.productName,
    unitPrice,
    quantitySold,
    revenue: quantitySold * unitPrice,
    estimatedProfit: quantitySold * Math.max(0, unitPrice - buyingPrice),
    status: product ? (item.issues?.length ? 'error' : 'matched') : 'unmatched',
  };
}
