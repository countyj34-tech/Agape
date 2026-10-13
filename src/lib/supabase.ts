import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

function isValidSupabaseUrl(url: string): boolean {
  return typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'));
}

// Only create a real Supabase client when configuration is present and looks valid
const hasValidConfig = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  isValidSupabaseUrl(supabaseUrl)
);

// Expose minimal debug info on window and log at module initialization
try {
  if (typeof window !== 'undefined') {
    (window as any).__MTZ_SUPABASE_INTERNAL = {
      hasValidConfig,
      supabaseUrl: supabaseUrl || '',
      hasAnonKey: Boolean(supabaseAnonKey),
    };
    console.info('Mthunzi debug (supabase):', (window as any).__MTZ_SUPABASE_INTERNAL);
  }
} catch (e) {
  // ignore
}

export const supabase: SupabaseClient<any, any, any> = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  // Completely disable realtime to prevent WebSocket connection errors
  realtime: {
    params: {
      eventsPerSecond: 0,
    },
  },
});

// Service role client for admin operations (bypasses rate limits)
// IMPORTANT: never create an admin client in the browser — prefer server-side only.
const viteEnv = (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined') ? import.meta.env : {};
const viteServiceKey = viteEnv.VITE_SUPABASE_SERVICE_ROLE_KEY || '';
const nodeServiceKey = typeof process !== 'undefined' && process.env ? (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '') : '';
const supabaseServiceKey = nodeServiceKey || viteServiceKey || '';

// Only instantiate the admin client when running server-side (no `window`).
export const supabaseAdmin = (typeof window === 'undefined' && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

// Get the configured store ID for this device
export function getDeviceStoreId(): string {
  // Check localStorage first (set during device setup)
  const stored = localStorage.getItem('mthunzi_store_id');
  if (stored) return stored;
  
  // Fall back to env variable
  const envStoreId = import.meta.env.VITE_STORE_ID || '00000000-0000-0000-0000-000000000001';
  localStorage.setItem('mthunzi_store_id', envStoreId);
  return envStoreId;
}

// Set store ID for this device
export function setDeviceStoreId(storeId: string): void {
  localStorage.setItem('mthunzi_store_id', storeId);
}

// Get unique device identifier
export function getDeviceId(): string {
  let deviceId = localStorage.getItem('mthunzi_device_id');
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem('mthunzi_device_id', deviceId);
  }
  return deviceId;
}

// Check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return hasValidConfig;
}

export async function hasActiveSession(): Promise<boolean> {
  if (!hasValidConfig) {
    return false;
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    return !!session;
  } catch (error) {
    return false;
  }
}

export async function closeCashierShift(
  closingId: string,
  enteredCash: number,
  tableName = 'cash_closings'
) {
  const { data, error: fetchError } = await supabase
    .from(tableName)
    .select('expected_cash')
    .eq('id', closingId)
    .single();

  if (fetchError) {
    throw new Error(`Failed to fetch expected cash: ${fetchError.message}`);
  }
  if (!data || typeof data.expected_cash !== 'number') {
    throw new Error('Expected cash not found or invalid');
  }

  const expectedCash = data.expected_cash;
  const shortage = expectedCash - enteredCash;
  const status = shortage > 0 ? 'FLAGGED' : 'OK';
  const closedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from(tableName)
    .update({
      entered_cash: enteredCash,
      shortage,
      status,
      closed_at: closedAt,
    })
    .eq('id', closingId);

  if (updateError) {
    throw new Error(`Failed to save closing data: ${updateError.message}`);
  }

  console.log(
    `Expected: K${expectedCash}, Entered: K${enteredCash}, Shortage: K${shortage}, Status: ${status}`
  );

  return { expectedCash, enteredCash, shortage, status, closedAt };
}

// Database types for Supabase
export type SupabaseStore = {
  id: string;
  name: string;
  location_name?: string;
  category?: string;
  address?: string;
  phone?: string;
  /** Optional per-provider payment numbers, stored as JSON on Supabase */
  payment_numbers?: Record<string, string> | null;
  currency: string;
  currency_symbol: string;
  owner_id?: string;
  company_id?: string;
  /** Store code for multi-device joining (format: SHOP-XXXXX) */
  store_code?: string;
  /** Whether this store is publicly discoverable for joining */
  is_public?: boolean;
  created_at: string;
  updated_at: string;
};

export type SupabaseSale = {
  id: string;
  store_id: string;
  receipt_number: string;
  subtotal: number;
  discount: number;
  total: number;
  profit: number;
  payment_method: 'cash' | 'card' | 'mobile' | 'credit' | 'transfer';
  amount_paid?: number;
  amount_received?: number;
  change_given?: number;
  balance_due?: number;
  customer_name?: string;
  customer_id?: string;
  mobile_provider?: string;
  mobile_reference?: string;
  shift_id?: string;
  cashier_name?: string;
  staff_id?: string;
  synced_from_device: string;
  created_at: string;
  updated_at: string;
};

export type SupabaseSaleItem = {
  id: string;
  sale_id: string;
  product_id?: string;
  product_name: string;
  quantity: number;
  price_at_sale: number;
  buying_price_at_sale: number;
  created_at: string;
};

export type SupabaseProduct = {
  id: string;
  store_id: string;
  company_id: string;
  name: string;
  barcode?: string;
  buying_price: number;
  selling_price: number;
  stock: number;
  low_stock_threshold: number;
  stock_unit?: string;
  sell_unit?: string;
  units_per_bulk?: number;
  category_ids?: string[];
  image_url?: string | null;
  created_at: string;
  updated_at: string;
};
