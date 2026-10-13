/**
 * Online Orders — marketplace checkout → POS confirm flow
 */

import type {
  OnlineOrder,
  OnlineOrderItem,
  CartItem,
  OnlineOrderSource,
  OnlineOrderStatus,
  OnlineOrderPaymentStatus,
} from '@/types/pos';
import { generateOnlineOrderNumber } from '@/types/pos';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { dexieDb } from '@/lib/db';
import { fetchStoreHostStatus, isCustomerShopOpen } from '@/lib/hostStatus';
import { addToSyncQueue } from '@/lib/sync';
import type { Product } from '@/types/pos';

function mapCloudProductRow(row: any, fallbackStoreId?: string): Product {
  const selling = Number(row.selling_price ?? row.price ?? row.sellingPrice ?? 0) || 0;
  const buying = Number(row.buying_price ?? row.cost_price ?? row.buyingPrice ?? 0) || 0;
  const stock = Number(row.stock_quantity ?? row.stock ?? 0) || 0;
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
    storeId: String(row.store_id || row.storeId || fallbackStoreId || ''),
    imageUrl: row.image_url || row.imageUrl || undefined,
    stockUnit: row.stock_unit || row.stockUnit || undefined,
    sellUnit: row.sell_unit || row.sellUnit || undefined,
    unitsPerBulk: Number(row.units_per_bulk ?? row.unitsPerBulk ?? 1) || 1,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

const PENDING_STATUSES = new Set([
  'pending',
  'PENDING',
  'AWAITING_APPROVAL',
  'confirmed',
  'CONFIRMED',
]);

export function isPendingOnlineOrderStatus(status?: string | null): boolean {
  if (!status) return false;
  return PENDING_STATUSES.has(String(status));
}

function itemUnitPrice(item: Partial<OnlineOrderItem> & { unitPrice?: number; price_at_order?: number }): number {
  const raw =
    item.priceAtOrder ??
    item.unitPrice ??
    item.price_at_order ??
    0;
  return Number(raw) || 0;
}

function normalizeOrderItems(rawItems: any[] | undefined | null, orderId: string): OnlineOrderItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item) => {
    const price = itemUnitPrice(item);
    const buying =
      Number(item.buyingPriceAtOrder ?? item.buying_price_at_order ?? item.buyingPrice ?? 0) || 0;
    return {
      id: String(item.id || crypto.randomUUID()),
      productId: String(item.productId || item.product_id || ''),
      productName: String(item.productName || item.product_name || 'Item'),
      quantity: Number(item.quantity) || 0,
      priceAtOrder: price,
      buyingPriceAtOrder: buying,
      createdAt: item.createdAt
        ? new Date(item.createdAt)
        : item.created_at
          ? new Date(item.created_at)
          : new Date(),
    };
  });
}

export function mapRowToOnlineOrder(row: any): OnlineOrder {
  let meta: Record<string, any> = {};
  try {
    if (typeof row.delivery_notes === 'string' && row.delivery_notes.trim().startsWith('{')) {
      meta = JSON.parse(row.delivery_notes);
    } else if (row.delivery_notes && typeof row.delivery_notes === 'object') {
      meta = row.delivery_notes;
    }
  } catch {
    meta = {};
  }

  const statusRaw = String(row.status || 'pending');
  const statusMapped =
    statusRaw.toLowerCase() === 'delivered'
      ? 'COMPLETED'
      : statusRaw.toLowerCase() === 'cancelled'
        ? 'CANCELLED'
        : statusRaw.toLowerCase() === 'pending' || statusRaw.toUpperCase() === 'PENDING'
          ? 'PENDING'
          : (statusRaw as OnlineOrderStatus);

  const payRaw = String(row.payment_status || row.paymentStatus || 'pending');
  const paymentStatus =
    payRaw.toLowerCase() === 'paid' || payRaw.toUpperCase() === 'PAID'
      ? 'PAID'
      : 'UNPAID';

  return {
    id: String(row.id),
    orderNumber: String(row.order_number || row.orderNumber || meta.order_number || ''),
    storeId: String(row.store_id || row.storeId || ''),
    customerName: String(row.customer_name || row.customerName || ''),
    customerPhone: String(row.customer_phone || row.customerPhone || ''),
    items: normalizeOrderItems(row.items, String(row.id)),
    subtotal: Number(row.subtotal) || 0,
    discount: Number(row.discount ?? meta.discount ?? 0) || 0,
    deliveryFee: Number(row.delivery_fee ?? row.deliveryFee ?? 0) || 0,
    total: Number(row.total) || 0,
    status: statusMapped as OnlineOrderStatus,
    source: (row.source || meta.source || 'ONLINE') as OnlineOrderSource,
    deliveryType: (row.delivery_type || row.deliveryType || meta.delivery_type || 'collect') as
      | 'collect'
      | 'delivery',
    deliveryAddress: row.delivery_address || row.deliveryAddress || '',
    paymentCategory: row.payment_category || row.paymentCategory || meta.payment_category,
    mobileProvider: row.mobile_provider || row.mobileProvider || meta.mobile_provider,
    selectedBank: row.selected_bank || row.selectedBank || meta.selected_bank,
    paymentTransactionId:
      row.payment_transaction_id || row.paymentTransactionId || meta.payment_transaction_id || '',
    paymentStatus: paymentStatus as OnlineOrderPaymentStatus,
    needsPaymentApproval: Boolean(
      row.needs_payment_approval ?? row.needsPaymentApproval ?? meta.needs_payment_approval
    ),
    paymentProofUrl: row.payment_proof_url || row.paymentProofUrl,
    verifiedByStaffId:
      row.verified_by_staff_id || row.verifiedByStaffId || meta.verified_by_staff_id,
    verifiedAt: row.verified_at || row.verifiedAt ? new Date(row.verified_at || row.verifiedAt) : undefined,
    completedSaleId: row.completed_sale_id || row.completedSaleId || meta.completed_sale_id,
    notes: row.notes,
    approvalNotes: row.approval_notes || row.approvalNotes,
    createdAt: new Date(row.created_at || row.createdAt || Date.now()),
    updatedAt: new Date(row.updated_at || row.updatedAt || Date.now()),
  };
}

function getPipelineApiBase(): string {
  try {
    const viteEnv =
      typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined'
        ? (import.meta.env as Record<string, string>)
        : {};
    const configured = String(viteEnv.VITE_PIPELINE_URL || '').trim().replace(/\/$/, '');
    if (configured) return configured;
  } catch {
    /* ignore */
  }
  // Same-origin `/api` → Vite proxy → local pipeline (LAN/remote shop PC)
  return '';
}

function pipelineUrl(path: string): string {
  const base = getPipelineApiBase();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function pipelineUpsertOnlineOrder(order: OnlineOrder): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    try {
      const resp = await fetch(pipelineUrl('/api/online-orders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: order.id,
          storeId: order.storeId,
          store_id: order.storeId,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          items: order.items,
          subtotal: order.subtotal,
          discount: order.discount,
          deliveryFee: order.deliveryFee,
          total: order.total,
          status: order.status,
          source: order.source,
          deliveryType: order.deliveryType,
          deliveryAddress: order.deliveryAddress,
          paymentCategory: order.paymentCategory,
          mobileProvider: order.mobileProvider,
          selectedBank: order.selectedBank,
          paymentTransactionId: order.paymentTransactionId,
          paymentStatus: order.paymentStatus,
          needsPaymentApproval: order.needsPaymentApproval,
          completedSaleId: order.completedSaleId,
          verifiedByStaffId: order.verifiedByStaffId,
          createdAt: order.createdAt,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.warn('Pipeline online-order upsert failed:', resp.status, text);
        return false;
      }
      return true;
    } finally {
      window.clearTimeout(timer);
    }
  } catch (error) {
    console.warn('Pipeline online-order upsert unavailable:', error);
    return false;
  }
}

async function pipelineFetchPendingOrders(storeId: string): Promise<OnlineOrder[]> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    try {
      const resp = await fetch(
        pipelineUrl(`/api/online-orders?store_id=${encodeURIComponent(storeId)}&status=pending`),
        { signal: controller.signal }
      );
      if (!resp.ok) return [];
      const data = await resp.json();
      const rows = Array.isArray(data?.orders) ? data.orders : [];
      return rows.map(mapRowToOnlineOrder);
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    return [];
  }
}

async function pipelinePatchOnlineOrder(
  orderId: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  try {
    const resp = await fetch(pipelineUrl(`/api/online-orders/${encodeURIComponent(orderId)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Push stock levels to Supabase via pipeline (service role — works remote if VITE_PIPELINE_URL is set). */
export async function syncProductStockViaPipeline(
  updates: Array<{ productId: string; stock?: number; decrement?: number }>
): Promise<boolean> {
  try {
    const resp = await fetch(pipelineUrl('/api/products/stock'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function resolveCompanyIdForStore(storeId: string): Promise<string | null> {
  try {
    const local = await dexieDb.stores.get(storeId);
    const localCompanyId = (local as any)?.companyId || (local as any)?.company_id;
    if (localCompanyId) return String(localCompanyId);
  } catch {
    /* ignore */
  }

  if (!isSupabaseConfigured()) return null;

  try {
    const { data } = await supabase
      .from('stores')
      .select('company_id')
      .eq('id', storeId)
      .maybeSingle();
    return data?.company_id ? String(data.company_id) : null;
  } catch {
    return null;
  }
}

/** Compatible with the existing online_orders columns (no migration required). */
function toSupabaseOrderPayload(order: OnlineOrder, companyId?: string | null) {
  const meta = {
    order_number: order.orderNumber,
    discount: order.discount,
    source: order.source,
    delivery_type: order.deliveryType,
    payment_category: order.paymentCategory || null,
    mobile_provider: order.mobileProvider || null,
    selected_bank: order.selectedBank || null,
    payment_transaction_id: order.paymentTransactionId || null,
    needs_payment_approval: order.needsPaymentApproval,
    completed_sale_id: order.completedSaleId || null,
    verified_by_staff_id: order.verifiedByStaffId || null,
  };

  const statusRaw = String(order.status || 'pending').toLowerCase();
  const status =
    statusRaw === 'completed' || statusRaw === 'delivered'
      ? 'delivered'
      : statusRaw === 'cancelled'
        ? 'cancelled'
        : 'pending';

  return {
    id: order.id,
    store_id: order.storeId,
    company_id: companyId || order.storeId,
    customer_name: order.customerName,
    customer_phone: order.customerPhone,
    customer_address: order.deliveryAddress || null,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      product_id: item.productId,
      productName: item.productName,
      product_name: item.productName,
      quantity: item.quantity,
      priceAtOrder: item.priceAtOrder,
      price_at_order: item.priceAtOrder,
      buyingPriceAtOrder: item.buyingPriceAtOrder,
      buying_price_at_order: item.buyingPriceAtOrder,
    })),
    subtotal: order.subtotal,
    delivery_fee: order.deliveryFee,
    total: order.total,
    status,
    payment_method: order.paymentCategory === 'bank' ? 'card' : 'mobile',
    payment_status: String(order.paymentStatus).toUpperCase() === 'PAID' ? 'paid' : 'pending',
    delivery_address: order.deliveryAddress || null,
    delivery_notes: JSON.stringify(meta),
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}

/** Upsert order: direct Supabase first (real cloud), pipeline as backup (LAN / service role). */
export async function upsertOnlineOrderToSupabase(order: OnlineOrder): Promise<boolean> {
  let cloudOk = false;

  if (isSupabaseConfigured()) {
    try {
      const companyId = await resolveCompanyIdForStore(order.storeId);
      if (!companyId) {
        console.warn('online_orders upsert: could not resolve company_id for store', order.storeId);
      }
      const payload = toSupabaseOrderPayload(order, companyId);
      // Never write fake company_id = storeId — omit and let DB allow null if needed
      if (!companyId) {
        delete (payload as any).company_id;
        (payload as any).company_id = null;
      }
      const { error } = await supabase.from('online_orders').upsert(payload, { onConflict: 'id' });
      if (error) {
        console.warn('online_orders Supabase upsert failed:', error.message || error);
      } else {
        cloudOk = true;
      }
    } catch (error) {
      console.warn('online_orders Supabase upsert exception:', error);
    }
  }

  // Pipeline (service role) — also pushes to Supabase when keys are present
  const viaPipeline = await pipelineUpsertOnlineOrder(order);
  return cloudOk || viaPipeline;
}

/**
 * Re-price / validate cart lines against live Supabase products.
 * Returns null if a product is missing or out of stock in cloud.
 */
export async function hydrateCartFromSupabase(
  storeId: string,
  cartItems: CartItem[]
): Promise<{ items: CartItem[]; error?: string } | null> {
  if (!isSupabaseConfigured() || !navigator.onLine) {
    return { items: cartItems };
  }

  try {
    const ids = cartItems.map((i) => i.product.id).filter(Boolean);
    if (!ids.length) return { items: cartItems, error: 'Cart is empty' };

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('store_id', storeId)
      .in('id', ids);

    if (error) {
      console.warn('Live product hydrate failed:', error.message);
      return { items: cartItems, error: 'Could not load live products from cloud' };
    }

    const byId = new Map((data || []).map((row: any) => [String(row.id), mapCloudProductRow(row, storeId)]));
    const hydrated: CartItem[] = [];

    for (const line of cartItems) {
      const live = byId.get(line.product.id);
      if (!live) {
        return {
          items: cartItems,
          error: `"${line.product.name}" is not in the live cloud catalog`,
        };
      }
      if (live.stock < line.quantity) {
        return {
          items: cartItems,
          error: `"${live.name}" only has ${live.stock} in stock (cloud)`,
        };
      }
      hydrated.push({
        ...line,
        product: live,
      });
    }

    return { items: hydrated };
  } catch (e) {
    console.warn('hydrateCartFromSupabase failed:', e);
    return { items: cartItems, error: 'Cloud product check failed' };
  }
}

/** Deduct / set product stock directly in Supabase (authenticated staff or service via pipeline). */
export async function deductStockInSupabase(
  updates: Array<{ productId: string; quantity: number }>
): Promise<boolean> {
  if (!updates.length) return true;

  // Prefer pipeline service role (works even with strict RLS)
  const pipelineOk = await syncProductStockViaPipeline(
    updates.map((u) => ({ productId: u.productId, decrement: u.quantity }))
  );
  if (pipelineOk) return true;

  if (!isSupabaseConfigured()) return false;

  try {
    for (const u of updates) {
      const { data, error } = await supabase
        .from('products')
        .select('id, stock, stock_quantity')
        .eq('id', u.productId)
        .maybeSingle();
      if (error || !data) {
        console.warn('Stock read failed for', u.productId, error);
        continue;
      }
      const current = Number((data as any).stock_quantity ?? (data as any).stock ?? 0) || 0;
      const next = Math.max(0, current - Math.max(0, u.quantity));
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if ((data as any).stock_quantity != null) patch.stock_quantity = next;
      if ((data as any).stock != null || (data as any).stock_quantity == null) patch.stock = next;

      const { error: updErr } = await supabase.from('products').update(patch).eq('id', u.productId);
      if (updErr) {
        console.warn('Stock update failed for', u.productId, updErr);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn('deductStockInSupabase failed:', e);
    return false;
  }
}

/**
 * Create a new online order from a guest cart.
 * When online + Supabase configured: validates against live catalog and REQUIRES cloud write.
 */
export async function createOnlineOrder(
  storeId: string,
  customerName: string,
  customerPhone: string,
  cartItems: CartItem[],
  subtotal: number,
  discount: number,
  source: OnlineOrderSource = 'ONLINE',
  deliveryType: 'collect' | 'delivery' = 'collect',
  deliveryFee: number = 0,
  deliveryAddress?: string,
  paymentCategory?: 'mobile' | 'bank',
  mobileProvider?: 'mtn' | 'airtel' | 'zamtel' | 'zedmobile',
  selectedBank?: string,
  paymentTransactionId?: string,
  manualPayment?: boolean
): Promise<OnlineOrder | null> {
  try {
    const hostStatus = await fetchStoreHostStatus(storeId);
    if (hostStatus && !isCustomerShopOpen(hostStatus.hostStatus)) {
      throw new Error(hostStatus.message || 'This shop is not accepting orders right now.');
    }

    if (!hostStatus) {
      try {
        const store = await dexieDb.stores.get(storeId);
        if (store?.companyId) {
          const company = await dexieDb.companies.get(store.companyId);
          if (company && !isCustomerShopOpen(company.hostStatus)) {
            throw new Error(
              company.hostStatusReason ||
                'This shop is not accepting orders right now.'
            );
          }
        }
      } catch (localErr) {
        if (localErr instanceof Error && localErr.message.includes('not accepting')) {
          throw localErr;
        }
      }
    }

    const requireCloud = Boolean(isSupabaseConfigured() && typeof navigator !== 'undefined' && navigator.onLine);

    let lines = cartItems;
    if (requireCloud) {
      const hydrated = await hydrateCartFromSupabase(storeId, cartItems);
      if (!hydrated) return null;
      if (hydrated.error) {
        console.error('Cloud catalog validation failed:', hydrated.error);
        throw new Error(hydrated.error);
      }
      lines = hydrated.items;
    }

    const orderId = crypto.randomUUID();
    const orderNumber = generateOnlineOrderNumber(storeId);
    const now = new Date();

    const orderItems: OnlineOrderItem[] = lines.map((item) => ({
      id: crypto.randomUUID(),
      productId: item.product.id,
      productName: item.product.name,
      quantity: item.quantity,
      priceAtOrder: Number(item.product.sellingPrice) || 0,
      buyingPriceAtOrder: Number(item.product.buyingPrice) || 0,
      createdAt: now,
    }));

    const liveSubtotal = orderItems.reduce((s, i) => s + i.priceAtOrder * i.quantity, 0);
    const useSubtotal = requireCloud ? liveSubtotal : subtotal;

    const onlineOrder: OnlineOrder = {
      id: orderId,
      orderNumber,
      storeId,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      items: orderItems,
      subtotal: useSubtotal,
      discount,
      deliveryFee,
      total: Math.max(0, useSubtotal - discount + deliveryFee),
      status: 'PENDING',
      source,
      deliveryType,
      deliveryAddress: deliveryAddress || '',
      paymentCategory: paymentCategory || 'mobile',
      mobileProvider: mobileProvider || undefined,
      selectedBank: selectedBank || '',
      paymentTransactionId: paymentTransactionId || '',
      paymentStatus: 'UNPAID',
      needsPaymentApproval: Boolean(manualPayment),
      createdAt: now,
      updatedAt: now,
    };

    const synced = await upsertOnlineOrderToSupabase(onlineOrder);
    if (requireCloud && !synced) {
      throw new Error(
        'Order could not be saved to the cloud (Supabase). Check store is Public and online_orders policies.'
      );
    }

    if (!synced) {
      console.warn('Cloud sync unavailable — order kept locally only.');
      addToSyncQueue({
        type: 'online_order_create',
        data: onlineOrder,
      });
    }

    // Cache locally after cloud success (or offline queue path)
    await dexieDb.onlineOrders.put(onlineOrder);

    return onlineOrder;
  } catch (error) {
    console.error('Error creating online order:', error);
    throw error instanceof Error ? error : new Error('Failed to create online order');
  }
}

/**
 * Pending online orders for a store (local first, then short-timeout remote refresh).
 * Unreachable Supabase must never block the POS UI.
 */
let supabaseOrdersCooldownUntil = 0;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getPendingOnlineOrders(storeId: string): Promise<OnlineOrder[]> {
  // Dexie only on the sales floor — never wait on pipeline/Supabase for a badge or list.
  const byId = new Map<string, OnlineOrder>();

  try {
    const local = await dexieDb.onlineOrders.where('storeId').equals(storeId).toArray();
    for (const order of local) {
      if (isPendingOnlineOrderStatus(order.status)) {
        byId.set(order.id, {
          ...order,
          items: normalizeOrderItems(order.items as any, order.id),
        });
      }
    }
  } catch (error) {
    console.warn('Local pending orders read failed:', error);
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Admin/Sales refresh: pull remote pending orders into Dexie from real Supabase first. */
export async function refreshPendingOnlineOrdersFromCloud(storeId: string): Promise<OnlineOrder[]> {
  // 1) Live Supabase (source of truth)
  if (isSupabaseConfigured() && Date.now() >= supabaseOrdersCooldownUntil) {
    try {
      const result = await withTimeout(
        supabase
          .from('online_orders')
          .select('*')
          .eq('store_id', storeId)
          .in('status', ['pending', 'PENDING', 'AWAITING_APPROVAL', 'confirmed', 'CONFIRMED'])
          .order('created_at', { ascending: false }),
        8000
      );

      if (result.error) {
        console.warn('Failed to get pending online orders:', result.error.message || result.error);
        supabaseOrdersCooldownUntil = Date.now() + 30_000;
      } else {
        for (const row of result.data || []) {
          const mapped = mapRowToOnlineOrder(row);
          await dexieDb.onlineOrders.put(mapped);
        }
      }
    } catch (error) {
      console.warn('Supabase pending orders timed out/skipped:', error);
      supabaseOrdersCooldownUntil = Date.now() + 30_000;
    }
  }

  // 2) Pipeline backup (LAN service-role)
  try {
    const remote = await pipelineFetchPendingOrders(storeId);
    for (const mapped of remote) {
      await dexieDb.onlineOrders.put(mapped);
    }
  } catch (error) {
    console.warn('Pipeline pending orders fetch failed:', error);
  }

  return getPendingOnlineOrders(storeId);
}

export async function updateOnlineOrderStatus(
  orderId: string,
  newStatus: OnlineOrderStatus | string,
  verifiedByStaffId?: string,
  extras?: Partial<{
    paymentStatus: OnlineOrderPaymentStatus | string;
    completedSaleId: string;
  }>
): Promise<boolean> {
  try {
    const now = new Date();
    const localOrder = await dexieDb.onlineOrders.get(orderId);
    if (localOrder) {
      const updated: OnlineOrder = {
        ...localOrder,
        status: newStatus as OnlineOrderStatus,
        verifiedByStaffId: verifiedByStaffId || localOrder.verifiedByStaffId,
        verifiedAt: now,
        completedSaleId: extras?.completedSaleId || localOrder.completedSaleId,
        paymentStatus: (extras?.paymentStatus as OnlineOrderPaymentStatus) || localOrder.paymentStatus,
        updatedAt: now,
      };
      await dexieDb.onlineOrders.put(updated);
      await upsertOnlineOrderToSupabase(updated);
      return true;
    }

    const patched = await pipelinePatchOnlineOrder(orderId, {
      status: newStatus,
      paymentStatus: extras?.paymentStatus,
      completedSaleId: extras?.completedSaleId,
      verifiedByStaffId,
    });
    if (patched) return true;

    if (!isSupabaseConfigured()) return false;

    const dbStatus =
      String(newStatus).toUpperCase() === 'COMPLETED'
        ? 'delivered'
        : String(newStatus).toUpperCase() === 'CANCELLED'
          ? 'cancelled'
          : String(newStatus).toLowerCase() === 'pending'
            ? 'pending'
            : 'confirmed';

    const patch: Record<string, unknown> = {
      status: dbStatus,
      updated_at: now.toISOString(),
    };
    if (extras?.paymentStatus) {
      patch.payment_status =
        String(extras.paymentStatus).toUpperCase() === 'PAID' ? 'paid' : 'pending';
    }

    const { error } = await supabase.from('online_orders').update(patch).eq('id', orderId);
    if (error) {
      console.error('Failed to update online order status:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error updating online order status:', error);
    return false;
  }
}

export async function getOnlineOrder(orderId: string): Promise<OnlineOrder | null> {
  try {
    const local = await dexieDb.onlineOrders.get(orderId);
    if (local) {
      return { ...local, items: normalizeOrderItems(local.items as any, local.id) };
    }

    if (!isSupabaseConfigured()) return null;

    const { data, error } = await supabase.from('online_orders').select('*').eq('id', orderId).single();
    if (error || !data) {
      console.error('Failed to get online order:', error);
      return null;
    }
    return mapRowToOnlineOrder(data);
  } catch (error) {
    console.error('Error getting online order:', error);
    return null;
  }
}

export function subscribeToPendingOrders(
  storeId: string,
  onOrderAdded: (order: OnlineOrder) => void,
  onOrderUpdated: (order: OnlineOrder) => void
): (() => void) | null {
  try {
    if (!isSupabaseConfigured()) {
      console.log('Supabase not configured, real-time subscriptions disabled');
      return null;
    }

    const uniqueChannelName = `pending_orders_${storeId}_${Math.random().toString(36).slice(2, 9)}`;
    const subscription = supabase
      .channel(uniqueChannelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'online_orders', filter: `store_id=eq.${storeId}` },
        async (payload) => {
          if (!payload.new) return;
          const order = mapRowToOnlineOrder(payload.new);
          try {
            await dexieDb.onlineOrders.put(order);
          } catch {
            /* ignore */
          }

          if (payload.eventType === 'INSERT' && isPendingOnlineOrderStatus(order.status)) {
            onOrderAdded(order);
          } else if (payload.eventType === 'UPDATE') {
            onOrderUpdated(order);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Real-time subscription for pending orders active');
        } else if (status === 'CLOSED') {
          console.log('Real-time subscription for pending orders closed');
        }
      });

    return () => {
      subscription.unsubscribe();
    };
  } catch (error) {
    console.error('Failed to setup real-time subscription:', error);
    return null;
  }
}

export async function getOnlineOrderCountByStatus(storeId: string, status: string): Promise<number> {
  try {
    if (!isSupabaseConfigured()) return 0;

    const { data, error } = await supabase
      .from('online_orders')
      .select('id')
      .eq('store_id', storeId)
      .eq('status', status);

    if (error) {
      console.error('Failed to get order count:', error);
      return 0;
    }

    return (data || []).length;
  } catch (error) {
    console.error('Failed to get order count:', error);
    return 0;
  }
}
