/**
 * Multi-Tenant Company Management
 * 
 * Helper functions for:
 * - Creating and managing companies
 * - Managing staff/workers linked to companies/stores
 * - Tracking shift clocks (who's on duty)
 * - Viewing company-wide data and analytics
 * - Enforcing company isolation (data separation)
 */

import { dexieDb } from './db';
import { supabase, supabaseAdmin, isSupabaseConfigured } from './supabase';
import { invokeAdminSignup, invokeFunction } from './adminSignupClient';
import { createCompanyStore } from './storeManagement';
import { normalizeAdminSignupResponse } from './functionResponseNormalizer';
import { getCompanyStores } from './storeManagement';
import { normalizeEmail, normalizePhone } from './phoneHelpers';
import { ensureSchemaValid } from './supabaseSchemaHealer';
import type { Company, Staff, Department, ShiftLog, CompanySalesSummary, StoreInventoryAlert, Store } from '@/types/pos';

function normalizePin(pin?: string | number | null): string | undefined {
  if (pin === undefined || pin === null) return undefined;
  const clean = String(pin).trim();
  return clean.length > 0 ? clean : undefined;
}

function toIsoString(value: unknown, fallback = new Date()): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return fallback.toISOString();
}

function buildStaffPassword(pin: string): string {
  return `${pin.trim()}#MthunziPOS2026`;
}

function extractPhoneFromStaffAuthEmail(identifier: string): string | undefined {
  const normalized = identifier.trim().toLowerCase();
  const match = normalized.match(/^staff-(\d+)@mthunzi\.local$/);
  return match ? match[1] : undefined;
}

function mapSupabaseStoreToStore(row: any): Store {
  return {
    id: String(row.id),
    companyId: row.company_id || row.companyId,
    name: String(row.name || ''),
    location_name: row.location_name || row.locationName,
    category: row.category,
    address: row.address,
    phone: row.phone,
    currency: row.currency || 'ZMW',
    currency_symbol: row.currency_symbol || row.currencySymbol || 'K',
    payment_numbers: row.payment_numbers || row.paymentNumbers,
    owner_id: row.owner_id || row.ownerId,
    store_code: row.store_code || row.storeCode,
    is_public: row.is_public !== false,
    created_at: row.created_at || row.createdAt,
    updated_at: row.updated_at || row.updatedAt,
  };
}

function mapSupabaseStaffToStaff(row: any): Staff {
  return {
    id: String(row.id),
    companyId: row.company_id || row.companyId,
    storeId: row.store_id || row.storeId,
    departmentId: row.department_id || row.departmentId,
    name: String(row.name || ''),
    phone: normalizePhone(String(row.phone || '')) || '',
    email: normalizeEmail(row.email) ?? undefined,
    role: String(row.role || 'other') as Staff['role'],
    employeePin: row.employee_pin || row.employeePin || undefined,
    employeeId: row.employee_id || row.employeeId,
    authUserId: row.auth_user_id || row.authUserId || undefined,
    isPinVerified: Boolean(row.is_pin_verified || row.isPinVerified),
    isManager: Boolean(row.is_manager || row.isManager),
    isActive:
      row.is_active === false
        ? false
        : row.active === false
        ? false
        : true,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };
}

async function upsertLocalStaffFromSupabase(rows: any[]): Promise<Staff[]> {
  const synced: Staff[] = [];
  for (const row of rows) {
    const staff = mapSupabaseStaffToStaff(row);
    await dexieDb.staff.put(staff);
    synced.push(staff);
  }
  return synced;
}

async function getStaffFromSupabaseByIdentifier(identifier: string): Promise<Staff[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const normalized = identifier.trim();
  const isEmail = normalized.includes('@');
  const query = supabase.from('staff').select('*');
  const emailValue = normalizeEmail(normalized);
  const phoneValue = normalizePhone(normalized);
  const aliasPhone = isEmail ? extractPhoneFromStaffAuthEmail(normalized) : undefined;

  let filter;
  if (aliasPhone) {
    filter = query.or(`phone.eq.${aliasPhone},phone.ilike.%${aliasPhone}%`);
  } else if (isEmail && emailValue) {
    filter = query.eq('email', emailValue);
  } else if (phoneValue) {
    filter = query.or(`phone.eq.${phoneValue},phone.ilike.%${phoneValue}%`);
  } else {
    return [];
  }

  const { data, error } = await filter;
  if (error) {
    const message = String(error.message || error);
    console.warn('Supabase staff lookup failed:', message);

    // If the staff table does not have an email column, fall back to the local cache
    if (isEmail && message.toLowerCase().includes('email')) {
      console.warn('Email column is not available in Supabase staff table; falling back to local staff cache.');
      return [];
    }

    return [];
  }

  if (!data || !Array.isArray(data)) {
    return [];
  }

  return await upsertLocalStaffFromSupabase(data);
}

async function mapSupabaseCompanyToCompany(row: any): Promise<Company> {
  const company: Company = {
    id: String(row.id),
    name: String(row.name || ''),
    ownerPhone: normalizePhone(row.owner_phone || row.ownerPhone),
    ownerPin: normalizePin(row.owner_pin || row.ownerPin),
    phone: row.phone || row.phone,
    email: normalizeEmail(row.email),
    address: row.address || row.address,
    logoUrl: row.logo_url || row.logoUrl,
    currency: row.currency || 'ZMW',
    currencySymbol: row.currency_symbol || 'K',
    baseCurrency: row.base_currency || row.baseCurrency || 'ZMW',
    plan: (String(row.plan || 'free') as Company['plan']),
    subscriptionStatus: (row.subscription_status || row.subscriptionStatus || 'active') as Company['subscriptionStatus'],
    subscriptionExpiresAt: row.subscription_expires_at || row.subscriptionExpiresAt || null,
    subscriptionPlan: row.subscription_plan || row.subscriptionPlan || 'business',
    monthlyPriceUsd:
      row.monthly_price_usd != null
        ? Number(row.monthly_price_usd)
        : row.monthlyPriceUsd != null
          ? Number(row.monthlyPriceUsd)
          : null,
    hostStatus: (row.host_status || row.hostStatus || 'active') as Company['hostStatus'],
    hostStatusReason: row.host_status_reason || row.hostStatusReason || null,
    userRole: 'owner',
    assignedStoreId: row.assigned_store_id || row.assignedStoreId || null,
    taxRate: Number(row.tax_rate || 0),
    salesTaxMode: row.sales_tax_mode || row.salesTaxMode || 'none',
    salesTaxRate: Number(row.sales_tax_rate || 0) || 0,
    singleItemMarginPercent: Number(row.single_item_margin_percent || row.singleItemMarginPercent || 0),
    receiptFooter: row.receipt_footer || row.receiptFooter || '',
    thermalPrinterWidth: row.thermal_printer_width || row.thermalPrinterWidth || '58mm',
    parallel_enabled: row.parallel_enabled ?? row.parallelEnabled ?? false,
    parallel_source: (row.parallel_source || row.parallelSource) as Company['parallel_source'] || 'mthunzi_pos',
    parallel_status: row.parallel_status || row.parallelStatus || 'disabled',
    dashboard_user_limit: Number(row.dashboard_user_limit ?? row.dashboardUserLimit ?? 0) || 0,
    adminPin: normalizePin(row.admin_pin || row.adminPin),
    pinSetupComplete: Boolean(row.pin_setup_complete || row.pinSetupComplete),
    isActive: row.is_active === false ? false : true,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(),
    updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
  };

  await dexieDb.companies.put(company);
  return company;
}


async function getCompanyFromSupabaseByOwnerIdentifier(identifier: string): Promise<Company[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const normalized = identifier.trim();
  if (!normalized) {
    return [];
  }

  const isEmail = normalized.includes('@');
  const query = supabase.from('companies').select('*');
  const emailValue = normalizeEmail(normalized);
  const phoneValue = normalizePhone(normalized);

  let data: any[] | null = null;
  let error: any = null;

  if (isEmail && emailValue) {
    // Try the common `email` column first; if the remote schema uses
    // `owner_email` instead, fall back to that column.
    try {
      const res = await query.eq('email', emailValue);
      data = res.data;
      error = res.error;
      if (error && String(error.message || '').toLowerCase().includes('column')) {
        // fallback to owner_email
        const res2 = await supabase.from('companies').select('*').eq('owner_email', emailValue);
        data = res2.data;
        error = res2.error;
      }
    } catch (e) {
      console.warn('Supabase company lookup failed on email query, trying owner_email fallback:', e);
      const res2 = await supabase.from('companies').select('*').eq('owner_email', emailValue);
      data = res2.data;
      error = res2.error;
    }
  } else if (phoneValue) {
    const res = await query.eq('owner_phone', phoneValue);
    data = res.data;
    error = res.error;
  } else {
    const res = await query;
    data = res.data;
    error = res.error;
  }

  if (error) {
    console.warn('Supabase company lookup failed:', error.message || error);
    return [];
  }
  if (!data || !Array.isArray(data)) {
    return [];
  }

  const companies: Company[] = [];
  for (const row of data) {
    companies.push(await mapSupabaseCompanyToCompany(row));
  }

  return companies;
}

async function getCompanyStaffFromSupabase(companyId: string): Promise<Staff[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  let data: any[] | null = null;
  let error: any = null;

  const response = await supabase.from('staff').select('*').eq('company_id', companyId);
  data = response.data;
  error = response.error;

  // If the remote schema doesn't have company_id or access is restricted,
  // attempt a few fallback strategies.
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    // If the error indicates the column is missing, fall back to store-based lookup
    if (msg.includes('company_id')) {
      console.warn('Supabase staff table does not support company_id, falling back to store-based lookup');
      const companyStoresResult = await getCompanyStores(companyId);
      const companyStores = Array.isArray(companyStoresResult) ? companyStoresResult : (companyStoresResult && (companyStoresResult as any).stores ? (companyStoresResult as any).stores : []);
      const storeIds = (companyStores || []).map((store) => (store as any).id).filter(Boolean);
      if (storeIds.length === 0) {
        return [];
      }

      const storeResponse = await supabase.from('staff').select('*').in('store_id', storeIds);
      data = storeResponse.data;
      error = storeResponse.error;
    }

    // If permission denied on the anon client, try the admin client if available
    if (error && String(error.message || '').toLowerCase().includes('permission denied')) {
      console.warn('Permission denied querying staff with anon key; attempting supabaseAdmin if available');
      try {
        const adminClient: any = (typeof supabaseAdmin !== 'undefined' && supabaseAdmin) ? supabaseAdmin : null;
        if (adminClient) {
          const adminResp = await adminClient.from('staff').select('*').eq('company_id', companyId);
          data = adminResp.data;
          error = adminResp.error;
        } else {
          console.warn('supabaseAdmin not available in this environment; cannot query staff remotely');
          return [];
        }
      } catch (adminErr) {
        console.warn('supabaseAdmin staff lookup failed:', adminErr);
        return [];
      }
    }

    if (error) {
      console.warn('Supabase company staff lookup failed:', error.message || error);
      return [];
    }
  }
  if (!data || !Array.isArray(data)) return [];
  return await upsertLocalStaffFromSupabase(data);
}

async function createStaffAuthUser(staff: Staff): Promise<string | null> {
  const email = normalizeEmail(staff.email);
  if (!isSupabaseConfigured() || !email || !staff.employeePin) {
    return null;
  }

  const authRole = staff.role === 'owner' || staff.role === 'manager' ? staff.role : 'staff';

  const payload = {
    email,
    pin: staff.employeePin,
    companyId: staff.companyId,
    storeId: staff.storeId,
    name: staff.name,
    staffPhone: staff.phone || undefined,
    role: authRole,
  };

  const { data: rawFnResult, error: functionError } = await invokeAdminSignup(payload);

  if (functionError) {
    console.error('Failed to create staff auth user via admin-signup (direct fetch):', functionError);
    return null;
  }

  const fnNormalized = normalizeAdminSignupResponse(rawFnResult);
  return fnNormalized.user_id || fnNormalized.user?.id || null;
}

// Staff rows are synced to Supabase with the key fields required for remote login.
// Staff records must provide:
//   company_id, store_id, role, phone/email, employee_pin
// When an email exists, the same email + PIN can be used for Supabase auth login.
async function createStaffInSupabase(staff: Staff): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }

  if (!staff.companyId && staff.storeId) {
    const store = await dexieDb.stores.get(staff.storeId);
    if (store && (store as any).companyId) {
      staff.companyId = (store as any).companyId;
    }
  }

  await ensureCompanyExistsInSupabase(staff.companyId);

  const authUserId = await createStaffAuthUser(staff);
  if (staff.email && staff.employeePin && !authUserId) {
    throw new Error('Failed to create staff auth user');
  }

  if (authUserId) {
    staff.authUserId = authUserId;
  }

  if (!staff.storeId) {
    console.warn('Skipping Supabase staff sync for staff without store assignment:', staff.name);
    return;
  }

  const row: Record<string, unknown> = {
    id: staff.id,
    company_id: staff.companyId,
    store_id: staff.storeId,
    name: staff.name,
    email: staff.email,
    role: staff.role === 'owner' || staff.role === 'manager' ? staff.role : 'staff',
    phone: staff.phone,
    is_active: staff.isActive !== false,
    auth_user_id: authUserId,
    created_at: staff.createdAt.toISOString(),
    updated_at: staff.updatedAt.toISOString(),
  };

  if (typeof staff.employeePin === 'string' && staff.employeePin.trim()) {
    row.pin_hash = buildStaffPassword(staff.employeePin);
  }

  const client: any = (typeof supabaseAdmin !== 'undefined' && supabaseAdmin) ? supabaseAdmin : supabase;

  // Attempt to upsert using available clients, with fallbacks for schema/permission drift.
  let didSync = false;
  try {
    // Try upsert without an explicit ON CONFLICT target so PostgREST will use the
    // table primary key if present. Some remote schemas don't have a unique
    // constraint named `id`, which causes 42P10 when specifying onConflict: 'id'.
    const upsertRes = await client.from('staff').upsert(row);
    if (!upsertRes.error) {
      didSync = true;
      return;
    }

    const error = upsertRes.error;
    const msg = String(error.message || '');
    console.warn('Upsert staff returned error (client):', msg, error);

    // If ON CONFLICT isn't supported by the remote schema (42P10), try a plain insert
    if (String(error.code || '').toUpperCase() === '42P10' || msg.toLowerCase().includes('on conflict')) {
      const { error: insertErr } = await client.from('staff').insert(row);
      if (!insertErr) {
        didSync = true;
        return;
      }
      console.warn('Fallback insert also failed (client):', insertErr);
    } else {
      if (msg.toLowerCase().includes('permission denied')) {
        console.warn('Permission denied when syncing staff with current client; will attempt admin fallback.');
      } else {
        console.warn('Unhandled upsert error, will attempt admin/function fallbacks.');
      }
    }
  } catch (clientErr) {
    console.warn('Client upsert attempt failed:', clientErr);
  }

  // If not synced yet, try the explicit admin client if available
  if (!didSync) {
    try {
      if (typeof supabaseAdmin !== 'undefined' && supabaseAdmin && client !== supabaseAdmin) {
        const { error: adminError } = await supabaseAdmin.from('staff').upsert(row, { onConflict: 'id' });
        if (!adminError) {
          didSync = true;
          return;
        }
        console.warn('supabaseAdmin upsert failed:', adminError);
      }
    } catch (adminErr) {
      console.warn('supabaseAdmin upsert attempt failed:', adminErr);
    }
  }

  // Final fallback: invoke an Edge Function (admin-sync-staff) which performs the admin-side upsert
  if (!didSync) {
    try {
      const { data: fnData, error: fnError } = await invokeFunction('admin-sync-staff', row);

      if (fnError) {
        console.warn('admin-sync-staff function invocation error:', fnError);
        throw fnError;
      }

      if (fnData && (fnData.error || fnData.error_message)) {
        console.warn('admin-sync-staff returned error payload:', fnData);
        throw new Error('Function returned error: ' + JSON.stringify(fnData));
      }

      // success via function
      return;
    } catch (fnErr) {
      console.warn('Function fallback failed for staff sync:', fnErr);
      throw fnErr;
    }
  }
}

/**
 * Get company by owner phone number
 * Used for boss login authentication
 */
export async function getCompanyByOwnerPhone(phone: string): Promise<Company | null> {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  try {
    const companies = await dexieDb.companies.where('ownerPhone').equals(normalizedPhone).toArray();
    if (companies.length > 0) {
      return companies[0];
    }
  } catch (error) {
    // Continue to fallback if indexed query fails.
  }

  const allCompanies = await dexieDb.companies.toArray();
  const localMatch = allCompanies.find((company) => normalizePhone(company.ownerPhone) === normalizedPhone);
  if (localMatch) {
    if (isSupabaseConfigured()) {
      const remoteCompanies = await getCompanyFromSupabaseByOwnerIdentifier(normalizedPhone);
      if (remoteCompanies.length > 0) {
        return remoteCompanies[0];
      }
    }
    return localMatch;
  }

  if (!isSupabaseConfigured()) {
    return null;
  }

  const remoteCompanies = await getCompanyFromSupabaseByOwnerIdentifier(normalizedPhone);
  return remoteCompanies.length > 0 ? remoteCompanies[0] : null;
}

/**
 * Device-level company lock.
 * Once a shop creates/joins a company on this device, that company id is permanent
 * for tenant users — they only ever see their own company locally.
 */
export const DEVICE_COMPANY_KEY = 'mthunzi_device_company_id';

export function getDeviceCompanyId(): string {
  try {
    return String(localStorage.getItem(DEVICE_COMPANY_KEY) || '').trim();
  } catch {
    return '';
  }
}

/** Permanently bind this browser/device to one company (tenant isolation). */
export async function bindDeviceToCompany(companyId: string): Promise<void> {
  const id = String(companyId || '').trim();
  if (!id) return;
  try {
    localStorage.setItem(DEVICE_COMPANY_KEY, id);
  } catch {
    /* ignore */
  }
  await pruneLocalDataForCompany(id);
}

export function clearDeviceCompanyBinding(): void {
  try {
    localStorage.removeItem(DEVICE_COMPANY_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Prune local Dexie and localStorage data so only records for `companyId` remain.
 * This prevents leaking other tenants' cached data to the newly-logged-in user.
 */
export async function pruneLocalDataForCompany(companyId: string): Promise<void> {
  if (!companyId) return;

  try {
    await dexieDb.transaction('rw', dexieDb.companies, dexieDb.stores, dexieDb.staff, async () => {
      const companies = await dexieDb.companies.toArray();
      for (const c of companies) {
        if (String(c.id) !== String(companyId)) {
          try { await dexieDb.companies.delete(c.id); } catch { /* ignore */ }
        }
      }

      const stores = await dexieDb.stores.toArray();
      for (const s of stores) {
        const sid = (s as any).id;
        const scid = (s as any).companyId || (s as any).company_id;
        if (scid && String(scid) !== String(companyId)) {
          try { await dexieDb.stores.delete(sid); } catch { /* ignore */ }
        }
      }

      const staffRows = await dexieDb.staff.toArray();
      for (const st of staffRows) {
        const stid = (st as any).id;
        const stcid = (st as any).companyId || (st as any).company_id;
        if (stcid && String(stcid) !== String(companyId)) {
          try { await dexieDb.staff.delete(stid); } catch { /* ignore */ }
        }
      }
    });

    // Also filter legacy localStorage caches used by the app
    const filterLocalArray = (key: string) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return;
        const filtered = arr.filter((it: any) => !it || String(it.companyId || it.company_id || '') === String(companyId));
        localStorage.setItem(key, JSON.stringify(filtered));
      } catch (e) {
        // ignore
      }
    };

    filterLocalArray('mthunzi_companies');
    filterLocalArray('mthunzi_stores');
    filterLocalArray('mthunzi_staff');
    filterLocalArray('mthunzi_users');

    // Update settings cache to reference current company
    try {
      const rawSettings = localStorage.getItem('mthunzi_settings');
      if (rawSettings) {
        const s = JSON.parse(rawSettings);
        s.companyId = companyId;
        localStorage.setItem('mthunzi_settings', JSON.stringify(s));
      }
    } catch (e) {
      // ignore
    }

    console.log('Pruned local caches to company', companyId);
  } catch (err) {
    console.error('Failed to prune local data for company', companyId, err);
  }
}

/**
 * Clear all tenant-related local caches (companies, stores, staff, users).
 * Useful on logout or when resetting the app to a clean state.
 */
export async function clearAllLocalTenantData(): Promise<void> {
  try {
    await dexieDb.transaction('rw', dexieDb.companies, dexieDb.stores, dexieDb.staff, async () => {
      await dexieDb.companies.clear();
      await dexieDb.stores.clear();
      await dexieDb.staff.clear();
    });

    // Remove legacy localStorage caches (keep device company lock separately)
    try {
      localStorage.removeItem('mthunzi_companies');
      localStorage.removeItem('mthunzi_stores');
      localStorage.removeItem('mthunzi_staff');
      localStorage.removeItem('mthunzi_users');
    } catch (e) {
      // ignore
    }

    console.log('Cleared all local tenant caches');
  } catch (err) {
    console.error('Failed to clear all local tenant data', err);
  }
}

export async function getCompanyByOwnerIdentifier(identifier: string): Promise<Company | null> {
  const normalized = identifier.trim();
  if (!normalized) return null;

  const isEmail = normalized.includes('@');
  if (!isEmail) {
    return await getCompanyByOwnerPhone(normalized);
  }

  const companies = await dexieDb.companies.toArray();
  const localMatch = companies.find((company) => normalizeEmail(company.email || '') === normalizeEmail(normalized));
  if (localMatch) {
    if (isSupabaseConfigured()) {
      const remoteCompanies = await getCompanyFromSupabaseByOwnerIdentifier(normalized);
      if (remoteCompanies.length > 0) {
        return remoteCompanies[0];
      }
    }
    return localMatch;
  }

  if (!isSupabaseConfigured()) {
    return null;
  }

  const remoteCompanies = await getCompanyFromSupabaseByOwnerIdentifier(normalized);
  return remoteCompanies.length > 0 ? remoteCompanies[0] : null;
}

/**
 * Create a new company (for a boss/owner)
 * Example: Company Chacha with 6 stores
 */
async function upsertCompanyInSupabase(company: Company): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }
  const row: any = {
    id: company.id,
    name: company.name,
    owner_id: company.ownerId,
    owner_phone: company.ownerPhone,
    owner_pin: company.ownerPin,
    phone: company.phone,
    email: company.email,
    address: company.address,
    logo_url: company.logoUrl,
    currency: company.currency,
    currency_symbol: company.currencySymbol,
    base_currency: company.baseCurrency,
    plan: company.plan,
    subscription_status: company.subscriptionStatus || 'active',
    subscription_expires_at: company.subscriptionExpiresAt
      ? toIsoString(company.subscriptionExpiresAt as any)
      : null,
    subscription_plan: company.subscriptionPlan || 'business',
    monthly_price_usd: company.monthlyPriceUsd ?? null,
    host_status: company.hostStatus || 'active',
    host_status_reason: company.hostStatusReason || null,
    assigned_store_id: company.assignedStoreId,
    tax_rate: company.taxRate,
    sales_tax_mode: company.salesTaxMode,
    sales_tax_rate: company.salesTaxRate,
    single_item_margin_percent: company.singleItemMarginPercent,
    receipt_footer: company.receiptFooter,
    thermal_printer_width: company.thermalPrinterWidth,
    admin_pin: company.adminPin,
    pin_setup_complete: company.pinSetupComplete,
    is_active: company.isActive,
    created_at: toIsoString(company.createdAt),
    updated_at: toIsoString(company.updatedAt),
    parallel_enabled: company.parallel_enabled ?? false,
    parallel_source: company.parallel_source ?? 'mthunzi_pos',
    parallel_status: company.parallel_status ?? 'disabled',
    dashboard_user_limit: company.dashboard_user_limit ?? 0,
  };

  const client: any = (typeof supabaseAdmin !== 'undefined' && supabaseAdmin) ? supabaseAdmin : supabase;

  try {
    const { error } = await client.from('companies').upsert(row, { onConflict: 'id' });
    if (error) {
      // Handle unique constraint violations (e.g., owner_phone already present)
      const code = String(error.code || '');
      const msg = String(error.message || '');
      const details = String((error as any).details || '');

      console.warn('Failed to sync company to Supabase (upsert):', error);

      // If duplicate key violation on owner_phone, try to find the existing
      // company by owner_phone and update it instead of inserting a new row.
      if (code === '23505' || msg.toLowerCase().includes('duplicate key') || details.toLowerCase().includes('owner_phone')) {
        if (!company.ownerPhone) {
          return false;
        }

        try {
          const lookup = await client.from('companies').select('id').eq('owner_phone', company.ownerPhone).limit(1).maybeSingle();
          const existing = (lookup && (lookup.data || lookup)) ? (lookup.data || lookup) : null;
          const existingId = existing ? (existing.id || existing?.[0]?.id) : null;

          if (existingId) {
            const updateRow = { ...row } as any;
            delete updateRow.id; // don't attempt to change PK
            if (updateRow.created_at) delete updateRow.created_at;

            const { error: updateErr } = await client.from('companies').update(updateRow).eq('id', existingId);
            if (updateErr) {
              console.warn('Failed to update existing company (owner_phone match):', updateErr);
              return false;
            }

            return true;
          }
        } catch (lookupErr) {
          console.warn('Failed to lookup existing company by owner_phone during upsert fallback:', lookupErr);
          return false;
        }
      }

      return false;
    }

    return true;
  } catch (e) {
    console.warn('Unexpected error while syncing company to Supabase:', e);
    return false;
  }
}

async function ensureCompanyExistsInSupabase(companyId?: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }

  if (!companyId) {
    console.warn('Cannot ensure company exists in Supabase: missing companyId');
    return;
  }

  const { data, error } = await supabase.from('companies').select('id').eq('id', companyId).limit(1).single();
  if (error && !String(error.message).toLowerCase().includes('null')) {
    console.warn('Company existence check failed in Supabase:', error.message || error);
  }

  if (!data) {
    const company = await dexieDb.companies.get(companyId);
    if (!company) {
      console.warn('Local company missing when trying to ensure remote company exists:', companyId);
      return;
    }
    console.log('Remote company missing, creating company in Supabase first:', company.name, companyId);
    await upsertCompanyInSupabase(company);
  }
}

export async function createCompany(args: {
  name: string;
  ownerPhone?: string; // E.g., "0971112222" for phone + PIN login
  ownerPin?: string; // Boss/admin PIN for the owner
  phone?: string;
  email?: string;
  address?: string;
  currency?: string;
  currencySymbol?: string;
  logoUrl?: string;
}): Promise<Company> {
  const company: Company = {
    id: crypto.randomUUID(),
    name: args.name,
    ownerPhone: normalizePhone(args.ownerPhone),
    ownerPin: normalizePin(args.ownerPin),
    phone: args.phone,
    email: args.email,
    address: args.address,
    logoUrl: args.logoUrl,
    currency: args.currency || 'ZMW',
    currencySymbol: args.currencySymbol || 'K',
    baseCurrency: args.currency || 'ZMW',
    plan: 'free',
    userRole: 'owner',
    assignedStoreId: null,
    taxRate: 0,
    salesTaxMode: 'none',
    salesTaxRate: 0,
    singleItemMarginPercent: 0,
    receiptFooter: '',
    thermalPrinterWidth: '58mm',
    parallel_enabled: false,
    parallel_source: 'mthunzi_pos',
    parallel_status: 'disabled',
    dashboard_user_limit: 0,
    adminPin: null,
    pinSetupComplete: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let remoteCompanySaved = false;
  if (isSupabaseConfigured()) {
    try {
      try {
        await ensureSchemaValid();
      } catch (e) {
        console.warn('Schema validation failed while creating company:', e);
      }

      remoteCompanySaved = await upsertCompanyInSupabase(company);
    } catch (err) {
      console.warn('Remote company sync failed; will fall back to local persistence:', err);
    }
  }

  // Mirror locally after the remote write completes.
  await dexieDb.companies.put(company);

  if (remoteCompanySaved && isSupabaseConfigured()) {
    try {
      const defaultStoreName = `${company.name} - Main Store`;
      const storeResult = await createCompanyStore({
        name: defaultStoreName,
        location_name: 'Main Location',
        address: company.address || '',
        phone: company.phone || company.ownerPhone || '',
        currency: company.currency,
        currency_symbol: company.currencySymbol,
        is_public: true,
      }, company.id);

      if (storeResult?.success && storeResult.store?.id) {
        company.assignedStoreId = storeResult.store.id;
        await dexieDb.companies.put(company);
      }
    } catch (storeErr) {
      console.warn('Failed to create default store while creating company:', storeErr);
    }

    try {
      let remoteRow: any = null;
      try {
        const { data, error } = await supabase.from('companies').select('*').eq('id', company.id).limit(1).single();
        if (!error && data) remoteRow = data;
      } catch (e) {}

      if (!remoteRow && typeof supabaseAdmin !== 'undefined' && supabaseAdmin) {
        try {
          const adminRes: any = await supabaseAdmin.from('companies').select('*').eq('id', company.id).limit(1).single();
          if (!adminRes.error && adminRes.data) remoteRow = adminRes.data;
        } catch (e) {}
      }

      if (remoteRow) {
        await mapSupabaseCompanyToCompany(remoteRow);
      }
    } catch (err) {
      console.warn('Failed to canonicalize company from Supabase (background):', err);
    }
  }

  return company;
}

/**
 * Get company by ID
 */
export async function getCompany(companyId: string): Promise<Company | undefined> {
  return dexieDb.companies.get(companyId);
}

export async function getCompanyById(companyId: string): Promise<Company | null> {
  if (!companyId) return null;

  const localCompany = await dexieDb.companies.get(companyId);
  if (localCompany) return localCompany;

  if (!isSupabaseConfigured()) return null;

  const { data, error } = await supabase.from('companies').select('*').eq('id', companyId).limit(1).single();
  if (error || !data) {
    console.warn('Supabase company lookup by ID failed:', error?.message || error);
    return null;
  }

  return await mapSupabaseCompanyToCompany(data);
}

/**
 * Get all companies (for admin/multi-tenant views)
 */
export async function getAllCompanies(): Promise<Company[]> {
  return dexieDb.companies.toArray();
}

/**
 * List companies visible to the current user.
 * Non–super-admins only ever see their own company (settings + device lock);
 * foreign local cache rows are pruned. Super admins may see all companies.
 */
export async function listCompaniesForCurrentUser(opts: {
  companyId?: string | null;
  userRole?: string | null;
}): Promise<Company[]> {
  const isSuperAdmin = opts.userRole === 'super_admin';
  const settingsCompanyId = opts.companyId ? String(opts.companyId) : '';
  const deviceCompanyId = getDeviceCompanyId();
  const companyId = settingsCompanyId || deviceCompanyId;

  if (!isSuperAdmin && companyId) {
    // Keep device lock permanent and scoped.
    if (deviceCompanyId && settingsCompanyId && deviceCompanyId !== settingsCompanyId) {
      // Prefer the permanent device lock — never swap to another tenant on this machine.
      await bindDeviceToCompany(deviceCompanyId);
    } else {
      await bindDeviceToCompany(companyId);
    }
    const lockedId = getDeviceCompanyId() || companyId;
    const own = await getCompanyById(lockedId);
    if (own) return [own];

    // Local miss — try remote for this company only (never select *)
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase.from('companies').select('*').eq('id', lockedId).maybeSingle();
        if (!error && data) {
          const mapped = await mapSupabaseCompanyToCompany(data);
          return [mapped];
        }
      } catch (e) {
        console.warn('Scoped company fetch failed:', e);
      }
    }
    return [];
  }

  if (!isSuperAdmin) {
    // Logged in without a company binding — show nothing rather than leak tenants
    return [];
  }

  // Super admin: full catalog
  let companies = await getAllCompanies();
  if (companies.length === 0) {
    companies = await fetchCompaniesFromSupabase(undefined, { allowUnscoped: true });
  }
  return companies;
}

/**
 * Update company settings
 */
export async function updateCompany(id: string, updates: Partial<Company>): Promise<Company> {
  const existing = await dexieDb.companies.get(id);
  if (!existing) throw new Error('Company not found');

  const updated: Company = {
    ...existing,
    ...updates,
    ownerPhone: updates.ownerPhone ? normalizePhone(updates.ownerPhone) : existing.ownerPhone,
    ownerPin: updates.ownerPin !== undefined ? normalizePin(updates.ownerPin) : existing.ownerPin,
    id, // immutable
    createdAt: existing.createdAt, // immutable
    updatedAt: new Date(),
  };

  // Persist locally first
  await dexieDb.companies.put(updated);

  // Background sync to Supabase
  (async () => {
    if (!isSupabaseConfigured()) return;
    try {
      await upsertCompanyInSupabase(updated);
    } catch (err) {
      console.warn('Background company update to Supabase failed:', err);
    }
  })();

  return updated;
}

/**
 * Delete a company
 * WARNING: This will also unassign all stores from this company
 */
export async function deleteCompany(id: string): Promise<void> {
  const company = await dexieDb.companies.get(id);
  if (!company) throw new Error('Company not found');

  // Unassign all stores from this company
  const allStores = await dexieDb.stores.toArray();
  const companyStores = allStores.filter((store: any) => store.companyId === id);

  for (const store of companyStores) {
    const updated = { ...store, companyId: undefined, updated_at: new Date().toISOString() };
    await dexieDb.stores.put(updated);
  }

  // Delete locally first (do not block user)
  await dexieDb.companies.delete(id);

  // Attempt remote delete in background
  (async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const { error } = await supabase.from('companies').delete().eq('id', id);
      if (error) console.warn('Failed to delete company from Supabase (background):', error.message || error);
    } catch (error) {
      console.warn('Supabase delete company failed (background):', error);
    }
  })();
}

// ============================================================================
// STAFF OPERATIONS
// ============================================================================

/**
 * Add staff member to a company (owner/boss) or store/department (worker)
 * 
 * Boss example:
 *   { companyId, name: "Director John", email: "director@example.com", role: "owner" }
 * 
 * Worker example:
 *   { storeId, departmentId, name: "Cashier Jane", phone: "0971222222", role: "cashier" }
 */
export async function addStaff(args: {
  companyId?: string; // For boss/owner
  storeId?: string; // For store staff
  departmentId?: string; // Which department they work in
  name: string;
  phone?: string; // E164 format preferred (optional)
  email: string; // prefer email for staff identity
  role: 'owner' | 'manager' | 'salesperson' | 'cashier' | 'delivery' | 'other';
  employeeId?: string;
  employeePin?: string;
  isManager?: boolean;
}): Promise<Staff> {
  if (!args.companyId && !args.storeId) {
    throw new Error('Either companyId (boss) or storeId (worker) is required');
  }

  const staff: Staff = {
    id: crypto.randomUUID(),
    companyId: args.companyId,
    storeId: args.storeId,
    departmentId: args.departmentId,
    name: args.name,
    phone: args.phone ? normalizePhone(args.phone) || args.phone : undefined,
    email: normalizeEmail(args.email),
    role: args.role,
    employeePin: normalizePin(args.employeePin),
    employeeId: args.employeeId,
    isPinVerified: false,
    isManager: args.isManager || false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let remoteStaffSaved = false;
  if (isSupabaseConfigured()) {
    try {
      await ensureSchemaValid();
      await createStaffInSupabase(staff);
      remoteStaffSaved = true;
    } catch (err) {
      console.warn('Remote staff sync failed; will fall back to local persistence:', err);
    }
  }

  // Mirror locally after the remote write completes, or save locally when offline.
  await dexieDb.staff.put(staff);

  if (remoteStaffSaved) {
    try {
      const identifier = staff.email ?? staff.phone ?? staff.id;
      let canonical: Staff[] = [];
      if (identifier) canonical = await getStaffFromSupabaseByIdentifier(String(identifier));
      if ((!canonical || canonical.length === 0) && staff.companyId) canonical = await getCompanyStaffFromSupabase(staff.companyId);
      if (canonical && canonical.length > 0) {
        const match = canonical.find((s) => (staff.email && s.email === staff.email) || (staff.phone && s.phone === staff.phone) || s.id === staff.id) || canonical[0];
        if (match) await dexieDb.staff.put(match);
      }
    } catch (e) {
      console.warn('Background canonicalize staff failed:', e);
    }
  }

  return staff;
}

/**
 * Get staff member by ID
 */
export async function getStaff(staffId: string): Promise<Staff | undefined> {
  return dexieDb.staff.get(staffId);
}

/**
 * Get staff by phone number (for phone + PIN login)
 * Returns all staff records with this phone (may exist across multiple stores/companies)
 */
export async function getStaffByPhone(phone: string): Promise<Staff[]> {
  const normalizedPhone = normalizePhone(phone);
  const localStaff = normalizedPhone ? await dexieDb.staff.where('phone').equals(normalizedPhone).toArray() : [];

  if (!isSupabaseConfigured()) {
    return localStaff;
  }

  try {
    const supabaseStaff = await getStaffFromSupabaseByIdentifier(normalizedPhone ?? '');
    return [...localStaff, ...supabaseStaff].filter(
      (staff, index, self) => self.findIndex((item) => item.id === staff.id) === index
    );
  } catch (error) {
    console.warn('Supabase staff lookup fallback failed:', error);
    return localStaff;
  }
}

export async function getStaffByIdentifier(identifier: string): Promise<Staff[]> {
  const normalizedId = identifier.trim();
  const isEmail = normalizedId.includes('@');

  const localStaff = isEmail
    ? await dexieDb.staff.where('email').equals(normalizeEmail(normalizedId) ?? '').toArray()
    : await dexieDb.staff.where('phone').equals(normalizePhone(normalizedId) ?? '').toArray();

  if (!isSupabaseConfigured()) {
    return localStaff;
  }

  try {
    const supabaseStaff = await getStaffFromSupabaseByIdentifier(normalizedId);
    return [...localStaff, ...supabaseStaff].filter(
      (staff, index, self) => self.findIndex((item) => item.id === staff.id) === index
    );
  } catch (error) {
    console.warn('Supabase staff lookup fallback failed:', error);
    return localStaff;
  }
}

/**
 * Get all staff for a company (boss view - see all workers across all stores)
 */
export async function getCompanyStaff(companyId: string): Promise<Staff[]> {
  // Try indexed query first; fall back to full table scan if index is missing or query fails
  let localStaff: Staff[] = [];
  try {
    localStaff = await dexieDb.staff.where('companyId').equals(companyId).toArray();
  } catch (dexieErr) {
    console.warn('Dexie companyId index missing or query failed for staff, falling back to full scan:', dexieErr);
    const all = await dexieDb.staff.toArray();
    localStaff = (all as Staff[]).filter((s) => s.companyId === companyId);
  }

  if (!isSupabaseConfigured()) {
    return localStaff;
  }

  try {
    const supabaseStaff = await getCompanyStaffFromSupabase(companyId);
    return [...localStaff, ...supabaseStaff].filter(
      (staff, index, self) => self.findIndex((item) => item.id === staff.id) === index
    );
  } catch (error) {
    console.warn('Supabase company staff lookup failed:', error);
    return localStaff;
  }
}

/**
 * Get all staff for a store
 */
export async function getStoreStaff(storeId: string): Promise<Staff[]> {
  return dexieDb.staff.where('storeId').equals(storeId).toArray();
}

/**
 * Get staff for a specific department
 */
export async function getDepartmentStaff(departmentId: string): Promise<Staff[]> {
  return dexieDb.staff.where('departmentId').equals(departmentId).toArray();
}

/**
 * Update staff info
 */
export async function updateStaff(id: string, updates: Partial<Staff>): Promise<Staff> {
  const existing = await dexieDb.staff.get(id);
  if (!existing) throw new Error('Staff not found');

  const updated: Staff = {
    ...existing,
    ...updates,
    id, // immutable
    createdAt: existing.createdAt, // immutable
    updatedAt: new Date(),
  };

  await dexieDb.staff.put(updated);

  // Sync to Supabase if configured
  if (isSupabaseConfigured()) {
    try {
      await createStaffInSupabase(updated);
    } catch (error) {
      console.error('Failed to sync staff update to Supabase:', error);
    }
  }

  return updated;
}

/**
 * Delete staff member
 */
export async function deleteStaff(id: string): Promise<void> {
  await dexieDb.staff.delete(id);

  // Delete from Supabase if configured
  if (isSupabaseConfigured()) {
    try {
      const { error } = await supabase.from('staff').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      console.error('Failed to delete staff from Supabase:', error);
    }
  }
}

/**
 * Fetch companies from Supabase.
 * Pass `companyId` to fetch a single tenant (required for non–super-admin syncs).
 * Unscoped fetch is blocked unless `allowUnscoped` is true (platform master only).
 */
export async function fetchCompaniesFromSupabase(
  companyId?: string,
  opts?: { allowUnscoped?: boolean }
): Promise<Company[]> {
  if (!isSupabaseConfigured()) {
    console.log('Supabase not configured, skipping company fetch');
    return [];
  }

  if (!companyId && !opts?.allowUnscoped) {
    const locked = getDeviceCompanyId();
    if (!locked) {
      console.warn('Blocked unscoped companies fetch — pass companyId or allowUnscoped');
      return [];
    }
    companyId = locked;
  }

  try {
    let query = supabase.from('companies').select('*');
    if (companyId) {
      query = query.eq('id', companyId);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('Supabase companies table might not exist, skipping:', error.message);
      return [];
    }

    if (!data || data.length === 0) {
      console.log('No companies found in Supabase');
      return [];
    }

    const companies: Company[] = [];
    for (const row of data) {
      const company = await mapSupabaseCompanyToCompany(row);
      companies.push(company);
    }

    console.log(`✓ Synced ${companies.length} companies from Supabase`);
    return companies;
  } catch (error) {
    console.warn('Failed to fetch companies from Supabase (table might not exist):', error);
    return [];
  }
}

/**
 * Fetch all stores from Supabase
 */
export async function fetchStoresFromSupabase(companyId?: string): Promise<Store[]> {
  if (!isSupabaseConfigured()) {
    console.log('Supabase not configured, skipping store fetch');
    return [];
  }

  try {
    let query = supabase.from('stores').select('*');
    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('Supabase stores table might not exist, skipping:', error.message);
      return [];
    }

    if (!data || data.length === 0) {
      console.log('No stores found in Supabase');
      return [];
    }

    const stores = data.map(mapSupabaseStoreToStore);

    // Save to local database for fast operations
    for (const store of stores) {
      await dexieDb.stores.put(store);
    }

    console.log(`✓ Synced ${stores.length} stores from Supabase`);
    return stores;
  } catch (error) {
    console.warn('Failed to fetch stores from Supabase (table might not exist):', error);
    return [];
  }
}

/**
 * Fetch all staff from Supabase
 */
export async function fetchStaffFromSupabase(companyId?: string): Promise<Staff[]> {
  if (!isSupabaseConfigured()) {
    console.log('Supabase not configured, skipping staff fetch');
    return [];
  }

  try {
    let query = supabase.from('staff').select('*');
    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    const { data, error } = await query;

    if (error) {
      console.warn('Supabase staff table might not exist, skipping:', error.message);
      return [];
    }

    if (!data || data.length === 0) {
      console.log('No staff found in Supabase');
      return [];
    }

    const staff = data.map(mapSupabaseStaffToStaff);

    // Save to local database for fast operations
    for (const staffMember of staff) {
      await dexieDb.staff.put(staffMember);
    }

    console.log(`✓ Synced ${staff.length} staff from Supabase`);
    return staff;
  } catch (error) {
    console.warn('Failed to fetch staff from Supabase (table might not exist):', error);
    return [];
  }
}

/**
 * Sync all data from Supabase to local device
 */
export async function syncFromSupabase(companyId?: string): Promise<void> {
  console.log('Starting sync from Supabase...');

  await Promise.all([
    fetchCompaniesFromSupabase(companyId),
    fetchStoresFromSupabase(companyId),
    fetchStaffFromSupabase(companyId),
  ]);

  console.log('✓ Sync from Supabase complete');
}

/**
 * Sync all local data TO Supabase
 * Use this to migrate existing local data to Supabase
 */
export async function syncToSupabase(): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.log('Supabase not configured, skipping sync to Supabase');
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    console.log('No active Supabase session, skipping sync to Supabase');
    return;
  }

  console.log('Starting sync to Supabase...');

  // Auto-heal schema before sync
  console.log('Validating and repairing Supabase schema...');
  const schemaResult = await ensureSchemaValid();
  if (!schemaResult.isValid) {
    if (schemaResult.repairSQL) {
      console.error('Schema validation failed. Please run the following SQL in Supabase SQL Editor:');
      console.error('--- COPY BELOW ---');
      console.error(schemaResult.repairSQL);
      console.error('--- END COPY ---');
      throw new Error('Schema validation failed. Please run the repair SQL shown in console.');
    } else {
      console.error('Supabase not configured. Sync aborted.');
      return;
    }
  }
  console.log('Schema validated successfully');

  try {
    // Sync companies
    const localCompanies = await dexieDb.companies.toArray();
    console.log(`Found ${localCompanies.length} local companies to sync`);
    for (const company of localCompanies) {
      try {
        // Only send columns that exist in Supabase to avoid schema errors
        const companyData: any = {
          id: company.id,
          name: company.name,
          owner_phone: company.ownerPhone,
          owner_pin: company.ownerPin,
          phone: company.phone,
          email: company.email,
          logo_url: company.logoUrl,
          currency: company.currency,
          currency_symbol: company.currencySymbol,
          base_currency: company.baseCurrency,
          plan: company.plan,
          tax_rate: company.taxRate,
          sales_tax_mode: company.salesTaxMode,
          sales_tax_rate: company.salesTaxRate,
          single_item_margin_percent: company.singleItemMarginPercent,
          receipt_footer: company.receiptFooter,
          thermal_printer_width: company.thermalPrinterWidth,
          admin_pin: company.adminPin,
          pin_setup_complete: company.pinSetupComplete,
          is_active: company.isActive,
        };
        if (company.createdAt) companyData.created_at = company.createdAt;
        if (company.updatedAt) companyData.updated_at = company.updatedAt;

        const { error } = await supabase.from('companies').upsert(companyData);
        if (error) throw error;
        console.log(`✓ Synced company: ${company.name}`);
      } catch (error) {
        console.error(`Failed to sync company ${company.name}:`, error);
      }
    }

    // Sync products
    const localProducts = await dexieDb.products.toArray();
    console.log(`Found ${localProducts.length} local products to sync`);
    for (const product of localProducts) {
      try {
        const productData: any = {
          id: product.id,
          company_id: (product as any).companyId || null,
          store_id: product.storeId,
          name: product.name,
          description: (product as any).description || null,
          sku: (product as any).sku || null,
          barcode: product.barcode,
          category_id: product.categoryIds?.[0] || null,
          price: (product as any).sellingPrice || product.sellingPrice || 0,
          cost_price: product.buyingPrice,
          stock_quantity: product.stock,
          min_stock_level: product.lowStockThreshold,
          unit: (product as any).unit || null,
          image_url: product.imageUrl,
          is_active: (product as any).isActive !== false,
        };
        if (product.createdAt) productData.created_at = product.createdAt;
        if (product.updatedAt) productData.updated_at = product.updatedAt;

        const { error } = await supabase.from('products').upsert(productData);
        if (error) throw error;
        console.log(`✓ Synced product: ${product.name}`);
      } catch (error) {
        console.error(`Failed to sync product ${product.name}:`, error);
      }
    }

    // Sync categories
    const localCategories = await dexieDb.categories.toArray();
    console.log(`Found ${localCategories.length} local categories to sync`);
    for (const category of localCategories) {
      try {
        const categoryData: any = {
          id: category.id,
          company_id: (category as any).companyId || null,
          store_id: category.storeId,
          name: category.name,
          description: (category as any).description || null,
          parent_id: (category as any).parentId || null,
          is_active: (category as any).isActive !== false,
        };
        if (category.createdAt) categoryData.created_at = category.createdAt;
        if ((category as any).updatedAt) categoryData.updated_at = (category as any).updatedAt;

        const { error } = await supabase.from('categories').upsert(categoryData);
        if (error) throw error;
        console.log(`✓ Synced category: ${category.name}`);
      } catch (error) {
        console.error(`Failed to sync category ${category.name}:`, error);
      }
    }

    // Sync sales
    const localSales = await dexieDb.sales.toArray();
    console.log(`Found ${localSales.length} local sales to sync`);
    for (const sale of localSales) {
      try {
        const saleData: any = {
          id: sale.id,
          company_id: (sale as any).companyId || null,
          store_id: sale.storeId,
          shift_id: sale.shiftId,
          staff_id: (sale as any).staffId || null,
          total_amount: sale.total || 0,
          payment_method: sale.paymentMethod,
          payment_status: (sale as any).paymentStatus || 'completed',
          notes: (sale as any).notes || null,
        };
        if (sale.createdAt) saleData.created_at = sale.createdAt;
        if ((sale as any).updatedAt) saleData.updated_at = (sale as any).updatedAt;

        const { error } = await supabase.from('sales').upsert(saleData);
        if (error) throw error;
        console.log(`✓ Synced sale: ${sale.id}`);
      } catch (error) {
        console.error(`Failed to sync sale ${sale.id}:`, error);
      }
    }

    // Sync stores
    const localStores = await dexieDb.stores.toArray();
    console.log(`Found ${localStores.length} local stores to sync`);
    for (const store of localStores) {
      try {
        const storeData: any = {
          id: store.id,
          company_id: (store as any).companyId || null,
          name: store.name,
          location_name: (store as any).location_name || null,
          category: (store as any).category || null,
          address: (store as any).address || null,
          phone: (store as any).phone || null,
          currency: (store as any).currency || 'ZMW',
          currency_symbol: (store as any).currency_symbol || 'K',
          payment_numbers: (store as any).payment_numbers || null,
          owner_id: (store as any).owner_id || null,
          store_code: (store as any).store_code || null,
          is_public: (store as any).is_public !== false,
          created_at: (store as any).created_at || new Date().toISOString(),
          updated_at: (store as any).updated_at || new Date().toISOString(),
        };

        const { error } = await supabase.from('stores').upsert(storeData);
        if (error) throw error;
        console.log(`✓ Synced store: ${store.name}`);
      } catch (error) {
        console.error(`Failed to sync store ${store.name}:`, error);
      }
    }

    // Sync staff
    const localStaff = await dexieDb.staff.toArray();
    console.log(`Found ${localStaff.length} local staff to sync`);
    for (const staffMember of localStaff) {
      try {
        await createStaffInSupabase(staffMember);
        console.log(`✓ Synced staff: ${staffMember.name}`);
      } catch (error) {
        console.error(`Failed to sync staff ${staffMember.name}:`, error);
      }
    }

    console.log('✓ Sync to Supabase complete');
  } catch (error) {
    console.error('Failed to sync to Supabbase:', error);
    throw error;
  }
}

// ============================================================================
// DEPARTMENT OPERATIONS
// ============================================================================

/**
 * Create a department within a store
 * Example: "Kitchen Dept", "Spare Parts Dept"
 */
export async function createDepartment(args: {
  storeId: string;
  name: string;
  description?: string;
  managerId?: string;
}): Promise<Department> {
  const dept: Department = {
    id: crypto.randomUUID(),
    storeId: args.storeId,
    name: args.name,
    description: args.description,
    managerId: args.managerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await dexieDb.departments.put(dept);
  return dept;
}

/**
 * Get department by ID
 */
export async function getDepartment(deptId: string): Promise<Department | undefined> {
  return dexieDb.departments.get(deptId);
}

/**
 * Get all departments for a store
 */
export async function getStoreDepartments(storeId: string): Promise<Department[]> {
  return dexieDb.departments.where('storeId').equals(storeId).toArray();
}

// ============================================================================
// SHIFT CLOCK IN/OUT OPERATIONS
// ============================================================================

/**
 * Clock in a worker at the start of their shift
 * Creates a ShiftLog record showing they're now active
 */
export async function clockInStaff(args: {
  companyId: string;
  storeId: string;
  staffId: string;
  staffPhone: string;
  staffName: string;
  departmentId?: string;
}): Promise<ShiftLog> {
  // Check if already clocked in (no existing active shift)
  const existingActive = await dexieDb.shiftLogs
    .where('staffId')
    .equals(args.staffId)
    .and((log) => log.status === 'active')
    .first();

  if (existingActive) {
    throw new Error(`${args.staffName} is already clocked in (since ${existingActive.clockInAt})`);
  }

  const log: ShiftLog = {
    id: crypto.randomUUID(),
    companyId: args.companyId,
    storeId: args.storeId,
    staffId: args.staffId,
    staffPhone: args.staffPhone,
    staffName: args.staffName,
    departmentId: args.departmentId,
    status: 'active',
    clockInAt: new Date(),
    breakDurationMinutes: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await dexieDb.shiftLogs.put(log);
  return log;
}

/**
 * Clock out a worker at the end of their shift
 * Marks the shift log as completed and calculates hours worked
 */
export async function clockOutStaff(shiftLogId: string): Promise<ShiftLog> {
  const existing = await dexieDb.shiftLogs.get(shiftLogId);
  if (!existing) throw new Error('Shift log not found');

  const clockOutAt = new Date();
  const hoursWorked = (clockOutAt.getTime() - existing.clockInAt.getTime()) / (1000 * 60 * 60);

  const updated: ShiftLog = {
    ...existing,
    status: 'completed',
    clockOutAt,
    hoursWorked: parseFloat(hoursWorked.toFixed(2)),
    updatedAt: new Date(),
  };

  await dexieDb.shiftLogs.put(updated);
  return updated;
}

/**
 * Get active shifts for a company (boss dashboard - "who's working right now?")
 */
export async function getActiveShiftsForCompany(companyId: string): Promise<ShiftLog[]> {
  try {
    return await dexieDb.shiftLogs
      .where('companyId')
      .equals(companyId)
      .and((log) => log.status === 'active')
      .toArray();
  } catch (dexieErr) {
    console.warn('Dexie companyId index missing or query failed for shiftLogs, falling back to full scan:', dexieErr);
    const all = await dexieDb.shiftLogs.toArray();
    return (all as ShiftLog[]).filter((log) => log.companyId === companyId && log.status === 'active');
  }
}

/**
 * Get active shifts for a store
 */
export async function getActiveShiftsForStore(storeId: string): Promise<ShiftLog[]> {
  return dexieDb.shiftLogs
    .where('storeId')
    .equals(storeId)
    .and((log) => log.status === 'active')
    .toArray();
}

/**
 * Get all shift history for a staff member
 */
export async function getStaffShiftHistory(staffId: string, limit?: number): Promise<ShiftLog[]> {
  const all = await dexieDb.shiftLogs.where('staffId').equals(staffId).toArray();
  const sorted = all.sort((a, b) => new Date(b.clockInAt).getTime() - new Date(a.clockInAt).getTime());
  return limit ? sorted.slice(0, limit) : sorted;
}

// ============================================================================
// COMPANY DASHBOARD / ANALYTICS
// ============================================================================

/**
 * Get company summary for a date
 * Shows total sales, profit, staff count across all stores
 */
export async function getCompanySummary(companyId: string, dateKey: string): Promise<CompanySalesSummary | undefined> {
  return dexieDb.companySalesSummary
    .where('[companyId+dateKey]')
    .equals([companyId, dateKey])
    .first();
}

/**
 * Calculate company summary by aggregating store sales
 * (normally done by database trigger, but we can compute it here for verification)
 */
export async function calculateCompanySummary(companyId: string, dateKey: string): Promise<CompanySalesSummary> {
  const company = await dexieDb.companies.get(companyId);
  if (!company) throw new Error('Company not found');

  // Get all stores for this company
  const stores = await dexieDb.stores.toArray();
  const companyStores = (stores as Array<{ companyId?: string; id: string }>).filter(
    (s) => s.companyId === companyId
  );

  // Sum sales for all stores on this date
  const { start, end } = localDayBounds(dateKey);
  const sales = await dexieDb.sales.toArray();
  const storeSalesIds = new Set(companyStores.map((s) => s.id));
  const daySales = sales.filter(
    (s) =>
      storeSalesIds.has(s.storeId) &&
      s.createdAt >= start &&
      s.createdAt <= end
  );

  const totalSales = daySales.reduce((sum, s) => sum + (s.total || 0), 0);
  const totalProfit = daySales.reduce((sum, s) => sum + (s.profit || 0), 0);
  const totalTransactions = daySales.length;

  const cashSales = daySales
    .filter((s) => s.paymentMethod === 'cash')
    .reduce((sum, s) => {
      const paid = s.amountPaid || (s.paymentMethod === 'cash' ? s.total : 0);
      return sum + Math.min(s.total, paid);
    }, 0);

  const cardSales = daySales
    .filter((s) => s.paymentMethod === 'card')
    .reduce((sum, s) => sum + (s.total || 0), 0);

  const mobileSales = daySales
    .filter((s) => s.paymentMethod === 'mobile')
    .reduce((sum, s) => sum + (s.total || 0), 0);

  const creditSales = daySales
    .filter((s) => s.paymentMethod === 'credit')
    .reduce((sum, s) => sum + (s.total || 0), 0);

  const activeStores = new Set(daySales.map((s) => s.storeId)).size;
  const activeShifts = await dexieDb.shiftLogs
    .where('companyId')
    .equals(companyId)
    .and((log) => log.status === 'active')
    .toArray();
  const activeStaff = new Set(activeShifts.map((s) => s.staffId)).size;

  const summary: CompanySalesSummary = {
    id: `company-summary-${companyId}-${dateKey}`,
    companyId,
    dateKey,
    totalSales,
    totalProfit,
    totalTransactions,
    numStoresActive: activeStores,
    numStaffActive: activeStaff,
    cashSales,
    cardSales,
    mobileSales,
    creditSales,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return summary;
}

/**
 * Get inventory alerts across all stores in a company
 * Shows what items are low/out of stock anywhere in the company
 */
export async function getCompanyInventoryAlerts(companyId: string, acknowledged?: boolean): Promise<StoreInventoryAlert[]> {
  const all = await dexieDb.storeInventoryAlerts.toArray();
  let filtered = all.filter((a) => a.companyId === companyId);

  if (typeof acknowledged === 'boolean') {
    filtered = filtered.filter((a) => a.acknowledged === acknowledged);
  }

  return filtered;
}

/**
 * Acknowledge an inventory alert (mark as seen by manager)
 */
export async function acknowledgeInventoryAlert(alertId: string, staffId: string): Promise<StoreInventoryAlert> {
  const existing = await dexieDb.storeInventoryAlerts.get(alertId);
  if (!existing) throw new Error('Alert not found');

  const updated: StoreInventoryAlert = {
    ...existing,
    acknowledged: true,
    acknowledgedBy: staffId,
    acknowledgedAt: new Date(),
    updatedAt: new Date(),
  };

  await dexieDb.storeInventoryAlerts.put(updated);
  return updated;
}

// ============================================================================
// SUPABASE STAFF SIGNUP
// ============================================================================

/**
 * Sign up a new staff member with company and store creation
 * This creates the full hierarchy: Auth user → Company → Store → Staff
 */
export async function signupStaff({
  email,
  password,
  companyName,
  companyEmail,
  storeName,
  storeLocation,
  staffName,
  staffPhone,
  pin,
  role
}: {
  email: string;
  password: string;
  companyName: string;
  companyEmail: string;
  storeName: string;
  storeLocation: string;
  staffName: string;
  staffPhone: string;
  pin: string;
  role: 'owner' | 'manager' | 'salesperson' | 'cashier' | 'delivery' | 'other';
}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured');
  }

  // Step 1: Use server-side admin-signup function
  const payload = {
    email,
    password,
    companyName,
    companyEmail,
    storeName,
    storeLocation,
    staffName,
    staffPhone,
    pin,
    role,
  };

  const { data: functionResult, error: functionError } = await invokeAdminSignup(payload);

  if (functionError) {
    console.error('Admin signup function failed (direct fetch):', functionError);
    throw new Error(functionError.message || String(functionError) || 'Unable to register company admin');
  }

  // Normalize the function response since deployments vary in shape
  const fnNorm = normalizeAdminSignupResponse(functionResult);
  const uid = fnNorm.user_id || fnNorm.user?.id || fnNorm.uid || (functionResult && functionResult.uid);
  const company = fnNorm.company || (functionResult && (functionResult.company || (functionResult.data && functionResult.data.company))) || undefined;
  const store = fnNorm.store || (functionResult && (functionResult.store || (functionResult.data && functionResult.data.store))) || undefined;

  if (!uid || !company || !store) {
    console.error('admin-signup returned incomplete data:', { uid, company, store, raw: functionResult });
    throw new Error('admin-signup did not return required canonical rows');
  }

  // Step 4: Insert staff row linked to Auth UID + company + store
  const { error: staffError } = await supabase.from('staff').insert([
    {
      auth_user_id: uid,
      company_id: company.id,
      store_id: store.id,
      name: staffName,
      phone: staffPhone,
      employee_pin: pin,
      is_pin_verified: true,
      is_active: true,
      role
    }
  ]);

  if (staffError) throw staffError;

  return { uid, company, store };
}

/** Extend / set monthly subscription for a company (super_admin / owner ops). */
export async function extendCompanySubscription(
  companyId: string,
  months: number,
  opts?: { plan?: Company['subscriptionPlan']; monthlyPriceUsd?: number; paymentRef?: string }
): Promise<Company | null> {
  const company = await dexieDb.companies.get(companyId);
  if (!company) return null;

  const now = new Date();
  const currentExpiry = company.subscriptionExpiresAt
    ? new Date(company.subscriptionExpiresAt)
    : now;
  const base = currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  const next = new Date(base);
  next.setMonth(next.getMonth() + Math.max(1, months));

  const updated: Company = {
    ...company,
    plan: opts?.plan === 'starter' ? 'free' : 'premium',
    subscriptionPlan: opts?.plan || company.subscriptionPlan || 'business',
    subscriptionStatus: 'active',
    subscriptionExpiresAt: next.toISOString(),
    monthlyPriceUsd: opts?.monthlyPriceUsd ?? company.monthlyPriceUsd ?? null,
    updatedAt: now,
  };

  await dexieDb.companies.put(updated);
  await upsertCompanyInSupabase(updated);

  if (isSupabaseConfigured() && opts?.paymentRef) {
    try {
      await supabase
        .from('companies')
        .update({
          last_payment_at: now.toISOString(),
          last_payment_ref: opts.paymentRef,
        })
        .eq('id', companyId);
    } catch {
      /* ignore */
    }
  }

  return updated;
}

export function isCompanySubscriptionActive(company?: Company | null): boolean {
  if (!company) return true; // no company loaded yet — don't hard-lock boot
  if (company.subscriptionStatus === 'cancelled') return false;
  if (!company.subscriptionExpiresAt) return true; // not enrolled in paid expiry yet
  return new Date(company.subscriptionExpiresAt).getTime() > Date.now();
}

/** Super-admin host kill switch — pause / suspend / remove tenant. */
export async function setCompanyHostStatus(
  companyId: string,
  hostStatus: Company['hostStatus'],
  hostStatusReason?: string
): Promise<Company | null> {
  const company = await dexieDb.companies.get(companyId);
  if (!company) return null;

  const now = new Date();
  const updated: Company = {
    ...company,
    hostStatus: hostStatus || 'active',
    hostStatusReason: hostStatusReason?.trim() || null,
    updatedAt: now,
  };

  await dexieDb.companies.put(updated);

  if (isSupabaseConfigured()) {
    let cloudOk = false;
    try {
      const { isMasterSessionActive } = await import('@/lib/offlineMasterAuth');
      if (isMasterSessionActive()) {
        const resp = await fetch('/api/master/host-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Master-Session': 'true',
          },
          body: JSON.stringify({
            companyId,
            hostStatus: updated.hostStatus,
            hostStatusReason: updated.hostStatusReason,
          }),
        });
        if (resp.ok) {
          cloudOk = true;
        }
      }
    } catch {
      /* try direct supabase next */
    }

    if (!cloudOk) {
      const client: any = typeof supabaseAdmin !== 'undefined' && supabaseAdmin ? supabaseAdmin : supabase;
      const { error } = await client
        .from('companies')
        .update({
          host_status: updated.hostStatus,
          host_status_reason: updated.hostStatusReason,
          updated_at: now.toISOString(),
        })
        .eq('id', companyId);

      if (error) {
        throw new Error(error.message || 'Failed to update host status in cloud');
      }
    }
  }

  return updated;
}

// ============================================================================
// HELPERS
// ============================================================================

function localDayBounds(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map((v) => parseInt(v, 10));
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return { start, end };
}
