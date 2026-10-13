/**
 * Supabase Authentication System
 * Uses Supabase Auth for remote login across any device
 */

import { supabase, supabaseAdmin, isSupabaseConfigured } from './supabase';
import { dexieDb } from './db';
import { invokeAdminSignup } from './adminSignupClient';
import { normalizeAdminSignupResponse } from './functionResponseNormalizer';

function extractPhoneFromAuthEmail(identifier: string): string | undefined {
  const normalized = identifier.trim().toLowerCase();
  const match = normalized.match(/^staff-(\d+)@mthunzi\.local$/);
  return match ? match[1] : undefined;
}

export interface CompanySignupData {
  email: string;
  phone: string;
  pin: string;
  companyName: string;
  companyPhone: string;
  companyEmail?: string;
  companyAddress?: string;
  currency?: string;
}

export interface AdminUserCreationData {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  role?: 'admin' | 'manager' | 'staff';
  companyId: string;
  storeId: string;
}

export interface LoginCredentials {
  emailOrPhone: string;
  pin: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: any;
  company?: any;
  store?: any;
  profile?: any;
  membership?: any;
}

export interface Company {
  id: string;
  name: string;
  ownerEmail: string;
  ownerPhone: string;
  address: string;
  currency: string;
  currencySymbol: string;
  baseCurrency: string;
  taxRate: number;
  salesTaxMode: string;
  salesTaxRate: number;
  singleItemMarginPercent: number;
  receiptFooter: string;
  thermalPrinterWidth: string;
  plan: string;
  isActive: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface Store {
  id: string;
  companyId: string;
  name: string;
  locationName: string;
  address: string;
  phone: string;
  currency: string;
  currencySymbol: string;
  isPublic: boolean;
  isActive: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: string;
  companyId: string;
  storeId: string;
  isActive: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface UserMembership {
  userId: string;
  companyId: string;
  role: string;
  storeId: string;
  isActive: boolean;
  joinedAt: any;
}

/**
 * Sign up a new company admin using Supabase Auth
 */
export async function signUpCompanyAdmin(data: CompanySignupData): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    // Validate inputs
    console.log('Validating signup data:', data);
    const missingFields = [];
    if (!data.email) missingFields.push('email');
    if (!data.pin) missingFields.push('pin');
    if (!data.companyName) missingFields.push('companyName');
    
    if (missingFields.length > 0) {
      console.error('Missing fields:', missingFields);
      return { success: false, error: `Missing required fields: ${missingFields.join(', ')}` };
    }

    // Validate PIN is 6 digits
    if (!/^\d{6}$/.test(data.pin)) {
      return { success: false, error: 'PIN must be 6 digits' };
    }

    // Step 1: Create Supabase Auth user
    // Try regular client signUp first; on rate-limit or email-send errors,
    // fall back to server-side creation using the service-role client or
    // the `admin-signup` Edge function if available.
    let authDataLocal: any = null;

    // Helper: attempt to delete created user via admin client when cleaning up
    const deleteAuthUserIfPossible = async (userId: string | null | undefined) => {
      if (!userId) return;
      try {
        if (supabaseAdmin) {
          // service-role client has admin methods
          // @ts-ignore - supabaseAdmin types may differ in local env
          await supabaseAdmin.auth.admin.deleteUser(userId);
        } else if ((supabase as any).auth?.admin?.deleteUser) {
          await (supabase as any).auth.admin.deleteUser(userId);
        } else {
          console.warn('No admin client available to delete auth user', userId);
        }
      } catch (e) {
        console.warn('Failed to delete auth user during cleanup:', e);
      }
    };

    try {
      const { data: authRes, error: authResError } = await supabase.auth.signUp({
        email: data.email.toLowerCase(),
        password: data.pin,
        options: {
          data: {
            phone: data.phone,
            role: 'admin',
            full_name: data.companyName,
            // Add metadata to help with profile creation
            skip_profile_trigger: 'true'
          }
        }
      });

      if (authResError) throw authResError;
      authDataLocal = authRes;
    } catch (authErr: any) {
      console.error('Auth signup failed:', authErr);
      const msg = String(authErr?.message || authErr || '').toLowerCase();
      if (msg.includes('already registered')) {
        return { success: false, error: 'Email already registered' };
      }

      // If rate limited or email send issue, try server-side creation
      if (msg.includes('rate') || msg.includes('limit') || msg.includes('429')) {
        console.warn('Signup rate-limited; attempting server-side admin create');
        try {
          if (supabaseAdmin) {
            // @ts-ignore - using admin API on service-role client
            const { data: adminCreateData, error: adminCreateError } = await (supabaseAdmin as any).auth.admin.createUser({
              email: data.email.toLowerCase(),
              password: data.pin,
              user_metadata: {
                phone: data.phone,
                role: 'admin',
                full_name: data.companyName,
                skip_profile_trigger: 'true'
              },
              email_confirm: true
            });

            if (adminCreateError) {
              console.error('supabaseAdmin.createUser failed:', adminCreateError);
              return { success: false, error: adminCreateError.message || 'Admin user creation failed' };
            }

            authDataLocal = { user: (adminCreateData as any).user || adminCreateData };
          } else {
            // Last resort: call Edge function `admin-signup` which some deployments provide
            const payload = {
              email: data.email.toLowerCase(),
              pin: data.pin,
              fullName: data.companyName,
              phone: data.phone,
              role: 'admin',
              companyName: data.companyName,
              companyPhone: data.companyPhone,
              companyEmail: data.companyEmail,
              companyAddress: data.companyAddress,
              currency: data.currency
            };

            try {
              const { data: rawFnData, error: fnError } = await invokeAdminSignup(payload);

              if (fnError) {
                console.error('admin-signup function failed (direct fetch):', fnError);
                return { success: false, error: fnError.message || String(fnError) || 'Admin signup function failed' };
              }

              const fnNormalized = normalizeAdminSignupResponse(rawFnData);
              const createdId = fnNormalized.user_id || fnNormalized.user?.id || null;
              if (!createdId) {
                console.error('admin-signup did not return a user id:', rawFnData);
                return { success: false, error: 'Admin signup function failed to return user id' };
              }

              authDataLocal = { user: { id: createdId } };
            } catch (fnErr: any) {
              console.error('admin-signup invocation failed (direct fetch):', fnErr);
              return { success: false, error: fnErr?.message || String(fnErr) };
            }
          }
        } catch (fallbackErr: any) {
          console.error('Server-side signup fallback failed:', fallbackErr);
          return { success: false, error: fallbackErr?.message || String(fallbackErr) };
        }
      } else {
        return { success: false, error: String(authErr?.message || authErr) };
      }
    }

    if (!authDataLocal || !authDataLocal.user) {
      return { success: false, error: 'Failed to create auth user' };
    }

    // Normalize created user id for use in subsequent operations and cleanup
    const createdUserId = authDataLocal?.user?.id || authDataLocal?.user?.user?.id || authDataLocal?.user?.uid || null;
    if (!createdUserId) {
      return { success: false, error: 'Failed to create auth user' };
    }
    // Step 2: Create company record
    const companyId = crypto.randomUUID();
    const { error: companyError } = await supabase
      .from('companies')
      .insert({
        id: companyId,
        name: data.companyName,
        owner_email: data.email.toLowerCase(),
        owner_phone: data.companyPhone || null,
        address: data.companyAddress || null,
        currency: data.currency || 'ZMW',
        currency_symbol: data.currency === 'ZMW' ? 'K' : data.currency || 'K',
        base_currency: data.currency || 'ZMW',
        tax_rate: 0,
        sales_tax_mode: 'none',
        sales_tax_rate: 0,
        single_item_margin_percent: 0,
        receipt_footer: '',
        thermal_printer_width: '58mm',
        plan: 'free',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (companyError) {
      console.error('Company creation failed:', companyError);
      // Clean up auth user if company creation fails
      await deleteAuthUserIfPossible(createdUserId);
      return { success: false, error: companyError.message };
    }

    // Step 3: Create store record
    const storeId = crypto.randomUUID();
    const { error: storeError } = await supabase
      .from('stores')
      .insert({
        id: storeId,
        company_id: companyId,
        name: data.companyName + ' - Main Store',
        location_name: 'Main Location',
        address: data.companyAddress,
        phone: data.companyPhone || null,
        currency: data.currency || 'ZMW',
        currency_symbol: data.currency === 'ZMW' ? 'K' : data.currency || 'K',
        is_public: true,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (storeError) {
      console.error('Store creation failed:', storeError);
      // Clean up auth user and company if store creation fails
      await deleteAuthUserIfPossible(createdUserId);
      await supabase.from('companies').delete().eq('id', companyId);
      return { success: false, error: storeError.message };
    }

    // Step 4: Create or update user profile
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: createdUserId,
        email: data.email.toLowerCase(),
        full_name: data.companyName,
        phone: data.phone,
        role: 'admin',
        company_id: companyId,
        store_id: storeId,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });

    if (profileError) {
      console.error('Profile creation failed:', profileError);
      // Clean up if profile creation fails
      await deleteAuthUserIfPossible(createdUserId);
      await supabase.from('companies').delete().eq('id', companyId);
      await supabase.from('stores').delete().eq('id', storeId);
      return { success: false, error: profileError.message };
    }

    // Step 5: Create membership record
    const { error: membershipError } = await supabase
      .from('memberships')
      .insert({
        user_id: createdUserId,
        company_id: companyId,
        role: 'admin',
        store_id: storeId,
        is_active: true,
        joined_at: new Date().toISOString()
      });

    if (membershipError) {
      console.error('Membership creation failed:', membershipError);
      // Clean up if membership creation fails
      await deleteAuthUserIfPossible(createdUserId);
      await supabase.from('companies').delete().eq('id', companyId);
      await supabase.from('stores').delete().eq('id', storeId);
      await supabase.from('profiles').delete().eq('id', createdUserId);
      return { success: false, error: membershipError.message };
    }

    // Get created records for response
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    const { data: store } = await supabase
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .single();

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', createdUserId)
      .single();

    const { data: membership } = await supabase
      .from('memberships')
      .select('*')
      .eq('user_id', createdUserId)
      .single();

    return { 
      success: true, 
      user: authDataLocal.user,
      company,
      store,
      profile,
      membership
    };

  } catch (error) {
    console.error('Signup error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Sign in using Supabase Auth
 */
export async function signIn(credentials: LoginCredentials): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    // Support login by phone or email. If the identifier looks like a phone
    // number, try to resolve it to an email via the `profiles` table first.
    let identifier = (credentials.emailOrPhone || '').trim();
    let emailToUse = identifier.toLowerCase();
    let staffLookup: any = null;

    const looksLikePhone = /^[+]?\d{6,15}$/.test(identifier.replace(/\s|[-()]/g, ''));
    if (looksLikePhone) {
      const phoneNormalized = identifier.replace(/\D/g, '');
      try {
        // Try anonymous client first
        let profileLookup: any = null;
        try {
          const res = await supabase.from('profiles').select('email,phone').ilike('phone', `%${phoneNormalized}%`).maybeSingle();
          profileLookup = res.data;
        } catch (e) {
          // ignore
        }

        // If not found, try admin client when available
        if (!profileLookup && supabaseAdmin) {
          try {
            const res2 = await supabaseAdmin.from('profiles').select('email,phone').ilike('phone', `%${phoneNormalized}%`).maybeSingle();
            profileLookup = res2.data;
          } catch (e) {
            // ignore
          }
        }

        if (!profileLookup) {
          try {
            const staffRes = await supabase.from('staff').select('*').or(`phone.eq.${phoneNormalized},phone.ilike.%${phoneNormalized}%`).maybeSingle();
            staffLookup = staffRes.data;
            if (!staffLookup && supabaseAdmin) {
              const staffAdminRes = await supabaseAdmin.from('staff').select('*').or(`phone.eq.${phoneNormalized},phone.ilike.%${phoneNormalized}%`).maybeSingle();
              staffLookup = staffAdminRes.data;
            }
          } catch (e) {
            console.warn('Staff phone lookup failed:', e);
          }
        }

        if (profileLookup && profileLookup.email) {
          emailToUse = profileLookup.email.toLowerCase();
        } else if (staffLookup && staffLookup.email) {
          emailToUse = String(staffLookup.email).toLowerCase();
        } else {
          console.warn('Phone login: no profile found for', phoneNormalized);
        }
      } catch (e) {
        console.warn('Phone lookup error:', e);
      }
    }

    // Step 1: Authenticate with Supabase Auth (using resolved email)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password: credentials.pin
    });

    if (authError) {
      console.error('Auth sign in failed:', authError);
      return { success: false, error: authError.message };
    }

    if (!authData?.user) {
      return { success: false, error: 'Failed to sign in' };
    }

    const remoteClient: any = (typeof supabaseAdmin !== 'undefined' && supabaseAdmin) ? supabaseAdmin : supabase;

    // Step 2: Get user profile. Use maybeSingle() to avoid coercion errors
    // when no row exists. If no profile exists, attempt to create one using
    // the admin client so the rest of the app can proceed.
    let profile: any = null;
    try {
      const { data: profileData, error: profileError } = await remoteClient
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (!profileError && profileData) {
        profile = profileData;
      }
    } catch (e) {
      console.warn('Profile read error (remote client):', e);
    }

    // If profile still missing, try admin client to read or create the profile
    if (!profile) {
      try {
        const localCompanies = await dexieDb.companies.toArray();
        const localStaffRows = await dexieDb.staff.toArray();
        const localStores = await dexieDb.stores.toArray();

        const staffPhone = (authData.user.user_metadata && authData.user.user_metadata.phone)
          ? String(authData.user.user_metadata.phone).replace(/\D/g, '')
          : extractPhoneFromAuthEmail(String(authData.user.email || '')) || '';

        const localStaff = localStaffRows.find((row: any) => {
          const rowEmail = String(row.email || '').toLowerCase();
          const rowPhone = String(row.phone || '').replace(/\D/g, '');
          return rowEmail === String(authData.user.email || '').toLowerCase() || (staffPhone && rowPhone === staffPhone);
        });

        if (localStaff) {
          const matchingCompany = localStaff.companyId ? localCompanies.find((company) => company.id === localStaff.companyId) : null;
          const matchingStore = localStaff.storeId ? localStores.find((store) => store.id === localStaff.storeId) : null;
          profile = {
            id: authData.user.id,
            email: localStaff.email || authData.user.email || null,
            full_name: localStaff.name || authData.user.user_metadata?.full_name || authData.user.user_metadata?.fullName || null,
            phone: localStaff.phone || authData.user.user_metadata?.phone || null,
            role: localStaff.role || authData.user.user_metadata?.role || 'staff',
            company_id: localStaff.companyId || matchingCompany?.id || null,
            store_id: localStaff.storeId || matchingStore?.id || null,
            is_active: localStaff.isActive !== false,
            staff_id: localStaff.id,
          };
        } else {
          const ownerPhone = (authData.user.user_metadata && authData.user.user_metadata.phone)
            ? String(authData.user.user_metadata.phone).replace(/\D/g, '')
            : '';
          const localCompany = localCompanies.find((company) => {
            const companyEmail = String((company as any).email || (company as any).owner_email || company.ownerEmail || '').toLowerCase();
            const companyPhone = String((company as any).ownerPhone || (company as any).owner_phone || company.phone || '').replace(/\D/g, '');
            return companyEmail === String(authData.user.email || '').toLowerCase() || (ownerPhone && companyPhone === ownerPhone);
          });

          if (localCompany) {
            const matchingStore = localStores.find((store) => store.companyId === localCompany.id) || null;
            profile = {
              id: authData.user.id,
              email: (localCompany as any).email || (localCompany as any).owner_email || localCompany.ownerEmail || authData.user.email || null,
              full_name: localCompany.name || authData.user.user_metadata?.full_name || authData.user.user_metadata?.fullName || null,
              phone: (localCompany as any).ownerPhone || (localCompany as any).owner_phone || localCompany.phone || authData.user.user_metadata?.phone || null,
              role: (authData.user.user_metadata?.role as any) || 'owner',
              company_id: localCompany.id,
              store_id: matchingStore?.id || localCompany.assignedStoreId || null,
              is_active: localCompany.isActive !== false,
            };
          }
        }
      } catch (e) {
        console.warn('Local company/staff lookup failed:', e);
      }

      if (!profile && supabaseAdmin) {
        try {
          const { data: adminProfile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .maybeSingle();

          if (adminProfile) {
            profile = adminProfile;
          } else {
            // Create a minimal profiles row from auth user metadata
            const payload: any = {
              id: authData.user.id,
              email: authData.user.email || null,
              full_name: (authData.user.user_metadata && authData.user.user_metadata.full_name) || (authData.user.user_metadata && authData.user.user_metadata.fullName) || null,
              phone: (authData.user.user_metadata && authData.user.user_metadata.phone) || null,
              role: (authData.user.user_metadata && authData.user.user_metadata.role) || 'staff',
              company_id: (authData.user.user_metadata && authData.user.user_metadata.company_id) || null,
              store_id: (authData.user.user_metadata && authData.user.user_metadata.store_id) || null,
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            try {
              const { data: inserted, error: insertErr } = await supabaseAdmin.from('profiles').insert(payload).select().maybeSingle();
              if (!insertErr && inserted) profile = inserted;
              else console.warn('Failed to create profiles row via admin client:', insertErr);
            } catch (e) {
              console.warn('Error creating profiles row via admin client:', e);
            }
          }
        } catch (e) {
          console.warn('Profile read/create error (admin client):', e);
        }
      }

      if (!profile) {
        try {
          const staffRes = await remoteClient
            .from('staff')
            .select('*')
            .or(`email.eq.${authData.user.email || ''},phone.eq.${(authData.user.user_metadata && authData.user.user_metadata.phone) ? String(authData.user.user_metadata.phone).replace(/\D/g, '') : ''}`)
            .maybeSingle();

          if (staffRes.data) {
            profile = {
              id: authData.user.id,
              email: staffRes.data.email || authData.user.email || null,
              full_name: staffRes.data.name || authData.user.user_metadata?.full_name || authData.user.user_metadata?.fullName || null,
              phone: staffRes.data.phone || authData.user.user_metadata?.phone || null,
              role: staffRes.data.role || authData.user.user_metadata?.role || 'staff',
              company_id: staffRes.data.company_id || staffRes.data.companyId || null,
              store_id: staffRes.data.store_id || staffRes.data.storeId || null,
              is_active: staffRes.data.is_active !== false,
              staff_id: staffRes.data.id,
            };
          }
        } catch (e) {
          console.warn('Staff profile synthesis failed:', e);
        }
      }

      if (!profile) {
        try {
          const staffPhone = extractPhoneFromAuthEmail(String(authData.user.email || '')) || (authData.user.user_metadata && authData.user.user_metadata.phone ? String(authData.user.user_metadata.phone).replace(/\D/g, '') : '');
          if (staffPhone) {
            const { data: staffByPhone } = await remoteClient
              .from('staff')
              .select('*')
              .or(`phone.eq.${staffPhone},phone.ilike.%${staffPhone}%`)
              .maybeSingle();

            if (staffByPhone) {
              profile = {
                id: authData.user.id,
                email: staffByPhone.email || authData.user.email || null,
                full_name: staffByPhone.name || authData.user.user_metadata?.full_name || authData.user.user_metadata?.fullName || null,
                phone: staffByPhone.phone || authData.user.user_metadata?.phone || null,
                role: staffByPhone.role || authData.user.user_metadata?.role || 'staff',
                company_id: staffByPhone.company_id || staffByPhone.companyId || null,
                store_id: staffByPhone.store_id || staffByPhone.storeId || null,
                is_active: staffByPhone.is_active !== false,
                staff_id: staffByPhone.id,
              };
            }
          }
        } catch (e) {
          console.warn('Staff phone synthesis failed:', e);
        }
      }
    }

    if (!profile) {
      return { success: false, error: 'User profile not found' };
    }

    if (!profile.company_id && (profile as any).staff_id && staffLookup) {
      profile.company_id = staffLookup.company_id || staffLookup.companyId || profile.company_id;
      profile.store_id = staffLookup.store_id || staffLookup.storeId || profile.store_id;
      profile.role = staffLookup.role || profile.role || 'staff';
    }

    // Step 3: Get company
    const { data: company, error: companyError } = await remoteClient
      .from('companies')
      .select('*')
      .eq('id', profile.company_id)
      .single();

    if ((companyError || !company) && profile.company_id) {
      try {
        const localCompany = await dexieDb.companies.get(profile.company_id);
        if (localCompany) {
          const fallbackCompany = {
            id: localCompany.id,
            name: localCompany.name,
            ownerPhone: localCompany.ownerPhone,
            ownerPin: localCompany.ownerPin,
            phone: localCompany.phone,
            email: localCompany.email,
            address: localCompany.address,
            currency: localCompany.currency,
            currencySymbol: localCompany.currencySymbol,
            baseCurrency: localCompany.baseCurrency,
            plan: localCompany.plan,
            userRole: localCompany.userRole,
            assignedStoreId: localCompany.assignedStoreId,
            taxRate: localCompany.taxRate,
            salesTaxMode: localCompany.salesTaxMode,
            salesTaxRate: localCompany.salesTaxRate,
            singleItemMarginPercent: localCompany.singleItemMarginPercent,
            receiptFooter: localCompany.receiptFooter,
            thermalPrinterWidth: localCompany.thermalPrinterWidth,
            adminPin: localCompany.adminPin,
            pinSetupComplete: localCompany.pinSetupComplete,
            isActive: localCompany.isActive,
            createdAt: localCompany.createdAt,
            updatedAt: localCompany.updatedAt,
          };
          return {
            success: true,
            user: authData.user,
            company: fallbackCompany,
            store: null,
            profile,
            membership: null,
          };
        }
      } catch (e) {
        console.warn('Local company fallback failed:', e);
      }

      return { success: false, error: 'Company not found' };
    }

    // Step 4: Get store. Prefer the profile's store_id, but fall back to the
    // first store for the company, and self-heal by creating a default store if
    // the company exists without any store rows.
    let store: any = null;
    let storeError: any = null;

    if (profile.store_id) {
      const primaryStore = await remoteClient
        .from('stores')
        .select('*')
        .eq('id', profile.store_id)
        .maybeSingle();
      store = primaryStore.data;
      storeError = primaryStore.error;
    }

    if (!store && profile.company_id) {
      const companyStoreLookup = await remoteClient
        .from('stores')
        .select('*')
        .eq('company_id', profile.company_id)
        .limit(1)
        .maybeSingle();
      store = companyStoreLookup.data;
      storeError = companyStoreLookup.error;
    }

    if (!store && company) {
      try {
        const { createStore } = await import('./storeManagement');
        const createdStoreResult = await createStore({
          name: `${company.name} - Main Store`,
          location_name: 'Main Location',
          address: company.address || '',
          phone: company.phone || '',
          currency: company.currency || 'ZMW',
          currency_symbol: company.currency_symbol || 'K',
          is_public: true,
        }, company.id);

        if (createdStoreResult.success && createdStoreResult.store) {
          store = createdStoreResult.store;
          try {
            const profileClient: any = (typeof supabaseAdmin !== 'undefined' && supabaseAdmin) ? supabaseAdmin : remoteClient;
            await profileClient.from('profiles').update({ store_id: store.id, updated_at: new Date().toISOString() }).eq('id', authData.user.id);
          } catch (e) {
            console.warn('Failed to backfill profile store_id during sign in:', e);
          }
        }
      } catch (createStoreError) {
        console.warn('Failed to create fallback store during sign in:', createStoreError);
      }
    }

    if (!store) {
      return { success: false, error: 'Store not found' };
    }

    // Step 5: Get membership
    let { data: membership, error: membershipError } = await remoteClient
      .from('memberships')
      .select('*')
      .eq('user_id', authData.user.id)
      .maybeSingle();

    if ((!membership || membershipError) && supabaseAdmin) {
      try {
        const fallbackMembership = {
          user_id: authData.user.id,
          company_id: profile.company_id,
          role: profile.role || 'staff',
          store_id: profile.store_id || null,
          is_active: true,
          joined_at: new Date().toISOString(),
        };
        const inserted = await supabaseAdmin.from('memberships').upsert(fallbackMembership).select('*').maybeSingle();
        membership = inserted.data || fallbackMembership;
        membershipError = inserted.error;
      } catch (e) {
        console.warn('Membership self-heal failed:', e);
      }
    }

    if (!membership || membershipError) {
      membership = {
        user_id: authData.user.id,
        company_id: profile.company_id,
        role: profile.role || 'staff',
        store_id: profile.store_id || null,
        is_active: true,
        joined_at: new Date().toISOString(),
      };
    }

    return { 
      success: true, 
      user: authData.user,
      company,
      store,
      profile,
      membership
    };

  } catch (error) {
    console.error('Sign in error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Sign out from Supabase Auth
 */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign out error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Sign out error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Get current authenticated user
 */
// Add debouncing to prevent lock contention
let userCheckPromise: Promise<any> | null = null;

export async function getCurrentUser(): Promise<any> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  // Return existing promise if check is in progress
  if (userCheckPromise) {
    return userCheckPromise;
  }

  userCheckPromise = (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    } catch (error) {
      // Don't log lock errors to prevent console spam
      if (error.message && !error.message.includes('Lock')) {
        console.error('Get current user error:', error);
      }
      return null;
    } finally {
      // Clear promise after check completes
      setTimeout(() => {
        userCheckPromise = null;
      }, 1000);
    }
  })();

  return userCheckPromise;
}

/**
 * Check if user is authenticated
 */
// Add debouncing to prevent lock contention
let authCheckPromise: Promise<boolean> | null = null;

export async function isAuthenticated(): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  // Return existing promise if check is in progress
  if (authCheckPromise) {
    return authCheckPromise;
  }

  authCheckPromise = (async () => {
    try {
      // Prefer getSession (local) over getUser (network) so offline boot does not hang.
      const sessionPromise = supabase.auth.getSession();
      const timeoutPromise = new Promise<{ data: { session: null } }>((resolve) => {
        setTimeout(() => resolve({ data: { session: null } }), 2500);
      });
      const { data } = await Promise.race([sessionPromise, timeoutPromise]);
      return Boolean(data?.session?.user);
    } catch (error: any) {
      // Don't log lock errors to prevent console spam
      if (error?.message && !String(error.message).includes('Lock')) {
        console.error('Check authentication error:', error);
      }
      return false;
    } finally {
      // Clear promise after check completes
      setTimeout(() => {
        authCheckPromise = null;
      }, 1000);
    }
  })();

  return authCheckPromise;
}

/**
 * Get current company for authenticated user
 */
export async function getCurrentCompany(): Promise<any> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return null;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single();

    if (!profile?.company_id) {
      return null;
    }

    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', profile.company_id)
      .single();

    return company;
  } catch (error) {
    console.error('Get current company error:', error);
    return null;
  }
}

/**
 * Get current store for authenticated user
 */
export async function getCurrentStore(): Promise<any> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return null;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('store_id')
      .eq('id', user.id)
      .single();

    if (!profile?.store_id) {
      return null;
    }

    const { data: store } = await supabase
      .from('stores')
      .select('*')
      .eq('id', profile.store_id)
      .single();

    return store;
  } catch (error) {
    console.error('Get current store error:', error);
    return null;
  }
}

/**
 * Get company stores
 */
export async function getCompanyStores(companyId: string): Promise<{ success: boolean; stores?: any[]; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data: stores, error } = await supabase
      .from('stores')
      .select('*')
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (error) {
      console.error('Get company stores error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, stores: stores || [] };
  } catch (error) {
    console.error('Get company stores error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Get company members
 */
export async function getCompanyMembers(companyId: string): Promise<{ success: boolean; members?: any[]; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data: members, error } = await supabase
      .from('memberships')
      .select(`
        *,
        profiles!inner(
          id,
          email,
          full_name,
          phone,
          role
        )
      `)
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (error) {
      console.error('Get company members error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, members: members || [] };
  } catch (error) {
    console.error('Get company members error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Create user using admin API (bypasses email rate limits)
 * Perfect for multi-tenant systems where companies add members
 */
export async function createCompanyMember(data: AdminUserCreationData): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  if (!supabaseAdmin) {
    return { success: false, error: 'Service role key not configured. Add VITE_SUPABASE_SERVICE_ROLE_KEY to .env file' };
  }

  try {
    console.log('Creating company member with admin API:', data);

    // Step 1: Create user using admin API (bypasses email rate limits)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true, // bypasses confirmation email
      user_metadata: {
        full_name: data.fullName,
        phone: data.phone || '',
        role: data.role || 'staff',
        company_id: data.companyId,
        store_id: data.storeId
      }
    });

    if (authError) {
      console.error('Admin user creation failed:', authError);
      if (authError.message.includes('already registered')) {
        return { success: false, error: 'Email already registered' };
      }
      return { success: false, error: authError.message };
    }

    if (!authData?.user) {
      return { success: false, error: 'Failed to create user' };
    }

    console.log('✅ Admin user creation successful:', authData.user.id);

    // Step 2: Create/update user profile
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: authData.user.id,
        email: data.email.toLowerCase(),
        full_name: data.fullName,
        phone: data.phone || null,
        role: data.role || 'staff',
        company_id: data.companyId,
        store_id: data.storeId,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });

    if (profileError) {
      console.error('Profile creation failed:', profileError);
      // Clean up auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return { success: false, error: profileError.message };
    }

    // Step 3: Create membership record
    const { error: membershipError } = await supabase
      .from('memberships')
      .insert({
        user_id: authData.user.id,
        company_id: data.companyId,
        role: data.role || 'staff',
        store_id: data.storeId,
        is_active: true,
        joined_at: new Date().toISOString()
      });

    if (membershipError) {
      console.error('Membership creation failed:', membershipError);
      // Clean up if membership creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      await supabase.from('profiles').delete().eq('id', authData.user.id);
      return { success: false, error: membershipError.message };
    }

    // Get created records for response
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    const { data: membership } = await supabase
      .from('memberships')
      .select('*')
      .eq('user_id', authData.user.id)
      .single();

    return { 
      success: true, 
      user: authData.user,
      profile,
      membership
    };

  } catch (error) {
    console.error('Admin user creation error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Update company information
 */
export async function updateCompany(companyId: string, updates: Partial<Company>): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { error } = await supabase
      .from('companies')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', companyId);

    if (error) {
      console.error('Update company error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Update company error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}
