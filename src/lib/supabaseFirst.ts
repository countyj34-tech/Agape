/**
 * Supabase First Data Service
 *
 * Architecture: Frontend → Supabase first, then mirror to local storage
 * - All data creation goes directly to Supabase tables
 * - Successful operations mirror to local storage (IndexedDB/AsyncStorage)
 * - Offline mode writes to local storage only, syncs when online
 * - Auth operations use Edge Functions to avoid rate limits
 */

import { supabase, supabaseAdmin, isSupabaseConfigured } from './supabase';
import { invokeAdminSignup } from './adminSignupClient';
import { dexieDb } from './db';
import { createCompanyStore } from './storeManagement';
import { normalizeAdminSignupResponse } from './functionResponseNormalizer';

// Local storage keys
const STORAGE_KEYS = {
  COMPANIES: 'mthunzi_companies',
  USERS: 'mthunzi_users',
  STAFF: 'mthunzi_staff',
  STORES: 'mthunzi_stores',
  PRODUCTS: 'mthunzi_products',
  ORDERS: 'mthunzi_orders',
  SYNC_QUEUE: 'mthunzi_sync_queue',
  LAST_SYNC: 'mthunzi_last_sync',
} as const;

// Types
export interface Company {
  id: string;
  name: string;
  email: string; // company_email for validation
  owner_email?: string;
  address?: string;
  currency?: string;
  currency_symbol?: string;
  tax_rate?: number;
  plan?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface User {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  role: 'admin' | 'owner' | 'manager' | 'staff';
  company_id: string;
  store_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Staff {
  id: string;
  company_id: string;
  store_id: string;
  name: string;
  phone?: string;
  email?: string;
  role: 'owner' | 'manager' | 'salesperson' | 'cashier' | 'delivery' | 'other';
  employee_pin?: string;
  employee_id?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SyncOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  table: string;
  data: any;
  timestamp: number;
  retryCount: number;
}

// Local storage utilities
class LocalStorageManager {
  static get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      console.error(`Error reading from localStorage key ${key}:`, error);
      return null;
    }
  }

  static set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Error writing to localStorage key ${key}:`, error);
    }
  }

  static remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`Error removing localStorage key ${key}:`, error);
    }
  }

  static getAllCompanies(): Company[] {
    return this.get<Company[]>(STORAGE_KEYS.COMPANIES) || [];
  }

  static saveCompany(company: Company): void {
    const companies = this.getAllCompanies();
    const existingIndex = companies.findIndex(c => c.id === company.id);

    if (existingIndex >= 0) {
      companies[existingIndex] = { ...companies[existingIndex], ...company };
    } else {
      companies.push(company);
    }

    this.set(STORAGE_KEYS.COMPANIES, companies);
  }

  static getAllUsers(): User[] {
    return this.get<User[]>(STORAGE_KEYS.USERS) || [];
  }

  static saveUser(user: User): void {
    const users = this.getAllUsers();
    const existingIndex = users.findIndex(u => u.id === user.id);

    if (existingIndex >= 0) {
      users[existingIndex] = { ...users[existingIndex], ...user };
    } else {
      users.push(user);
    }

    this.set(STORAGE_KEYS.USERS, users);
  }

  static getAllStaff(): Staff[] {
    return this.get<Staff[]>(STORAGE_KEYS.STAFF) || [];
  }

  static saveStaff(staff: Staff): void {
    const staffList = this.getAllStaff();
    const existingIndex = staffList.findIndex(s => s.id === staff.id);

    if (existingIndex >= 0) {
      staffList[existingIndex] = { ...staffList[existingIndex], ...staff };
    } else {
      staffList.push(staff);
    }

    this.set(STORAGE_KEYS.STAFF, staffList);
  }
}

// Sync queue management
class SyncQueueManager {
  static getQueue(): SyncOperation[] {
    return LocalStorageManager.get<SyncOperation[]>(STORAGE_KEYS.SYNC_QUEUE) || [];
  }

  static addToQueue(operation: Omit<SyncOperation, 'id' | 'timestamp' | 'retryCount'>): void {
    const queue = this.getQueue();
    const newOperation: SyncOperation = {
      ...operation,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      retryCount: 0,
    };

    queue.push(newOperation);
    LocalStorageManager.set(STORAGE_KEYS.SYNC_QUEUE, queue);
  }

  static removeFromQueue(operationId: string): void {
    const queue = this.getQueue().filter(op => op.id !== operationId);
    LocalStorageManager.set(STORAGE_KEYS.SYNC_QUEUE, queue);
  }

  static incrementRetryCount(operationId: string): void {
    const queue = this.getQueue();
    const operation = queue.find(op => op.id === operationId);
    if (operation) {
      operation.retryCount++;
      LocalStorageManager.set(STORAGE_KEYS.SYNC_QUEUE, queue);
    }
  }

  static async processQueue(): Promise<void> {
    const queue = this.getQueue();
    if (queue.length === 0) return;

    for (const operation of queue) {
      try {
        await this.executeOperation(operation);
        this.removeFromQueue(operation.id);
      } catch (error) {
        console.error(`Failed to sync operation ${operation.id}:`, error);
        operation.retryCount++;

        if (operation.retryCount >= 3) {
          // Remove failed operations after 3 retries
          this.removeFromQueue(operation.id);
          console.error(`Removed failed operation ${operation.id} after 3 retries`);
        } else {
          this.incrementRetryCount(operation.id);
        }
      }
    }
  }

  private static async executeOperation(operation: SyncOperation): Promise<void> {
    const { type, table, data } = operation;

    switch (type) {
      case 'create':
        await supabase.from(table).insert(data);
        break;
      case 'update':
        await supabase.from(table).update(data).eq('id', data.id);
        break;
      case 'delete':
        await supabase.from(table).delete().eq('id', data.id);
        break;
    }
  }
}

// Network status detection
class NetworkManager {
  private static isOnline = navigator.onLine;

  static init(): void {
    window.addEventListener('online', () => {
      this.isOnline = true;
      SyncQueueManager.processQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
    });
  }

  static getIsOnline(): boolean {
    return this.isOnline;
  }
}

// Initialize network manager
NetworkManager.init();

// Retry utility with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
  isRetryableError?: (error: any) => boolean
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      const isRetryable = isRetryableError ? isRetryableError(error) : true;
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s...
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 0.1 * delayMs; // ±10% jitter
      const totalDelay = delayMs + jitter;

      console.warn(
        `Rate limit or temporary error on attempt ${attempt + 1}/${maxRetries + 1}. Retrying in ${totalDelay.toFixed(0)}ms...`,
        error
      );

      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }

  throw lastError;
}

// Main service class
export class SupabaseFirstService {
  // Company operations
  static async createCompany(companyData: {
    name: string;
    email: string; // company_email for validation
    owner_email?: string;
    address?: string;
    currency?: string;
    currency_symbol?: string;
  }): Promise<{ success: boolean; company?: Company; error?: string }> {
    try {
      // Validate required fields
      if (!companyData.name || !companyData.email) {
        return { success: false, error: 'Company name and email are required' };
      }

      if (!companyData.email.includes('@')) {
        return { success: false, error: 'Invalid email address' };
      }

      // The remote schema may use `owner_email` (not `email`). Prefer owner_email
      // and avoid sending an `email` column which may not exist in some deployments.
      const ownerEmail = (companyData.owner_email && companyData.owner_email.trim().toLowerCase()) || companyData.email.trim().toLowerCase();

      const companyPayload = {
        name: companyData.name.trim(),
        owner_email: ownerEmail,
        address: companyData.address?.trim(),
        currency: companyData.currency || 'ZMW',
        currency_symbol: companyData.currency_symbol || (companyData.currency === 'ZMW' ? 'K' : companyData.currency),
        tax_rate: 0,
        plan: 'free',
        is_active: true,
      };

      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      let remoteCompany: any = null;

      if (isSupabaseConfigured() && NetworkManager.getIsOnline()) {
        const { data, error } = await supabase
          .from('companies')
          .insert({ id, ...companyPayload })
          .select()
          .single();

        if (error || !data) {
          console.error('Supabase company insert failed:', error?.message || error);
          return { success: false, error: error?.message || 'Failed to create company remotely' };
        }

        remoteCompany = data;
      } else {
        SyncQueueManager.addToQueue({ type: 'create', table: 'companies', data: { id, ...companyPayload } });
      }

      // Provision a default store after the company exists remotely so the
      // remote company/store relationship is always established first.
      let assignedStoreId: string | null = null;
      if (isSupabaseConfigured() && NetworkManager.getIsOnline()) {
        try {
          const defaultStoreName = `${companyName} - Main Store`;
          const storeResult = await createCompanyStore({
            name: defaultStoreName,
            location_name: 'Main Location',
            address: data.companyAddress?.trim() || '',
            phone: undefined,
            currency: currencyValue,
            currency_symbol: currencySymbol,
            is_public: true,
          }, id);

          if (storeResult?.success && storeResult.store?.id) {
            assignedStoreId = storeResult.store.id;
          }
        } catch (storeErr) {
          console.warn('Failed to provision default store during company creation:', storeErr);
        }
      }

      const canonicalCompany: any = remoteCompany
        ? {
            id: remoteCompany.id,
            name: remoteCompany.name || companyName,
            ownerId: remoteCompany.owner_id || remoteCompany.ownerId,
            ownerPhone: remoteCompany.owner_phone || remoteCompany.ownerPhone,
            ownerPin: remoteCompany.owner_pin || remoteCompany.ownerPin,
            phone: remoteCompany.phone || undefined,
            email: remoteCompany.email || remoteCompany.owner_email || normalizedCompanyEmail,
            address: remoteCompany.address || undefined,
            logoUrl: remoteCompany.logo_url || remoteCompany.logoUrl || undefined,
            currency: remoteCompany.currency || currencyValue,
            currencySymbol: remoteCompany.currency_symbol || remoteCompany.currencySymbol || currencySymbol,
            baseCurrency: remoteCompany.base_currency || remoteCompany.baseCurrency || currencyValue,
            plan: remoteCompany.plan || 'free',
            userRole: 'owner',
            assignedStoreId,
            taxRate: Number(remoteCompany.tax_rate || 0) || 0,
            salesTaxMode: remoteCompany.sales_tax_mode || 'none',
            salesTaxRate: Number(remoteCompany.sales_tax_rate || 0) || 0,
            singleItemMarginPercent: Number(remoteCompany.single_item_margin_percent || 0) || 0,
            receiptFooter: remoteCompany.receipt_footer || '',
            thermalPrinterWidth: remoteCompany.thermal_printer_width || '58mm',
            adminPin: remoteCompany.admin_pin || null,
            pinSetupComplete: Boolean(remoteCompany.pin_setup_complete || false),
            isActive: remoteCompany.is_active === false ? false : true,
            createdAt: remoteCompany.created_at ? new Date(remoteCompany.created_at) : new Date(nowIso),
            updatedAt: remoteCompany.updated_at ? new Date(remoteCompany.updated_at) : new Date(nowIso),
          }
        : {
            id,
            name: companyPayload.name || '',
            ownerId: undefined,
            ownerPhone: undefined,
            ownerPin: undefined,
            phone: undefined,
            email: normalizedCompanyEmail,
            address: companyPayload.address || undefined,
            logoUrl: undefined,
            currency: companyPayload.currency || 'ZMW',
            currencySymbol: companyPayload.currency_symbol || 'K',
            baseCurrency: companyPayload.currency || 'ZMW',
            plan: 'free',
            userRole: 'owner',
            assignedStoreId,
            taxRate: 0,
            salesTaxMode: 'none',
            salesTaxRate: 0,
            singleItemMarginPercent: 0,
            receiptFooter: '',
            thermalPrinterWidth: '58mm',
            adminPin: null,
            pinSetupComplete: false,
            isActive: true,
            createdAt: new Date(nowIso),
            updatedAt: new Date(nowIso),
          };

      try {
        LocalStorageManager.saveCompany(canonicalCompany as any);
      } catch (e) {
        console.warn('LocalStorage saveCompany failed:', e);
      }

      try {
        await dexieDb.companies.put(canonicalCompany);
      } catch (dexieErr) {
        console.warn('Failed to persist company to local Dexie DB:', dexieErr);
      }

      return { success: true, company: canonicalCompany as any };
    } catch (error: any) {
      console.error('Company creation error:', error);
      return { success: false, error: error.message || 'Failed to create company' };
    }
  }

  // User operations (admin/owner creation)
  static async createUser(userData: {
    email: string;
    pin: string; // 6-digit PIN as password
    full_name: string;
    phone?: string;
    role: 'admin' | 'owner' | 'manager' | 'staff';
    company_id: string;
    store_id?: string;
  }): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      // Validate required fields
      if (!userData.email || !userData.pin || !userData.full_name || !userData.company_id) {
        return { success: false, error: 'Missing required fields' };
      }

      if (!/^\d{6}$/.test(userData.pin)) {
        return { success: false, error: 'PIN must be 6 digits' };
      }

      // Guard: ensure Supabase is configured before attempting Edge Function calls
      if (!isSupabaseConfigured()) {
        console.error('Supabase not configured (missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY). Aborting admin-signup invocation.');
        return { success: false, error: 'Supabase not configured (missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY)' };
      }

      // Check if error is rate limiting or other retryable error
      const isRetryableAuthError = (error: any): boolean => {
        const errorMsg = String(error?.message || error?.error || '').toLowerCase();
        return (
          errorMsg.includes('rate') ||
          errorMsg.includes('usage') ||
          errorMsg.includes('timeout') ||
          errorMsg.includes('temporarily')
        );
      };
      // Use Edge Function with retry logic for auth user creation
      // Log the target function URL (helps diagnose misconfigured VITE_SUPABASE_URL or mixed-content/CORS issues)
      const fnBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL)
        ? String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')
        : '';
      const fnUrl = fnBase ? `${fnBase}/functions/v1/admin-signup` : '(unknown)';
      console.info(`Invoking Edge Function 'admin-signup' at ${fnUrl}`);

      let rawAuthResult: any = null;
      let authError: any = null;

      try {
        const invokeResp = await retryWithBackoff(
          () =>
            invokeAdminSignup({
              email: userData.email.trim().toLowerCase(),
              pin: userData.pin,
              fullName: userData.full_name.trim(),
              phone: userData.phone?.trim(),
              role: userData.role,
              companyId: userData.company_id,
              storeId: userData.store_id,
            }),
          3, // max retries
          1500, // base delay 1.5s
          (error: any) => isRetryableAuthError(error)
        );

        // `invokeResp` returned by invokeAdminSignup is { data, error }
        rawAuthResult = invokeResp?.data ?? invokeResp;
        authError = invokeResp?.error ?? null;
      } catch (invokeErr: any) {
        console.error('Auth user creation failed during Edge Function invocation:', invokeErr);
        const msg = String(invokeErr?.message || invokeErr || 'Unknown invoke error');

        // If this looks like a network/CORS failure, attempt a raw fetch to the function URL to gather diagnostics
        if (fnBase) {
          try {
            const anonKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY)
              ? String(import.meta.env.VITE_SUPABASE_ANON_KEY)
              : '';

            const directResp = await fetch(fnUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(anonKey ? { Authorization: `Bearer ${anonKey}` } : {}),
              },
              body: JSON.stringify({
                email: userData.email.trim().toLowerCase(),
                pin: userData.pin,
                fullName: userData.full_name.trim(),
                phone: userData.phone?.trim(),
                role: userData.role,
                companyId: userData.company_id,
                storeId: userData.store_id,
              }),
              mode: 'cors',
            });

            const respText = await directResp.text().catch(() => '<non-text response>');
            console.error('Direct fetch to Edge Function returned', { status: directResp.status, statusText: directResp.statusText, body: respText });

            if (!directResp.ok) {
              const errMsg = `Edge Function fetch failed: ${directResp.status} ${directResp.statusText} - ${respText}`;
              return { success: false, error: `${msg}. ${errMsg}. Check network/CORS and that ${fnUrl} is reachable from this browser.` };
            }

            // Try to parse JSON from successful direct fetch and use it as the raw auth result
            try {
              const parsed = JSON.parse(respText);
              rawAuthResult = parsed?.data ?? parsed;
              authError = parsed?.error ?? null;
            } catch (parseErr) {
              console.warn('Edge Function returned non-JSON response; raw body saved for inspection');
              rawAuthResult = respText;
              authError = null;
            }
          } catch (directErr: any) {
            console.error('Direct fetch to Edge Function failed:', directErr);
            const directMsg = String(directErr?.message || directErr);
            return { success: false, error: `${msg}. Direct fetch failed: ${directMsg}. Check browser network, VPN, or security software.` };
          }
        } else {
          // No function base URL to probe; return the original message
          if (msg.includes('Failed to send a request to the Edge Function') || msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.toLowerCase().includes('network')) {
            return { success: false, error: 'Failed to call Edge Function (network/CORS). Check VITE_SUPABASE_URL, network access, and browser DevTools for CORS or mixed-content errors.' };
          }
          return { success: false, error: msg || 'Failed to invoke admin-signup Edge Function' };
        }
      }

      // Normalize various function response shapes (some deployments wrap data differently)
      const authResult = normalizeAdminSignupResponse(rawAuthResult);

      if (authError || !authResult?.success) {
        console.error('Auth user creation failed:', authError || authResult?.error);

        // If offline, this is tricky - auth requires online
        if (!NetworkManager.getIsOnline()) {
          return { success: false, error: 'Cannot create users while offline' };
        }

        return { success: false, error: authResult?.error || authError?.message || 'Failed to create user' };
      }

      // Determine created user id from the normalized result
      const createdUserId = authResult.user_id || authResult.user?.id || null;

      if (!createdUserId) {
        console.error('admin-signup did not return a user id:', authResult);
        return { success: false, error: 'User created but admin-signup did not return a user id' };
      }

      // Use service-role client when available to avoid RLS/content-negotiation issues
      const fetchClient = supabaseAdmin || supabase;

      let userDataFromDB: any = null;
      let fetchError: any = null;

      try {
        // Use maybeSingle() to avoid PostgREST coercion errors when 0 rows are returned
        const res = await fetchClient.from('profiles').select('*').eq('id', createdUserId).maybeSingle();
        userDataFromDB = res.data;
        fetchError = res.error;
      } catch (err) {
        fetchError = err;
      }

      // If no profiles row was found, attempt to read from `users` only when we
      // have an admin (service-role) client. The `users` view often requires
      // elevated privileges and will return permission errors for anon clients.
      if (!userDataFromDB) {
        if (fetchClient === supabaseAdmin) {
          console.warn('profiles lookup returned no rows; attempting users view via admin client');
          try {
            const res2 = await fetchClient.from('users').select('*').eq('id', createdUserId).maybeSingle();
            userDataFromDB = res2.data;
            fetchError = res2.error;
          } catch (err2) {
            fetchError = err2;
          }
        } else {
          console.warn('profiles row missing and non-admin client cannot access `users` view; skipping users fallback.');
        }
      }

      if (fetchError || !userDataFromDB) {
        // No profile row found for the newly created auth user. Try to create
        // a profiles row using the service-role client (supabaseAdmin) so the
        // rest of the system has a canonical profile to work with. If that
        // fails, fall back to a local placeholder so the UI can continue.
        console.warn('No profile row found for user id', createdUserId, 'fetchError:', fetchError);

        const adminClient = supabaseAdmin || supabase;
        if (adminClient) {
          try {
            const profilePayload = {
              id: String(createdUserId),
              full_name: (userData.full_name || (userData as any).fullName || '').trim(),
              email: (userData.email || '').trim().toLowerCase(),
              phone: (userData.phone || null),
              role: (userData.role || 'owner'),
              company_id: (userData.company_id || (userData as any).companyId || null),
              store_id: (userData.store_id || (userData as any).storeId || null),
              created_at: new Date().toISOString(),
            } as any;

            const { data: insertedProfile, error: insertError } = await adminClient
              .from('profiles')
              .insert(profilePayload)
              .select()
              .single();

            if (!insertError && insertedProfile) {
              LocalStorageManager.saveUser(insertedProfile as User);
              return { success: true, user: insertedProfile as User };
            }

            console.warn('profiles insert via admin client failed:', insertError);
          } catch (insertErr) {
            console.error('Error inserting profiles row via admin client:', insertErr);
          }
        } else {
          console.warn('No admin client available to create profiles row');
        }

        const placeholderUser: User = {
          id: String(createdUserId),
          full_name: (userData.full_name || (userData as any).fullName || '').trim(),
          email: (userData.email || '') as string,
          role: (userData.role || 'owner') as User['role'],
          company_id: (userData.company_id || (userData as any).companyId || '') as string,
          created_at: new Date().toISOString(),
        } as User;

        // Mirror placeholder to local storage so rest of app can proceed
        LocalStorageManager.saveUser(placeholderUser);

        return {
          success: true,
          user: placeholderUser,
          warning: 'User created but remote profile row missing; attempted to create profile via admin key, saved placeholder locally',
        };
      }

      const user = userDataFromDB as User;

      // Mirror to local storage
      LocalStorageManager.saveUser(user);

      return { success: true, user };
    } catch (error: any) {
      console.error('User creation error:', error);
      return { success: false, error: error.message || 'Failed to create user' };
    }
  }

  // Staff operations
  static async createStaff(staffData: {
    company_id: string;
    store_id: string;
    name: string;
    phone?: string;
    email?: string;
    role: 'owner' | 'manager' | 'salesperson' | 'cashier' | 'delivery' | 'other';
    employee_pin?: string;
    employee_id?: string;
  }): Promise<{ success: boolean; staff?: Staff; error?: string }> {
    try {
      // Validate required fields
      if (!staffData.company_id || !staffData.store_id || !staffData.name) {
        return { success: false, error: 'Missing required fields' };
      }

      const staffPayload = {
        company_id: staffData.company_id,
        store_id: staffData.store_id,
        name: staffData.name.trim(),
        phone: staffData.phone?.trim(),
        email: staffData.email?.trim().toLowerCase(),
        role: staffData.role,
        employee_pin: staffData.employee_pin,
        employee_id: staffData.employee_id,
        active: true,
      };

      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      let remoteStaff: any = null;

      if (isSupabaseConfigured() && NetworkManager.getIsOnline()) {
        const { data, error } = await supabase
          .from('staff')
          .insert({ id, ...staffPayload })
          .select()
          .single();

        if (error || !data) {
          console.error('Supabase staff insert failed:', error?.message || error);
          return { success: false, error: error?.message || 'Failed to create staff remotely' };
        }

        remoteStaff = data;
      } else {
        SyncQueueManager.addToQueue({ type: 'create', table: 'staff', data: { id, ...staffPayload } });
      }

      const canonicalStaff: any = remoteStaff
        ? {
            id: remoteStaff.id,
            company_id: remoteStaff.company_id || staffPayload.company_id,
            store_id: remoteStaff.store_id || staffPayload.store_id,
            name: remoteStaff.name || staffPayload.name,
            phone: remoteStaff.phone || staffPayload.phone || undefined,
            email: remoteStaff.email || staffPayload.email || undefined,
            role: remoteStaff.role || staffPayload.role,
            employee_pin: remoteStaff.employee_pin || staffPayload.employee_pin || undefined,
            employee_id: remoteStaff.employee_id || staffPayload.employee_id || undefined,
            active: remoteStaff.active ?? true,
            created_at: remoteStaff.created_at || nowIso,
            updated_at: remoteStaff.updated_at || nowIso,
          }
        : {
            id,
            company_id: staffPayload.company_id,
            store_id: staffPayload.store_id,
            name: staffPayload.name,
            phone: staffPayload.phone || undefined,
            email: staffPayload.email || undefined,
            role: staffPayload.role,
            employee_pin: staffPayload.employee_pin || undefined,
            employee_id: staffPayload.employee_id || undefined,
            active: true,
            created_at: nowIso,
            updated_at: nowIso,
          };

      try {
        LocalStorageManager.saveStaff(canonicalStaff as any);
      } catch (e) {}

      try {
        await dexieDb.staff.put(canonicalStaff as any);
      } catch (dexieErr) {
        console.warn('Failed to persist staff to local Dexie DB:', dexieErr);
      }

      return { success: true, staff: canonicalStaff as any };
    } catch (error: any) {
      console.error('Staff creation error:', error);
      return { success: false, error: error.message || 'Failed to create staff' };
    }
  }

  // Data retrieval with local storage fallback
  static async getCompany(companyId: string): Promise<Company | null> {
    try {
      // Defensive: avoid calling Supabase with invalid companyId values such as
      // null, undefined, empty string, or the literal string "null"/"undefined".
      if (!companyId || String(companyId).trim() === '' || String(companyId) === 'null' || String(companyId) === 'undefined') {
        console.warn('getCompany called with invalid companyId:', companyId);
        return null;
      }
      // Try Supabase first
      if (NetworkManager.getIsOnline()) {
        const { data, error } = await supabase
          .from('companies')
          .select('*')
          .eq('id', companyId)
          .single();

        if (!error && data) {
          // Update local storage
          LocalStorageManager.saveCompany(data);

          // Also persist to Dexie so the rest of the app (which reads from Dexie)
          // can pick up newly fetched companies
          try {
            const remote = data as any;
            const localCompany: any = {
              id: remote.id,
              name: remote.name || '',
              ownerId: remote.owner_id || remote.ownerId,
              ownerPhone: remote.owner_phone || remote.ownerPhone,
              ownerPin: remote.owner_pin || remote.ownerPin,
              phone: remote.phone || undefined,
              email: remote.email || remote.owner_email || undefined,
              address: remote.address || undefined,
              logoUrl: remote.logo_url || remote.logoUrl || undefined,
              currency: remote.currency || 'ZMW',
              currencySymbol: remote.currency_symbol || remote.currencySymbol || 'K',
              baseCurrency: remote.base_currency || remote.baseCurrency || 'ZMW',
              plan: remote.plan || 'free',
              userRole: 'owner',
              assignedStoreId: remote.assigned_store_id || remote.assignedStoreId || null,
              taxRate: Number(remote.tax_rate || 0) || 0,
              salesTaxMode: remote.sales_tax_mode || 'none',
              salesTaxRate: Number(remote.sales_tax_rate || 0) || 0,
              singleItemMarginPercent: Number(remote.single_item_margin_percent || 0) || 0,
              receiptFooter: remote.receipt_footer || '',
              thermalPrinterWidth: remote.thermal_printer_width || '58mm',
              adminPin: remote.admin_pin || null,
              pinSetupComplete: Boolean(remote.pin_setup_complete || false),
              isActive: remote.is_active === false ? false : true,
              createdAt: remote.created_at ? new Date(remote.created_at) : new Date(),
              updatedAt: remote.updated_at ? new Date(remote.updated_at) : new Date(),
            };

            await dexieDb.companies.put(localCompany);
          } catch (dexieErr) {
            console.warn('Failed to persist fetched company to Dexie DB:', dexieErr);
          }

          return data;
        }
      }

      // Fallback to local storage
      const companies = LocalStorageManager.getAllCompanies();
      return companies.find(c => c.id === companyId) || null;
    } catch (error) {
      console.error('Error fetching company:', error);
      // Fallback to local storage
      const companies = LocalStorageManager.getAllCompanies();
      return companies.find(c => c.id === companyId) || null;
    }
  }

  static async getUser(userId: string): Promise<User | null> {
    try {
      // Try Supabase first
      if (NetworkManager.getIsOnline()) {
        // Some deployments use `profiles` instead of `users`.
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (!profileError && profileData) {
          LocalStorageManager.saveUser(profileData);
          return profileData as User;
        }

        // Fallback to `users` table if `profiles` is not present
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (!userError && userData) {
          LocalStorageManager.saveUser(userData);
          return userData as User;
        }
      }

      // Fallback to local storage
      const users = LocalStorageManager.getAllUsers();
      return users.find(u => u.id === userId) || null;
    } catch (error) {
      console.error('Error fetching user:', error);
      // Fallback to local storage
      const users = LocalStorageManager.getAllUsers();
      return users.find(u => u.id === userId) || null;
    }
  }

  static async getStaffByCompany(companyId: string): Promise<Staff[]> {
    try {
      // Try Supabase first
      if (NetworkManager.getIsOnline()) {
        const { data, error } = await supabase
          .from('staff')
          .select('*')
          .eq('company_id', companyId);

        if (!error && data) {
          // Update local storage
          data.forEach(staff => LocalStorageManager.saveStaff(staff));
          return data;
        }
      }

      // Fallback to local storage
      const allStaff = LocalStorageManager.getAllStaff();
      return allStaff.filter(s => s.company_id === companyId);
    } catch (error) {
      console.error('Error fetching staff:', error);
      // Fallback to local storage
      const allStaff = LocalStorageManager.getAllStaff();
      return allStaff.filter(s => s.company_id === companyId);
    }
  }

  // Sync operations
  static async syncOfflineData(): Promise<void> {
    if (!NetworkManager.getIsOnline()) {
      console.log('Skipping sync - offline');
      return;
    }

    try {
      await SyncQueueManager.processQueue();
      LocalStorageManager.set(STORAGE_KEYS.LAST_SYNC, Date.now());
      console.log('Offline data sync completed');
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }

  // Expose sync queue method for other services
  static addToSyncQueue(operation: Omit<SyncOperation, 'id' | 'timestamp' | 'retryCount'>): void {
    SyncQueueManager.addToQueue(operation);
  }

  // Initialize sync on app start
  static initSync(): void {
    // Sync on app start if online
    if (NetworkManager.getIsOnline()) {
      this.syncOfflineData();
    }

    // Set up periodic sync (every 5 minutes when online)
    setInterval(() => {
      if (NetworkManager.getIsOnline()) {
        this.syncOfflineData();
      }
    }, 5 * 60 * 1000);
  }
}

// Do NOT auto-start cloud sync on import — keeps POS offline-first and snappy.
// Call SupabaseFirstService.initSync() from Admin Sync only when the user asks.
// SupabaseFirstService.initSync();