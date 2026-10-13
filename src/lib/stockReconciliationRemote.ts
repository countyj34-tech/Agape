import { dexieDb } from '@/lib/db';
import { supabase, isSupabaseConfigured, hasActiveSession } from '@/lib/supabase';
import { syncProductToSupabase, syncSaleToSupabase } from '@/lib/sync';
import { MASTER_EMAIL, MASTER_PASSWORD, isMasterSessionActive } from '@/lib/offlineMasterAuth';
import type { Company, Product, Sale, StockReconciliationSession, Store } from '@/types/pos';

export const RECONCILIATION_STORAGE_BUCKET = 'stock-reconciliation-sessions';

function isMissingTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('stock_reconciliation_sessions') &&
    (lower.includes('does not exist') || lower.includes('not found') || lower.includes('schema cache'))
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Ensure a Supabase auth session exists for master remote catalog access.
 * Offline master unlock does not create a cloud session — this fixes that.
 */
export async function ensureMasterCloudSession(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase is not configured in .env' };
  }

  try {
    const existing = await withTimeout(hasActiveSession(), 3000, false);
    if (existing) return { ok: true };

    const signInPromise = supabase.auth.signInWithPassword({
      email: MASTER_EMAIL,
      password: MASTER_PASSWORD,
    });
    const result = await withTimeout(
      signInPromise.then((r) => r),
      8000,
      { data: { session: null, user: null }, error: { message: 'Cloud sign-in timed out' } as any }
    );

    if (result.error || !result.data?.session) {
      return {
        ok: false,
        error:
          result.error?.message ||
          'Could not sign in to Supabase. Provision master user or check network.',
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Cloud session failed',
    };
  }
}

function mapSupabaseProductRow(row: Record<string, unknown>, fallbackStoreId: string): Product {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    barcode: String(row.barcode || ''),
    buyingPrice: Number(row.buying_price ?? row.cost_price ?? 0),
    sellingPrice: Number(row.selling_price ?? row.price ?? 0),
    stock: Number(row.stock ?? row.stock_quantity ?? 0),
    lowStockThreshold: Number(row.low_stock_threshold ?? row.min_stock_level ?? 5),
    categoryIds: Array.isArray(row.category_ids) ? (row.category_ids as string[]) : [],
    storeId: String(row.store_id || fallbackStoreId),
    imageUrl: typeof row.image_url === 'string' ? row.image_url : undefined,
    createdAt: new Date(String(row.created_at || Date.now())),
    updatedAt: new Date(String(row.updated_at || Date.now())),
  };
}

function mapSupabaseCompany(row: Record<string, any>): Company {
  return {
    id: String(row.id),
    name: String(row.name || 'Company'),
    email: row.email || row.owner_email || undefined,
    phone: row.phone || undefined,
    ownerPhone: row.owner_phone || undefined,
    address: row.address || undefined,
    currency: row.currency || 'ZMW',
    currencySymbol: row.currency_symbol || 'K',
    baseCurrency: row.base_currency || row.currency || 'ZMW',
    hostStatus: (row.host_status || row.hostStatus || 'active') as Company['hostStatus'],
    hostStatusReason: row.host_status_reason || row.hostStatusReason || null,
    taxRate: Number(row.tax_rate ?? 0),
    receiptFooter: row.receipt_footer || '',
    thermalPrinterWidth: (row.thermal_printer_width as '58mm' | '80mm') || '58mm',
    adminPin: null,
    pinSetupComplete: true,
    isActive: row.is_active !== false,
    createdAt: new Date(row.created_at || Date.now()),
    updatedAt: new Date(row.updated_at || Date.now()),
  };
}

function mapSupabaseStore(row: Record<string, any>): Store {
  return {
    id: String(row.id),
    companyId: row.company_id || undefined,
    name: String(row.name || 'Store'),
    location_name: row.location_name || undefined,
    address: row.address || '',
    phone: row.phone || '',
    currency: row.currency || 'ZMW',
    currency_symbol: row.currency_symbol || 'K',
    is_public: row.is_public ?? true,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString(),
  };
}

export type RemoteCompanySummary = Company & {
  productCount: number;
  storeCount: number;
  stores: Array<Store & { productCount: number }>;
  source: 'cloud';
};

function masterApiHeaders(): HeadersInit {
  return { 'X-Master-Session': 'true' };
}

async function fetchMasterCatalogViaApi(): Promise<{
  companies: RemoteCompanySummary[];
  cloudConnected: boolean;
  error?: string;
}> {
  try {
    const resp = await fetch('/api/master/catalog', { headers: masterApiHeaders() });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        companies: [],
        cloudConnected: false,
        error:
          text ||
          'Master catalog API unavailable. Run: npm run dev:full (starts the local API server on port 4000).',
      };
    }
    const data = (await resp.json()) as {
      companies: Array<Record<string, unknown> & { stores?: Array<Record<string, unknown>> }>;
    };
    const summaries: RemoteCompanySummary[] = (data.companies || []).map((row) => {
      const company = mapSupabaseCompany(row);
      const stores = (row.stores || []).map((s) => ({
        ...mapSupabaseStore(s),
        productCount: Number((s as { productCount?: number }).productCount ?? 0),
      }));
      return {
        ...company,
        productCount: Number(row.productCount ?? 0),
        storeCount: Number(row.storeCount ?? stores.length),
        stores,
        source: 'cloud' as const,
      };
    });

    for (const company of summaries) {
      await dexieDb.companies.put(company);
      for (const store of company.stores) {
        await dexieDb.stores.put(store);
      }
    }

    return { companies: summaries, cloudConnected: true };
  } catch (error) {
    return {
      companies: [],
      cloudConnected: false,
      error: error instanceof Error ? error.message : 'Master catalog API failed',
    };
  }
}

/**
 * Load all remote companies + stores + product counts from Supabase (master workflow).
 */
export async function fetchRemoteCompaniesCatalog(): Promise<{
  companies: RemoteCompanySummary[];
  cloudConnected: boolean;
  error?: string;
}> {
  if (isMasterSessionActive()) {
    const viaApi = await fetchMasterCatalogViaApi();
    if (viaApi.companies.length > 0) {
      return viaApi;
    }
    if (viaApi.error?.includes('unavailable')) {
      return viaApi;
    }
  }

  const session = await ensureMasterCloudSession();
  if (!session.ok) {
    return { companies: [], cloudConnected: false, error: session.error };
  }

  try {
    const [{ data: companyRows, error: companyError }, { data: storeRows, error: storeError }] =
      await Promise.all([
        supabase.from('companies').select('*').order('name'),
        supabase.from('stores').select('*'),
      ]);

    if (companyError) {
      return { companies: [], cloudConnected: true, error: companyError.message };
    }

    const companies = (companyRows || []).map(mapSupabaseCompany);
    const stores = storeError ? [] : (storeRows || []).map(mapSupabaseStore);

    // Product counts per store (head count queries in parallel batches)
    const storeIds = stores.map((s) => s.id);
    const productCountByStore = new Map<string, number>();

    const batchSize = 8;
    for (let i = 0; i < storeIds.length; i += batchSize) {
      const batch = storeIds.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (storeId) => {
          const { count, error } = await supabase
            .from('products')
            .select('id', { count: 'exact', head: true })
            .eq('store_id', storeId);
          if (!error && typeof count === 'number') {
            productCountByStore.set(storeId, count);
          } else {
            // Fallback: try without filters / inactive included
            const { count: count2 } = await supabase
              .from('products')
              .select('id', { count: 'exact', head: true })
              .eq('store_id', storeId);
            productCountByStore.set(storeId, count2 ?? 0);
          }
        })
      );
    }

    const summaries: RemoteCompanySummary[] = companies.map((company) => {
      const companyStores = stores
        .filter((s) => s.companyId === company.id)
        .map((s) => ({
          ...s,
          productCount: productCountByStore.get(s.id) || 0,
        }))
        .sort((a, b) => b.productCount - a.productCount);

      const productCount = companyStores.reduce((sum, s) => sum + s.productCount, 0);
      return {
        ...company,
        productCount,
        storeCount: companyStores.length,
        stores: companyStores,
        source: 'cloud' as const,
      };
    });

    summaries.sort((a, b) => b.productCount - a.productCount);

    // Cache locally for offline fallback later
    for (const company of companies) {
      await dexieDb.companies.put(company);
    }
    for (const store of stores) {
      await dexieDb.stores.put(store);
    }

    return { companies: summaries, cloudConnected: true };
  } catch (error) {
    return {
      companies: [],
      cloudConnected: false,
      error: error instanceof Error ? error.message : 'Failed to load remote catalog',
    };
  }
}

/**
 * Pull the full product catalog for a remote store from Supabase into Dexie.
 * This is the primary path for master AI stock processing of remote clients.
 */
export async function pullRemoteProductsForStore(
  storeId: string,
  companyId?: string
): Promise<{
  products: Product[];
  source: 'cloud' | 'local' | 'merged';
  cloudCount: number;
  cloudError?: string;
}> {
  if (!storeId) {
    return { products: [], source: 'local', cloudCount: 0, cloudError: 'No store selected' };
  }

  let cloudProducts: Product[] = [];
  let cloudError: string | undefined;

  if (isMasterSessionActive()) {
    try {
      const qs = new URLSearchParams({ store_id: storeId });
      if (companyId && companyId !== 'local') qs.set('company_id', companyId);
      const resp = await fetch(`/api/master/products?${qs}`, { headers: masterApiHeaders() });
      if (resp.ok) {
        const data = (await resp.json()) as { products?: Record<string, unknown>[]; cloudCount?: number };
        const rows = data.products || [];
        cloudProducts = rows
          .filter((row) => row.is_active !== false)
          .map((row) => mapSupabaseProductRow(row, storeId));
        for (const product of cloudProducts) {
          await dexieDb.products.put(product);
        }
        if (cloudProducts.length > 0) {
          return {
            products: cloudProducts,
            source: 'cloud',
            cloudCount: cloudProducts.length,
          };
        }
      }
    } catch {
      // fall through to direct Supabase
    }
  }

  if (isSupabaseConfigured()) {
    const session = await ensureMasterCloudSession();
    if (!session.ok) {
      cloudError = session.error;
    } else {
      try {
        // Page through products — remote stores can have 66–1000+ items
        const pageSize = 1000;
        let from = 0;
        let keepGoing = true;
        const rows: Record<string, unknown>[] = [];

        while (keepGoing) {
          let query = supabase
            .from('products')
            .select('*')
            .eq('store_id', storeId)
            .range(from, from + pageSize - 1);

          // Prefer active products but don't fail if column missing
          const { data, error } = await query;

          if (error) {
            // Retry without assuming is_active
            const retry = await supabase
              .from('products')
              .select('*')
              .eq('store_id', storeId)
              .range(from, from + pageSize - 1);
            if (retry.error) {
              cloudError = retry.error.message || error.message;
              keepGoing = false;
              break;
            }
            rows.push(...((retry.data || []) as Record<string, unknown>[]));
            if (!retry.data || retry.data.length < pageSize) keepGoing = false;
            else from += pageSize;
            continue;
          }

          rows.push(...((data || []) as Record<string, unknown>[]));
          if (!data || data.length < pageSize) keepGoing = false;
          else from += pageSize;

          // Safety cap
          if (from > 20000) keepGoing = false;
        }

        // If store filter returned nothing and we have companyId, try company_id
        if (rows.length === 0 && companyId && companyId !== 'local') {
          const { data: byCompany, error: companyErr } = await supabase
            .from('products')
            .select('*')
            .eq('company_id', companyId)
            .limit(5000);
          if (!companyErr && byCompany?.length) {
            const filtered = byCompany.filter(
              (p: any) => !p.store_id || p.store_id === storeId
            );
            rows.push(...((filtered.length ? filtered : byCompany) as Record<string, unknown>[]));
          } else if (companyErr) {
            cloudError = companyErr.message;
          }
        }

        cloudProducts = rows
          .filter((row) => row.is_active !== false)
          .map((row) => mapSupabaseProductRow(row, storeId));

        // Cache into Dexie for matching / approval
        for (const product of cloudProducts) {
          await dexieDb.products.put(product);
        }

        if (cloudProducts.length === 0 && !cloudError) {
          cloudError =
            'Cloud returned 0 products for this store. Check store_id mapping or RLS policies for super_admin.';
        }
      } catch (error) {
        cloudError = error instanceof Error ? error.message : 'Remote product pull failed';
      }
    }
  } else {
    cloudError = 'Supabase not configured';
  }

  const localProducts = await dexieDb.products.where('storeId').equals(storeId).toArray();

  if (cloudProducts.length > 0) {
    return {
      products: cloudProducts,
      source: 'cloud',
      cloudCount: cloudProducts.length,
    };
  }

  return {
    products: localProducts,
    source: 'local',
    cloudCount: 0,
    cloudError,
  };
}

function storagePathForSession(session: StockReconciliationSession): string {
  return `${session.companyId}/${session.id}.json`;
}

async function syncSessionToStorage(session: StockReconciliationSession): Promise<boolean> {
  try {
    await ensureMasterCloudSession();
    const json = JSON.stringify(session);
    const blob = new Blob([json], { type: 'application/json' });
    const { error } = await supabase.storage
      .from(RECONCILIATION_STORAGE_BUCKET)
      .upload(storagePathForSession(session), blob, { upsert: true, contentType: 'application/json' });
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchSessionsFromStorage(companyId: string): Promise<StockReconciliationSession[]> {
  try {
    await ensureMasterCloudSession();
    const { data, error } = await supabase.storage
      .from(RECONCILIATION_STORAGE_BUCKET)
      .list(companyId, { limit: 100, sortBy: { column: 'updated_at', order: 'desc' } });
    if (error || !data?.length) return [];

    const sessions: StockReconciliationSession[] = [];
    for (const file of data) {
      if (!file.name.endsWith('.json')) continue;
      const { data: blob, error: downloadError } = await supabase.storage
        .from(RECONCILIATION_STORAGE_BUCKET)
        .download(`${companyId}/${file.name}`);
      if (downloadError || !blob) continue;
      try {
        const parsed = JSON.parse(await blob.text()) as StockReconciliationSession;
        if (parsed?.id) sessions.push(parsed);
      } catch {
        // skip
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

function sessionToSupabaseRow(session: StockReconciliationSession) {
  return {
    id: session.id,
    company_id: session.companyId,
    company_name: session.companyName,
    store_id: session.storeId,
    store_name: session.storeName,
    report_date: session.reportDate,
    status: session.status,
    session_data: session,
    sale_id: session.saleId || null,
    upload_started_at: session.uploadStartedAt ? new Date(session.uploadStartedAt).toISOString() : null,
    processing_started_at: session.processingStartedAt
      ? new Date(session.processingStartedAt).toISOString()
      : null,
    processing_completed_at: session.processingCompletedAt
      ? new Date(session.processingCompletedAt).toISOString()
      : null,
    processing_duration_ms: session.processingDurationMs ?? null,
    approved_at: session.approvedAt ? new Date(session.approvedAt).toISOString() : null,
    approved_by: session.approvedBy || null,
    prepared_by: session.preparedBy || null,
    updated_at: new Date().toISOString(),
  };
}

export async function syncReconciliationSessionToSupabase(
  session: StockReconciliationSession
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const sessionOk = await ensureMasterCloudSession();
  if (!sessionOk.ok) return syncSessionToStorage(session);

  try {
    const { error } = await supabase
      .from('stock_reconciliation_sessions')
      .upsert(sessionToSupabaseRow(session), { onConflict: 'id' });
    if (error) {
      if (isMissingTableError(String(error.message || error))) {
        return syncSessionToStorage(session);
      }
      return syncSessionToStorage(session);
    }
    return true;
  } catch {
    return syncSessionToStorage(session);
  }
}

export async function fetchReconciliationSessionsForCompany(
  companyId: string
): Promise<StockReconciliationSession[]> {
  if (!isSupabaseConfigured()) return [];
  const sessionOk = await ensureMasterCloudSession();
  if (!sessionOk.ok) return fetchSessionsFromStorage(companyId);

  try {
    const { data, error } = await supabase
      .from('stock_reconciliation_sessions')
      .select('session_data, status, report_date, store_name, approved_at, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data) {
      return fetchSessionsFromStorage(companyId);
    }
    return data.map((row) => row.session_data as StockReconciliationSession).filter(Boolean);
  } catch {
    return [];
  }
}

export async function pushApprovedReconciliationToCloud(args: {
  session: StockReconciliationSession;
  sale: Sale;
  products: Product[];
  companyId?: string;
}): Promise<{ sessionSynced: boolean; saleSynced: boolean; productsSynced: number }> {
  await ensureMasterCloudSession();
  const sessionSynced = await syncReconciliationSessionToSupabase(args.session);

  let saleSynced = false;
  let productsSynced = 0;

  if (isSupabaseConfigured() && (await hasActiveSession())) {
    saleSynced = await syncSaleToSupabase(args.sale);
    const touchedProductIds = new Set(
      args.session.lineItems.filter((line) => line.productId).map((line) => line.productId as string)
    );
    for (const productId of touchedProductIds) {
      const product = args.products.find((p) => p.id === productId);
      if (!product) continue;
      const ok = await syncProductToSupabase(product, false);
      if (ok) productsSynced += 1;
    }
  }

  return { sessionSynced, saleSynced, productsSynced };
}
