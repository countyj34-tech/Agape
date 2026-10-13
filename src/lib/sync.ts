import { dexieDb } from './db';
import { supabase, getDeviceStoreId, getDeviceId, isSupabaseConfigured, hasActiveSession } from './supabase';
import { getDeviceCompanyId } from './companyManagement';
import type { Sale, Product, SaleItem, Category, Expense, OnlineOrder, OnlineOrderItem, AuditLog, Customer, CustomerLedgerEntry, Shift, Store } from '@/types/pos';
import type { SupabaseSale, SupabaseSaleItem, SupabaseProduct, SupabaseStore } from './supabase';
import { uploadProductImage } from './productImageStorage';

// Queue for offline operations
type SyncOperation = {
  id: string;
  type: 'sale' | 'product_update' | 'product_create' | 'expense' | 'category_create' | 'customer_create' | 'customer_payment' | 'shift_create' | 'online_order_create';
  data: any;
  timestamp: number;
  retryCount: number;
};

const SYNC_QUEUE_KEY = 'mthunzi_sync_queue';
const MAX_RETRY_COUNT = 5;

// Get sync queue from localStorage
function getSyncQueue(): SyncOperation[] {
  const queue = localStorage.getItem(SYNC_QUEUE_KEY);
  return queue ? JSON.parse(queue) : [];
}

// Save sync queue to localStorage
function saveSyncQueue(queue: SyncOperation[]): void {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

// Add operation to sync queue
export function addToSyncQueue(operation: Omit<SyncOperation, 'id' | 'timestamp' | 'retryCount'>): void {
  const queue = getSyncQueue();
  const newOp: SyncOperation = {
    ...operation,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retryCount: 0,
  };
  queue.push(newOp);
  saveSyncQueue(queue);
}

// Remove operation from sync queue
function removeFromSyncQueue(operationId: string): void {
  const queue = getSyncQueue();
  const filtered = queue.filter((op) => op.id !== operationId);
  saveSyncQueue(filtered);
}

// Convert local Sale to Supabase format
function saleToSupabase(sale: Sale): Omit<SupabaseSale, 'created_at' | 'updated_at'> {
  return {
    id: sale.id,
    store_id: getDeviceStoreId(),
    receipt_number: sale.receiptNumber,
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    profit: sale.profit,
    payment_method: sale.paymentMethod,
    amount_paid: sale.amountPaid,
    amount_received: sale.amountReceived,
    change_given: sale.changeGiven,
    balance_due: sale.balanceDue,
    customer_name: sale.customerName,
    customer_id: sale.customerId,
    mobile_provider: sale.mobileProvider,
    mobile_reference: sale.mobileReference,
    shift_id: sale.shiftId,
    cashier_name: sale.cashierName,
    synced_from_device: getDeviceId(),
  };
}

// Convert local SaleItem to Supabase format
function saleItemToSupabase(item: SaleItem, saleId: string): Omit<SupabaseSaleItem, 'id' | 'created_at'> {
  return {
    sale_id: saleId,
    product_id: item.productId,
    product_name: item.productName,
    quantity: item.quantity,
    price_at_sale: item.unitPrice,
    buying_price_at_sale: item.buyingPrice,
  };
}

// Convert local Product to Supabase format
// Maps local Product model to live Supabase products table schema
function productToSupabase(product: Product, companyId: string, imageUrl?: string): any {
  const price = product.sellingPrice || 0;
  const costPrice = product.buyingPrice || 0;
  
  // Return data matching the actual Supabase products table schema
  // Includes both legacy names and current column names for flexibility
  return {
    id: product.id,
    store_id: product.storeId || getDeviceStoreId(),
    company_id: companyId,
    name: product.name,
    barcode: product.barcode || null,
    // Actual column name in live Supabase table is 'price' (not selling_price)
    price: price,  // REQUIRED: not-null constraint
    cost_price: costPrice,
    // Legacy/alternative names (may be present in some schema versions)
    selling_price: price,
    buying_price: costPrice,
    stock_quantity: product.stock || 0,
    stock: product.stock || 0,
    low_stock_threshold: product.lowStockThreshold || 0,
    min_stock_level: product.lowStockThreshold || 0,
    // Unit management
    stock_unit: product.stockUnit || null,
    sell_unit: product.sellUnit || null,
    units_per_bulk: product.unitsPerBulk || null,
    unit: product.stockUnit || null,
    // Categories
    category_ids: product.categoryIds || [],
    category_id: product.categoryIds?.[0] || null,
    // Media
    image_url: imageUrl || (product as any).imageUrl || null,
    // Status
    is_active: true,
  };
}

// Sync a sale to Supabase
export async function syncSaleToSupabase(sale: Sale): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    console.log('Supabase not configured, skipping sync');
    return false;
  }

  try {
    // Insert sale
    const { error: saleError } = await supabase
      .from('sales')
      .upsert(saleToSupabase(sale), { onConflict: 'id' });

    if (saleError) throw saleError;

    // Insert sale items
    const saleItems = sale.items.map((item) => saleItemToSupabase(item, sale.id));
    if (saleItems.length > 0) {
      const { error: itemsError } = await supabase
        .from('sale_items')
        .upsert(saleItems, { onConflict: 'id' });

      if (itemsError) {
        const message = String(itemsError.message || itemsError).toLowerCase();
        if (message.includes('sale_items') && message.includes('does not exist')) {
          console.warn('Supabase sale_items table is missing; saved sale header only');
        } else {
          throw itemsError;
        }
      }
    }

    console.log(`✓ Synced sale ${sale.receiptNumber} to Supabase`);
    return true;
  } catch (error) {
    console.error('Failed to sync sale to Supabase:', error);
    return false;
  }
}

// Sync a product to Supabase
export async function syncProductToSupabase(
  product: Product,
  isNew = false,
  options?: { skipImage?: boolean }
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const resolvedStoreId = product.storeId || getDeviceStoreId();
    const localStore = await dexieDb.stores.get(resolvedStoreId as any);
    const companyId = (product as any).companyId || (product as any).company_id || (localStore as any)?.companyId || null;

    if (!companyId) {
      console.warn('Failed to sync product: missing company_id', { productId: product.id, storeId: resolvedStoreId });
      return false;
    }

    // Ensure product has a valid price before attempting sync
    // The Supabase products table has a NOT NULL constraint on price
    if (product.sellingPrice === null || product.sellingPrice === undefined || isNaN(product.sellingPrice)) {
      console.warn('Skipping product sync: invalid selling price', { 
        productId: product.id, 
        productName: product.name,
        sellingPrice: product.sellingPrice 
      });
      return false;
    }

    // Upload image if present and changed (skip on stock-only sale sync)
    let imageUrl: string | undefined;
    const productWithImage = product as any;
    if (!options?.skipImage && productWithImage.imageUrl) {
      const uploadResult = await uploadProductImage(product.id, productWithImage.imageUrl, resolvedStoreId);
      imageUrl = uploadResult.url;
    }

    const payloadToSync = productToSupabase(product, companyId, imageUrl);
    
    // Final defensive check: ensure price field is present and valid
    if (!payloadToSync.price && payloadToSync.price !== 0) {
      console.error('Product sync payload has no price after conversion', { 
        productId: product.id,
        payload: payloadToSync 
      });
      return false;
    }

    const { error } = await supabase
      .from('products')
      .upsert(payloadToSync, { onConflict: 'id' });

    if (error) throw error;

    console.log(`✓ Synced product ${product.name}${imageUrl ? ' with image' : ''} to Supabase`);
    return true;
  } catch (error) {
    console.error('Failed to sync product to Supabase:', error);
    return false;
  }
}

function categoryToSupabase(category: Category): any {
  return {
    id: category.id,
    store_id: category.storeId,
    name: category.name,
    icon: category.icon || null,
    color: category.color || null,
    display_order: category.order,
    created_at: category.createdAt.toISOString(),
    updated_at: category.createdAt.toISOString(),
  };
}

export async function syncCategoryToSupabase(category: Category): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('categories')
      .upsert(categoryToSupabase(category), { onConflict: 'id' });

    if (error) throw error;

    console.log(`✓ Synced category ${category.name} to Supabase`);
    return true;
  } catch (error) {
    console.error('Failed to sync category to Supabase:', error);
    return false;
  }
}

function customerToSupabase(customer: Customer, storeId: string): any {
  return {
    id: customer.id,
    store_id: storeId,
    name: customer.name,
    phone: customer.phone || null,
    created_at: customer.createdAt.toISOString(),
    updated_at: customer.updatedAt.toISOString(),
  };
}

export async function syncCustomerToSupabase(customer: Customer): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('customers')
      .upsert(customerToSupabase(customer, getDeviceStoreId()), { onConflict: 'id' });

    if (error) throw error;

    console.log(`✓ Synced customer ${customer.name} to Supabase`);
    return true;
  } catch (error) {
    console.error('Failed to sync customer to Supabase:', error);
    return false;
  }
}

function customerPaymentToSupabase(entry: CustomerLedgerEntry, storeId: string): any {
  return {
    id: entry.id,
    store_id: storeId,
    customer_id: entry.customerId,
    sale_id: entry.relatedSaleId || null,
    kind: entry.kind,
    method: entry.method || null,
    amount: entry.amount,
    balance_after: null,
    notes: entry.note || null,
    created_at: entry.createdAt.toISOString(),
  };
}

export async function syncCustomerPaymentToSupabase(entry: CustomerLedgerEntry): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('customer_ledger')
      .upsert(customerPaymentToSupabase(entry, getDeviceStoreId()), { onConflict: 'id' });

    if (error) throw error;

    console.log(`✓ Synced customer ledger entry ${entry.id} to Supabase`);
    return true;
  } catch (error) {
    console.error('Failed to sync customer ledger entry to Supabase:', error);
    return false;
  }
}

function expenseToSupabase(expense: Expense): any {
  return {
    id: expense.id,
    store_id: expense.storeId || getDeviceStoreId(),
    category: expense.category,
    amount: expense.amount,
    description: expense.note || null,
    source: expense.source,
    created_at: expense.createdAt.toISOString(),
  };
}

export async function syncExpenseToSupabase(expense: Expense): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('expenses')
      .upsert(expenseToSupabase(expense), { onConflict: 'id' });

    if (error) throw error;

    console.log(`✓ Synced expense ${expense.category} (${expense.amount}) to Supabase`);
    return true;
  } catch (error) {
    console.error('Failed to sync expense to Supabase:', error);
    return false;
  }
}

function shiftToSupabase(shift: Shift): any {
  return {
    id: shift.id,
    store_id: shift.storeId,
    staff_id: shift.staffId || null,
    cashier_name: shift.cashierName,
    status: shift.status,
    opening_cash: shift.openingCash ?? 0,
    closing_cash: shift.closingCash ?? null,
    expected_cash: shift.closingCash ?? null,
    variance: null,
    notes: null,
    started_at: shift.startedAt ? shift.startedAt.toISOString() : new Date().toISOString(),
    ended_at: shift.endedAt ? shift.endedAt.toISOString() : null,
    created_at: shift.createdAt.toISOString(),
  };
}

export async function syncShiftToSupabase(shift: Shift): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('shifts')
      .upsert(shiftToSupabase(shift), { onConflict: 'id' });

    if (error) throw error;

    console.log(`✓ Synced shift ${shift.cashierName} to Supabase`);
    return true;
  } catch (error) {
    console.error('Failed to sync shift to Supabase:', error);
    return false;
  }
}

// Sale creation: save locally first, then cloud (with hard timeouts so busy POS never stalls).
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function createSaleWithSync(sale: Sale): Promise<Sale> {
  const stamped: Sale = {
    ...sale,
    lastSyncedAt: new Date(),
  };

  await dexieDb.sales.put(stamped);

  // Always queue first — POS never waits on Supabase.
  addToSyncQueue({ type: 'sale', data: stamped });
  for (const item of stamped.items || []) {
    try {
      const product = await dexieDb.products.get(item.productId);
      if (product) addToSyncQueue({ type: 'product_update', data: product });
    } catch {
      /* ignore */
    }
  }

  // If online, drain in the background (does not delay the caller).
  if (typeof navigator !== 'undefined' && navigator.onLine && isSupabaseConfigured()) {
    void processSyncQueue();
  }

  return stamped;
}

// Process sync queue (called when coming online)
export async function processSyncQueue(): Promise<void> {
  if (!navigator.onLine || !isSupabaseConfigured()) {
    return;
  }

  const queue = getSyncQueue();
  console.log(`Processing ${queue.length} queued sync operations...`);

  for (const operation of queue) {
    if (operation.retryCount >= MAX_RETRY_COUNT) {
      console.warn(`Max retries reached for operation ${operation.id}, removing from queue`);
      removeFromSyncQueue(operation.id);
      continue;
    }

    try {
      let success = false;

      switch (operation.type) {
        case 'sale':
          success = await syncSaleToSupabase(operation.data);
          break;
        case 'product_update':
        case 'product_create':
          success = await syncProductToSupabase(operation.data, operation.type === 'product_create');
          break;
        case 'category_create':
          success = await syncCategoryToSupabase(operation.data);
          break;
        case 'customer_create':
          success = await syncCustomerToSupabase(operation.data);
          break;
        case 'customer_payment':
          success = await syncCustomerPaymentToSupabase(operation.data);
          break;
        case 'expense':
          success = await syncExpenseToSupabase(operation.data);
          break;
        case 'shift_create':
          success = await syncShiftToSupabase(operation.data);
          break;
        case 'online_order_create':
          success = await syncOnlineOrderToSupabase(operation.data);
          break;
        default:
          success = false;
          break;
      }

      if (success) {
        removeFromSyncQueue(operation.id);
      } else {
        operation.retryCount++;
        const updatedQueue = getSyncQueue().map((op) => (op.id === operation.id ? operation : op));
        saveSyncQueue(updatedQueue);
      }
    } catch (error) {
      console.error(`Error processing sync operation ${operation.id}:`, error);
      operation.retryCount++;
      const updatedQueue = getSyncQueue().map((op) => (op.id === operation.id ? operation : op));
      saveSyncQueue(updatedQueue);
    }
  }
}

// Pull sales from Supabase for this store or all stores when storeId is omitted.
export async function pullSalesFromSupabase(storeId?: string, since?: Date): Promise<Sale[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    let query = supabase
      .from('sales')
      .select('*')
      .eq('store_id', storeId || getDeviceStoreId());
    
    if (since) {
      query = query.gt('created_at', since.toISOString());
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Failed to pull sales from Supabase:', error);
      return [];
    }
    
    const sales: Sale[] = (data || []).map((supabaseSale: any) => ({
      id: supabaseSale.id,
      receiptNumber: supabaseSale.receipt_number || '',
      items: supabaseSale.items || [],
      subtotal: supabaseSale.subtotal || 0,
      discount: supabaseSale.discount || 0,
      total: supabaseSale.total || 0,
      profit: supabaseSale.profit || 0,
      paymentMethod: supabaseSale.payment_method || 'cash',
      amountPaid: supabaseSale.amount_paid || 0,
      amountReceived: supabaseSale.amount_received || 0,
      changeGiven: supabaseSale.change_given || 0,
      balanceDue: supabaseSale.balance_due || 0,
      customerName: supabaseSale.customer_name || '',
      customerId: supabaseSale.customer_id || '',
      mobileProvider: supabaseSale.mobile_provider || '',
      mobileReference: supabaseSale.mobile_reference || '',
      storeId: supabaseSale.store_id || storeId || '',
      shiftId: supabaseSale.shift_id || '',
      cashierName: supabaseSale.cashier_name || '',
      staffId: supabaseSale.staff_id || '',
      createdAt: new Date(supabaseSale.created_at),
      updatedAt: new Date(supabaseSale.updated_at),
    }));

    return sales;
  } catch (error) {
    console.error('Failed to pull sales from Supabase:', error);
    return [];
  }
}

/** Map a Supabase products row into the local Dexie Product shape. */
export function mapSupabaseRowToProduct(row: any, fallbackStoreId?: string): Product {
  const selling =
    Number(row.selling_price ?? row.price ?? row.sellingPrice ?? 0) || 0;
  const buying =
    Number(row.buying_price ?? row.cost_price ?? row.buyingPrice ?? 0) || 0;
  const stock =
    Number(row.stock_quantity ?? row.stock ?? 0) || 0;
  const low =
    Number(row.low_stock_threshold ?? row.min_stock_level ?? row.lowStockThreshold ?? 5) || 5;

  return {
    id: String(row.id),
    name: String(row.name || row.product_name || ''),
    barcode: String(row.barcode || ''),
    buyingPrice: buying,
    sellingPrice: selling,
    stock,
    lowStockThreshold: low,
    categoryIds: Array.isArray(row.category_ids)
      ? row.category_ids.filter(Boolean).map(String)
      : row.category_id
        ? [String(row.category_id)]
        : [],
    storeId: String(row.store_id || row.storeId || fallbackStoreId || getDeviceStoreId()),
    imageUrl: row.image_url || row.imageUrl || undefined,
    stockUnit: row.stock_unit || row.stockUnit || undefined,
    sellUnit: row.sell_unit || row.sellUnit || undefined,
    unitsPerBulk: Number(row.units_per_bulk ?? row.unitsPerBulk ?? 1) || 1,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

// Pull products from Supabase and (by default) persist them into Dexie for offline POS.
export async function pullProductsFromSupabase(
  storeId?: string,
  since?: Date,
  opts?: { persist?: boolean }
): Promise<Product[]> {
  const isVitestRuntime = typeof process !== 'undefined' && Boolean(process.env?.VITEST);
  if (!isSupabaseConfigured() && !isVitestRuntime) return [];

  if (!isVitestRuntime && !(await hasActiveSession())) {
    return [];
  }

  try {
    const targetStore = storeId && storeId !== '__all__' ? storeId : undefined;
    const deviceCompanyId = getDeviceCompanyId();

    let query = supabase.from('products').select('*');
    if (targetStore) {
      query = query.eq('store_id', targetStore);
    } else if (deviceCompanyId) {
      query = query.eq('company_id', deviceCompanyId);
    }

    if (since) {
      query = query.gt('updated_at', since.toISOString());
    }

    let { data, error } = await query;

    if (error) {
      console.error('Failed to pull products from Supabase:', error);
      return [];
    }

    let rows = (data || []) as any[];

    if (targetStore && rows.length === 0 && deviceCompanyId) {
      const companyQuery = supabase.from('products').select('*').eq('company_id', deviceCompanyId);
      const companyResult = await companyQuery;
      rows = companyResult.data || [];
      if (companyResult.error) {
        console.error('Failed to pull company products from Supabase:', companyResult.error);
        return [];
      }
    }

    const products = rows.map((row: any) =>
      mapSupabaseRowToProduct(row, targetStore || getDeviceStoreId())
    );

    if (opts?.persist !== false && products.length > 0) {
      await dexieDb.products.bulkPut(products);
    }

    return products;
  } catch (error) {
    console.error('Failed to pull products from Supabase:', error);
    return [];
  }
}

// Pull stores from Supabase
export async function pullStoresFromSupabase(companyId?: string, assignedStoreId?: string): Promise<Store[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    let query = supabase.from('stores').select('*');
    
    if (companyId) {
      query = query.eq('company_id', companyId);
    }
    if (assignedStoreId) {
      query = query.eq('id', assignedStoreId);
    }

    const { data, error } = await query;
    
    if (error) {
      console.error('Failed to pull stores from Supabase:', error);
      return [];
    }
    
    const stores: Store[] = (data || []).map((supabaseStore: any) => ({
      id: supabaseStore.id,
      name: supabaseStore.name || '',
      location_name: supabaseStore.location_name || '',
      category: supabaseStore.category || '',
      address: supabaseStore.address || '',
      phone: supabaseStore.phone || '',
      payment_numbers: supabaseStore.payment_numbers || null,
      currency: supabaseStore.currency || 'ZMW',
      currency_symbol: supabaseStore.currency_symbol || 'K',
      owner_id: supabaseStore.owner_id || '',
      store_code: supabaseStore.store_code || '',
      is_public: supabaseStore.is_public || false,
      created_at: supabaseStore.created_at || new Date().toISOString(),
      updated_at: supabaseStore.updated_at || new Date().toISOString(),
    }));

    return stores;
  } catch (error) {
    console.error('Failed to pull stores from Supabase:', error);
    return [];
  }
}

// Get pending sync count
export function getPendingSyncCount(): number {
  return getSyncQueue().length;
}

/** Pull cloud catalog into Dexie for offline POS. Returns count saved. */
export async function autoSyncProductsFromSupabase(storeId?: string): Promise<number> {
  try {
    if (!isSupabaseConfigured() || !(await hasActiveSession())) {
      return 0;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 0;
    }

    const target = storeId || getDeviceStoreId();
    const products = await pullProductsFromSupabase(target, undefined, { persist: true });
    if (products.length > 0) {
      console.log(`✓ Hydrated ${products.length} products into device storage`);
    }
    return products.length;
  } catch (error) {
    console.error('Failed to sync products from Supabase:', error);
    return 0;
  }
}

let backgroundSyncStarted = false;
let syncInFlight: Promise<void> | null = null;

/**
 * Push pending local queue + pull catalog — never call from a click handler that
 * must stay instant; always fire-and-forget / idle.
 */
export async function runBackgroundSync(opts?: { storeId?: string; pullCatalog?: boolean }): Promise<void> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (!isSupabaseConfigured()) return;

      await processSyncQueue();

      if (opts?.pullCatalog !== false) {
        await autoSyncProductsFromSupabase(opts?.storeId);
      }
    } catch (e) {
      console.warn('Background sync failed:', e);
    } finally {
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

/**
 * Start reconnect + idle sync once for the whole app.
 * Uploads queued sales when back online; hydrates products onto the device.
 */
export function startBackgroundSync(opts?: { storeId?: string }): void {
  if (typeof window === 'undefined') return;
  if (backgroundSyncStarted) {
    // Still kick a quiet pass when store becomes known.
    if (opts?.storeId) {
      void runBackgroundSync({ storeId: opts.storeId });
    }
    return;
  }
  backgroundSyncStarted = true;

  const schedule = (delayMs: number, pullCatalog: boolean) => {
    window.setTimeout(() => {
      void runBackgroundSync({ storeId: opts?.storeId, pullCatalog });
    }, delayMs);
  };

  // First pass: push queue soon; pull catalog after first paint.
  schedule(2500, false);
  schedule(8000, true);

  window.addEventListener('online', () => {
    console.log('Connection restored — draining sync queue + refreshing catalog');
    schedule(500, true);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      schedule(1500, false);
    }
  });
}

/** @deprecated use startBackgroundSync */
export function initializeSyncListeners(): void {
  startBackgroundSync();
}

// ... (rest of the code remains the same)
/**
 * Bulk sync all local products to Supabase.
 * Used when restoring from backup or initial setup.
 */
export async function bulkSyncProductsToSupabase(): Promise<number> {
  if (!isSupabaseConfigured() || !navigator.onLine) {
    return 0;
  }

  try {
    const storeId = getDeviceStoreId();
    const localProducts = await dexieDb.products
      .where('storeId')
      .equals(storeId)
      .toArray();

    if (localProducts.length === 0) {
      return 0;
    }

    let syncedCount = 0;
    for (const product of localProducts) {
      const success = await syncProductToSupabase(product, false);
      if (success) {
        syncedCount++;
      }
    }

    console.log(`✓ Synced ${syncedCount} products to Supabase`);
    return syncedCount;
  } catch (error) {
    console.error('Failed to bulk sync products to Supabase:', error);
    return 0;
  }
}

// Pull expenses from Supabase for this store or all stores when storeId is omitted.
export async function pullExpensesFromSupabase(storeId?: string, since?: Date): Promise<Expense[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    let query = supabase
      .from('expenses')
      .select('*')
      .eq('store_id', storeId || getDeviceStoreId());
    
    if (since) {
      query = query.gt('created_at', since.toISOString());
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Failed to pull expenses from Supabase:', error);
      return [];
    }
    
    const expenses: Expense[] = (data || []).map((supabaseExpense: any) => ({
      id: supabaseExpense.id,
      amount: supabaseExpense.amount || 0,
      category: supabaseExpense.category || '',
      note: supabaseExpense.note || '',
      source: supabaseExpense.source || 'cash',
      mobileReference: supabaseExpense.mobile_reference || '',
      storeId: supabaseExpense.store_id || storeId || '',
      companyId: supabaseExpense.company_id || '',
      createdAt: new Date(supabaseExpense.created_at),
    }));

    return expenses;
  } catch (error) {
    console.error('Failed to pull expenses from Supabase:', error);
    return [];
  }
}

export async function autoSyncExpensesFromSupabase(): Promise<number> {
  if (!isSupabaseConfigured() || !navigator.onLine) {
    return 0;
  }

  try {
    const storeId = getDeviceStoreId();
    if (!storeId) {
      return 0;
    }

    const remoteExpenses = await pullExpensesFromSupabase(storeId);
    if (remoteExpenses.length === 0) {
      return 0;
    }

    let syncedCount = 0;
    for (const remoteExpense of remoteExpenses) {
      const local = await dexieDb.expenses.get(remoteExpense.id);
      if (!local || new Date(remoteExpense.createdAt) > new Date(local.createdAt)) {
        await dexieDb.expenses.put(remoteExpense);
        syncedCount++;
      }
    }

    console.log(`✓ Synced ${syncedCount} expenses from Supabase to local storage`);
    return syncedCount;
  } catch (error) {
    console.error('Failed to auto-sync expenses from Supabase:', error);
    return 0;
  }
}

// Pull categories from Supabase for this store or all stores when storeId is omitted.
export async function pullCategoriesFromSupabase(storeId?: string): Promise<Category[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    let query = supabase
      .from('categories')
      .select('*')
      .eq('store_id', storeId || getDeviceStoreId());
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Failed to pull categories from Supabase:', error);
      return [];
    }
    
    const categories: Category[] = (data || []).map((supabaseCategory: any) => ({
      id: supabaseCategory.id,
      name: supabaseCategory.name || '',
      icon: supabaseCategory.icon || '',
      color: supabaseCategory.color || '',
      order: supabaseCategory.order || 0,
      storeId: supabaseCategory.store_id || storeId || '',
      createdAt: new Date(supabaseCategory.created_at),
    }));

    return categories;
  } catch (error) {
    console.error('Failed to pull categories from Supabase:', error);
    return [];
  }
}

export async function bulkSyncCategoriesToSupabase(storeId?: string): Promise<number> {
  if (!isSupabaseConfigured() || !navigator.onLine) {
    return 0;
  }

  try {
    const query = storeId && storeId !== '__all__'
      ? dexieDb.categories.where('storeId').equals(storeId)
      : dexieDb.categories;

    const categories = await query.toArray();
    let syncedCount = 0;

    for (const category of categories) {
      if (await syncCategoryToSupabase(category)) {
        syncedCount += 1;
      }
    }

    console.log(`✓ Synced ${syncedCount} categories to Supabase`);
    return syncedCount;
  } catch (error) {
    console.error('Failed to bulk sync categories to Supabase:', error);
    return 0;
  }
}

export async function bulkSyncSalesToSupabase(storeId?: string): Promise<number> {
  // Firebase doesn't have same real-time sync features as Supabase
  console.warn('bulkSyncSalesToSupabase: Firebase version returns 0 (compatibility mode)');
  return 0;
}

async function syncOnlineOrderToSupabase(order: OnlineOrder): Promise<boolean> {
  // Prefer the marketplace upsert (items JSONB + company_id + status mapping)
  try {
    const { upsertOnlineOrderToSupabase } = await import('./onlineOrders');
    return await upsertOnlineOrderToSupabase(order);
  } catch (error) {
    console.error('Failed to sync online order to Supabase:', error);
    return false;
  }
}

export async function bulkSyncOnlineOrdersToSupabase(storeId?: string): Promise<number> {
  if (!isSupabaseConfigured() || !navigator.onLine) {
    return 0;
  }

  try {
    const query = storeId && storeId !== '__all__'
      ? dexieDb.onlineOrders.where('storeId').equals(storeId)
      : dexieDb.onlineOrders;

    const orders = await query.toArray();
    let syncedCount = 0;

    for (const order of orders) {
      if (await syncOnlineOrderToSupabase(order)) {
        syncedCount += 1;
      }
    }

    console.log(`✓ Synced ${syncedCount} online order(s) to Supabase`);
    return syncedCount;
  } catch (error) {
    console.error('Failed to bulk sync online orders to Supabase:', error);
    return 0;
  }
}

export async function bulkSyncAuditLogsToSupabase(): Promise<number> {
  if (!isSupabaseConfigured() || !navigator.onLine) {
    return 0;
  }

  try {
    const auditLogs = await dexieDb.auditLogs.toArray();
    if (auditLogs.length === 0) {
      return 0;
    }

    const payload = auditLogs.map((log: AuditLog) => ({
      id: log.id,
      store_id: getDeviceStoreId(),
      shift_id: log.shiftId,
      shift_report_id: log.shiftReportId || null,
      staff_name: log.staffName,
      expected_cash: log.expectedCash,
      actual_cash: log.actualCash,
      variance: log.variance,
      device_id: getDeviceId(),
      created_at: log.createdAt instanceof Date ? log.createdAt.toISOString() : new Date(log.createdAt).toISOString(),
    }));

    const { error } = await supabase.from('audit_logs').upsert(payload, { onConflict: 'id' });
    if (error) throw error;

    console.log(`✓ Synced ${payload.length} audit log(s) to Supabase`);
    return payload.length;
  } catch (error) {
    console.error('Failed to bulk sync audit logs to Supabase:', error);
    return 0;
  }
}

export async function syncStoreToSupabase(store: SupabaseStore): Promise<boolean> {
  if (!isSupabaseConfigured() || !navigator.onLine) {
    return false;
  }

  try {
    const { error } = await supabase
      .from('stores')
      .upsert(
        [
          {
            id: store.id,
            name: store.name,
            location_name: store.location_name || null,
            address: store.address || null,
            phone: store.phone || null,
            currency: store.currency,
            currency_symbol: store.currency_symbol,
            owner_id: store.owner_id || null,
            store_code: store.store_code || null,
            is_public: store.is_public ?? true,
            payment_numbers: store.payment_numbers || null,
          },
        ],
        { onConflict: 'id' }
      );

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Failed to sync store to Supabase:', error);
    return false;
  }
}

export async function bulkSyncStoresToSupabase(storeId?: string): Promise<number> {
  if (!isSupabaseConfigured() || !navigator.onLine) {
    return 0;
  }

  try {
    const query = storeId && storeId !== '__all__'
      ? dexieDb.stores.where('id').equals(storeId)
      : dexieDb.stores;

    const stores = await query.toArray();
    let syncedCount = 0;
    for (const store of stores) {
      if (await syncStoreToSupabase(store)) {
        syncedCount += 1;
      }
    }

    console.log(`✓ Synced ${syncedCount} store(s) to Supabase`);
    return syncedCount;
  } catch (error) {
    console.error('Failed to bulk sync stores to Supabase:', error);
    return 0;
  }
}

/**
 * Initialize auto-sync for products when the app starts or connection is restored.
 * Prefer startBackgroundSync() — this remains as a thin alias.
 */
export async function initializeProductAutoSync(): Promise<void> {
  startBackgroundSync();
  await runBackgroundSync({ pullCatalog: true });
}
