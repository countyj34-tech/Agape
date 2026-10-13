/**
 * Fixed Supabase Authentication System
 * Handles signup in correct order: company -> auth user -> profile/membership
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

export interface UserMembership {
  id: string;
  user_id: string;
  company_id: string;
  role: 'admin' | 'owner' | 'manager' | 'staff';
  store_id?: string;
  is_active: boolean;
  joined_at: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  role: string;
  company_id: string;
  store_id?: string;
}

export interface Company {
  id: string;
  name: string;
  owner_phone: string;
  owner_email?: string;
  address?: string;
  currency: string;
  currency_symbol: string;
  base_currency: string;
  tax_rate: number;
  sales_tax_mode: string;
  sales_tax_rate: number;
  single_item_margin_percent: number;
  receipt_footer: string;
  thermal_printer_width: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: any;
  company?: Company;
  store?: any;
}

/**
 * Sign up a new company admin
 * FIXED FLOW: Create company first, then auth user, then complete profile/membership
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

    // Step 1: Create company and store using new function (no auth required)
    const { data: companyResult, error: companyError } = await supabase.rpc('create_company_signup', {
      p_email: data.email.toLowerCase(),
      p_phone: data.phone,
      p_company_name: data.companyName,
      p_company_phone: data.companyPhone,
      p_company_email: data.companyEmail || null,
      p_company_address: data.companyAddress || null,
      p_currency: data.currency || 'ZMW'
    });

    if (companyError || !companyResult?.success) {
      console.error('Company creation failed:', companyError);
      return { success: false, error: companyResult?.error || 'Failed to create company' };
    }

    const companyId = companyResult.company_id;
    const storeId = companyResult.store_id;

    // Step 2: Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email.toLowerCase(),
      password: data.pin,
      options: {
        data: {
          phone: data.phone,
          role: 'admin',
          full_name: data.companyName,
          company_id: companyId,
          store_id: storeId
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

    // Step 3: Complete user profile and membership using new function
    const { data: setupResult, error: setupError } = await supabase.rpc('complete_user_signup', {
      p_user_id: authData.user.id,
      p_company_id: companyId,
      p_store_id: storeId,
      p_email: data.email.toLowerCase(),
      p_phone: data.phone,
      p_company_name: data.companyName
    });

    if (setupError || !setupResult?.success) {
      console.error('User setup failed:', setupError);
      return { success: false, error: setupResult?.error || 'Failed to complete user setup' };
    }

    // Step 4: Sign in the user
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: data.email.toLowerCase(),
      password: data.pin
    });

    if (signInError || !signInData?.user) {
      return { success: false, error: 'Signup successful but login failed' };
    }

    // Step 5: Return success
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

/**
 * Reset user PIN
 */
export async function resetPin(phone: string, newPin: string): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    // Validate PIN is 6 digits
    if (!/^\d{6}$/.test(newPin)) {
      return { success: false, error: 'PIN must be 6 digits' };
    }

    // This would typically call a database function to reset the PIN
    // For now, return a placeholder implementation
    const { error } = await supabase.rpc('reset_user_pin', {
      p_phone: phone,
      p_new_pin: newPin
    });

    if (error) {
      console.error('Reset PIN error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Reset PIN error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}
