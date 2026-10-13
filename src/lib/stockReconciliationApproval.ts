import { dexieDb, addSale, updateStockReconciliationSession } from '@/lib/db';
import { summarizeReconciliationSession, recalculateLineItem } from '@/lib/stockReconciliationCalculations';
import { pushApprovedReconciliationToCloud } from '@/lib/stockReconciliationRemote';
import type { Product, Sale, SaleItem, StockReconciliationLineItem, StockReconciliationSession } from '@/types/pos';

async function createProductsForUnmatchedLines(args: {
  lineItems: StockReconciliationLineItem[];
  storeId: string;
  products: Product[];
}): Promise<{ lineItems: StockReconciliationLineItem[]; products: Product[]; created: number }> {
  const products = [...args.products];
  let created = 0;
  const lineItems = args.lineItems.map((line) => ({ ...line }));

  for (const line of lineItems) {
    if (line.productId) continue;
    const name = (line.rawName || line.productName || '').trim();
    if (!name) continue;

    const sellingPrice = line.unitPrice > 0 ? line.unitPrice : 0;
    const newProduct: Product = {
      id: crypto.randomUUID(),
      name,
      barcode: '',
      buyingPrice: sellingPrice > 0 ? Math.round(sellingPrice * 0.65) : 0,
      sellingPrice,
      stock: line.closingStock,
      lowStockThreshold: 5,
      categoryIds: [],
      storeId: args.storeId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await dexieDb.products.put(newProduct);
    products.push(newProduct);
    line.productId = newProduct.id;
    line.productName = newProduct.name;
    line.unitPrice = sellingPrice;
    line.status = 'matched';
    created += 1;
  }

  return { lineItems, products, created };
}

export async function applyStockReconciliationApproval(args: {
  session: StockReconciliationSession;
  approvedBy: string;
  products: Product[];
  /** Create Supabase/local products for unmatched OCR names */
  createMissingProducts?: boolean;
}): Promise<{
  session: StockReconciliationSession;
  saleId: string;
  sale: Sale;
  productsCreated?: number;
  cloudSync?: { sessionSynced: boolean; saleSynced: boolean; productsSynced: number };
}> {
  const { session, approvedBy, products } = args;
  let workingProducts = products;
  let workingLineItems = session.lineItems;
  let productsCreated = 0;

  if (args.createMissingProducts && session.lineItems.some((l) => !l.productId)) {
    const resolved = await createProductsForUnmatchedLines({
      lineItems: session.lineItems,
      storeId: session.storeId,
      products: workingProducts,
    });
    workingLineItems = resolved.lineItems.map((line) => recalculateLineItem(line, resolved.products));
    workingProducts = resolved.products;
    productsCreated = resolved.created;
  }

  const sessionForApproval: StockReconciliationSession = {
    ...session,
    lineItems: workingLineItems,
  };
  const reportDate = session.reportDate;
  const [year, month, day] = reportDate.split('-').map(Number);
  const saleCreatedAt = new Date(year, (month || 1) - 1, day || 1, 12, 0, 0);

  const saleId = crypto.randomUUID();
  const receiptNumber = `REC-AI-${reportDate.replace(/-/g, '')}-${saleId.slice(0, 6).toUpperCase()}`;

  const saleItems: SaleItem[] = [];
  let subtotal = 0;
  let profit = 0;

  await dexieDb.transaction('rw', dexieDb.products, dexieDb.sales, dexieDb.saleItems, async () => {
    for (const line of sessionForApproval.lineItems) {
      if (!line.productId) continue;

      const product = products.find((p) => p.id === line.productId) ?? (await dexieDb.products.get(line.productId));
      if (!product) continue;

      await dexieDb.products.put({
        ...product,
        stock: Math.max(0, line.closingStock),
        updatedAt: new Date(),
      });

      if (line.quantitySold <= 0) continue;

      const lineTotal = line.quantitySold * line.unitPrice;
      const buyingPrice = product.buyingPrice ?? 0;

      saleItems.push({
        productId: product.id,
        productName: product.name,
        quantity: line.quantitySold,
        unitPrice: line.unitPrice,
        buyingPrice,
        total: lineTotal,
      });

      await dexieDb.saleItems.add({
        saleId,
        productId: product.id,
        productName: product.name,
        qty: line.quantitySold,
        priceAtSale: line.unitPrice,
        buyingPriceAtSale: buyingPrice,
        timestamp: saleCreatedAt,
        storeId: session.storeId,
      });

      subtotal += lineTotal;
      profit += line.quantitySold * Math.max(0, line.unitPrice - buyingPrice);
    }

    const sale: Sale = {
      id: saleId,
      items: saleItems,
      subtotal,
      discount: 0,
      total: subtotal,
      profit,
      storeId: session.storeId,
      paymentMethod: 'cash',
      cashierName: 'AI Stock Reconciliation',
      createdAt: saleCreatedAt,
      receiptNumber,
    };

    await dexieDb.sales.put(sale);
  });

  const sale: Sale = {
    id: saleId,
    items: saleItems,
    subtotal,
    discount: 0,
    total: subtotal,
    profit,
    storeId: session.storeId,
    paymentMethod: 'cash',
    cashierName: 'AI Stock Reconciliation',
    createdAt: saleCreatedAt,
    receiptNumber,
  };

  await addSale(sale);

  const summary = summarizeReconciliationSession(sessionForApproval, workingProducts);
  const updatedSession: StockReconciliationSession = {
    ...sessionForApproval,
    ...summary,
    status: 'approved',
    approvedAt: new Date(),
    approvedBy,
    saleId,
    updatedAt: new Date(),
  };

  await updateStockReconciliationSession(updatedSession);

  const updatedProducts = await dexieDb.products.where('storeId').equals(session.storeId).toArray();
  const cloudSync = await pushApprovedReconciliationToCloud({
    session: updatedSession,
    sale,
    products: updatedProducts,
    companyId: session.companyId,
  });

  return { session: updatedSession, saleId, sale, productsCreated, cloudSync };
}
