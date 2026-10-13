/**
 * Direct Database Insert Authentication System
 * Bypasses RPC calls entirely - uses direct database inserts
 */

import { supabase, isSupabaseConfigured } from './supabase';

export interface CompanySignupData {
  email: string;
  phone: string;
  pin: string; // 6-digit PIN as password
  companyName: string;
  companyPhone: string;
  companyEmail?: string;
  companyAddress?: string;
  currency?: string;
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
}

/**
 * Sign up a new company admin using direct database inserts
 * No RPC calls - completely bypasses function call issues
 */
export async function signUpCompanyAdmin(data: CompanySignupData): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    // Validate inputs
    if (!data.email || !data.phone || !data.pin || !data.companyName || !data.companyPhone) {
      return { success: false, error: 'Missing required fields' };
    }

    // Validate PIN is 6 digits
    if (!/^\d{6}$/.test(data.pin)) {
      return { success: false, error: 'PIN must be 6 digits' };
    }

    // Step 1: Create Supabase Auth user FIRST (this creates auth.uid())
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email.toLowerCase(),
      password: data.pin,
      options: {
        data: {
          phone: data.phone,
          role: 'admin',
          full_name: data.companyName
        }
      }
    });

    if (authError) {
      console.error('Auth signup failed:', authError);
      if (authError.message.includes('already registered')) {
        return { success: false, error: 'Email already registered' };
      }
      return { success: false, error: authError.message };
    }

    if (!authData?.user) {
      return { success: false, error: 'Failed to create auth user' };
    }

    // Step 2: Create company record using direct insert
    const companyId = crypto.randomUUID();
    const { error: companyError } = await supabase
      .from('companies')
      .insert({
        id: companyId,
        name: data.companyName,
        owner_email: data.email.toLowerCase(),
        owner_phone: data.companyPhone,
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
      return { success: false, error: companyError.message };
    }

    // Step 3: Create store record using direct insert
    const storeId = crypto.randomUUID();
    const { error: storeError } = await supabase
      .from('stores')
      .insert({
        id: storeId,
        company_id: companyId,
        name: data.companyName + ' - Main Store',
        location_name: 'Main Location',
        address: data.companyAddress || null,
        phone: data.companyPhone,
        currency: data.currency || 'ZMW',
        currency_symbol: data.currency === 'ZMW' ? 'K' : data.currency || 'K',
        is_public: true,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (storeError) {
      console.error('Store creation failed:', storeError);
      return { success: false, error: storeError.message };
    }

    // Step 4: Create user profile using direct insert
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        full_name: data.companyName,
        email: data.email.toLowerCase(),
        phone: data.phone,
        role: 'owner',
        company_id: companyId,
        store_id: storeId,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (profileError) {
      console.error('Profile creation failed:', profileError);
      return { success: false, error: profileError.message };
    }

    // Step 5: Create membership record using direct insert
    const { error: membershipError } = await supabase
      .from('memberships')
      .insert({
        id: crypto.randomUUID(),
        user_id: authData.user.id,
        company_id: companyId,
        role: 'owner',
        store_id: storeId,
        is_active: true,
        joined_at: new Date().toISOString()
      });

    if (membershipError) {
      console.error('Membership creation failed:', membershipError);
      return { success: false, error: membershipError.message };
    }

    // Step 6: Sign in the user
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: data.email.toLowerCase(),
      password: data.pin
    });

    if (signInError || !signInData?.user) {
      return { success: false, error: 'Signup successful but login failed' };
    }

    // Step 7: Return success
    return { 
      success: true, 
      user: signInData.user,
      company: {
        id: companyId,
        name: data.companyName,
        owner_phone: data.companyPhone,
        owner_email: data.email.toLowerCase(),
        address: data.companyAddress,
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
      }
    };

  } catch (error) {
    console.error('Signup error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Sign in user
 */
export async function signIn(credentials: LoginCredentials): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: credentials.emailOrPhone.toLowerCase(),
      password: credentials.pin
    });

    if (error) {
      console.error('Sign in error:', error);
      return { success: false, error: error.message };
    }

    if (!data?.user) {
      return { success: false, error: 'Failed to sign in' };
    }

    return { success: true, user: data.user };

  } catch (error) {
    console.error('Sign in error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Sign out user
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
 * Get current user
 */
export async function getCurrentUser() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch (error) {
    console.error('Get current user error:', error);
    return null;
  }
}
