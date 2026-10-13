/**
 * Multi-Tenant Auth Service - Remote First Architecture
 * 
 * Supabase is the source of truth. The app signs users up remotely first,
 * then mirrors the resulting company/profile data to local storage.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import { invokeAdminSignup } from './adminSignupClient';
import { SupabaseFirstService, type Company, type User } from './supabaseFirst';
import { normalizeAdminSignupResponse } from './functionResponseNormalizer';

let signupInProgress = false;

export interface CompanySignupData {
  email: string;
  pin: string; // 6-digit PIN as password
  phone?: string;
  companyName: string;
  companyPhone?: string;
  companyEmail?: string;
  companyAddress?: string;
  currency?: string;
  currencySymbol?: string;
}

export interface LoginCredentials {
  email: string; // Changed from emailOrPhone to email-only
  pin: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  role: 'admin' | 'owner' | 'manager' | 'staff';
  company_id?: string;
  store_id?: string;
}


export interface AuthResult {
  success: boolean;
  error?: string;
  user?: any;
  profile?: UserProfile;
  company?: Company;
}

/**
 * Sign up a new company admin.
 * Creates the account remotely first, then mirrors company/profile data locally.
 */
export async function signUpCompanyAdmin(data: CompanySignupData): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  if (signupInProgress) {
    return { success: false, error: 'Signup is already in progress' };
  }

  try {
    signupInProgress = true;

    if (!data.email || !data.pin || !data.companyName) {
      return { success: false, error: 'Email, PIN, and company name are required' };
    }

    if (data.companyEmail && !data.companyEmail.includes('@')) {
      return { success: false, error: 'Invalid company email address' };
    }

    if (!/^\d{6}$/.test(data.pin)) {
      return { success: false, error: 'PIN must be 6 digits' };
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const normalizedCompanyEmail = data.companyEmail?.trim().toLowerCase() || normalizedEmail;
    const currencyValue = data.currency?.trim() || 'ZMW';
    const currencySymbol = data.currencySymbol?.trim() || (currencyValue === 'ZMW' ? 'K' : currencyValue);
    const companyName = data.companyName.trim();

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const payload = {
      email: normalizedEmail,
      pin: data.pin,
      phone: data.phone?.trim() || undefined,
      companyName,
      companyPhone: data.companyPhone?.trim() || undefined,
      companyEmail: normalizedCompanyEmail,
      companyAddress: data.companyAddress?.trim() || null,
      currency: currencyValue,
      currencySymbol,
    };

    const { data: rawResult, error: invokeError } = await invokeAdminSignup(payload);
    const authResult = normalizeAdminSignupResponse(rawResult);

    if (invokeError || !authResult?.success) {
      console.error('admin-signup edge function failed:', rawResult || invokeError?.message);
      return {
        success: false,
        error: authResult?.error || rawResult?.error || invokeError?.message || 'Unable to register company admin',
      };
    }

    const signInEmail = normalizedEmail;
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: signInEmail,
      password: data.pin,
    });

    if (signInError || !signInData?.user) {
      console.error('Post-signup sign-in failed:', signInError);
      return { success: false, error: signInError?.message || 'Account created, but automatic login failed' };
    }

    const userId = String(signInData.user.id || authResult.user_id || authResult.user?.id || '');
    const companyId = String(authResult.company_id || '');

    const profileResult = userId ? await fetchUserProfileWithCompany(userId) : {};
    const company = profileResult.company || (authResult.company as Company | undefined) || {
      id: companyId,
      name: companyName,
      email: normalizedCompanyEmail,
      owner_phone: '',
      owner_email: normalizedCompanyEmail,
      address: data.companyAddress?.trim() || undefined,
      currency: currencyValue,
      currency_symbol: currencySymbol,
      tax_rate: 0,
      plan: 'free',
      is_active: true,
    };

    const profile = profileResult.profile || {
      id: userId,
      full_name: companyName,
      phone: '',
      email: normalizedEmail,
      role: 'owner',
      company_id: companyId || undefined,
    };

    try {
      const { dexieDb } = await import('./db');
      if (company) {
        await dexieDb.companies.put(company as any);
      }
    } catch (e) {
      console.warn('Failed to mirror signup data locally:', e);
    }

    return {
      success: true,
      user: signInData.user,
      profile,
      company,
    };
  } catch (error: any) {
    console.error('Signup error:', error);
    return { success: false, error: error.message || 'Signup failed' };
  } finally {
    signupInProgress = false;
  }
}

/**
 * Login with email/phone and PIN - Updated for Supabase First
 */
export async function loginWithCredentials(credentials: LoginCredentials): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { email, pin } = credentials;

    if (!email || !pin) {
      return { success: false, error: 'Email and PIN are required' };
    }

    // Attempt to sign in with Supabase Auth
    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password: pin
    });

    if (signInError) {
      console.error('Login failed:', signInError);
      
      if (signInError.message.includes('Invalid login credentials')) {
        return { success: false, error: 'Invalid email or PIN' };
      }
      
      return { success: false, error: signInError.message };
    }

    if (!authData?.user) {
      return { success: false, error: 'Login failed' };
    }

    // Fetch user profile with company data using Supabase First service
    const profileResult = await fetchUserProfileWithCompany(authData.user.id);

    return {
      success: true,
      user: authData.user,
      profile: profileResult.profile,
      company: profileResult.company
    };
  } catch (error: any) {
    console.error('Login error:', error);
    return { success: false, error: error.message || 'Login failed' };
  }
}

/**
 * Fetch user profile with company data - Updated for Supabase First
 */
async function fetchUserProfileWithCompany(userId: string): Promise<{ profile?: UserProfile; company?: Company }> {
  try {
    // Use SupabaseFirstService which tries Supabase first, then local storage
    const profile = await SupabaseFirstService.getUser(userId);
    let company: Company | undefined;

    if (profile?.company_id) {
      company = await SupabaseFirstService.getCompany(profile.company_id);
    }

    return {
      profile: profile as UserProfile,
      company
    };
  } catch (error) {
    console.error('User fetch error:', error);
    return {};
  }
}

/**
 * Logout current user
 */
export async function logout(): Promise<void> {
  if (isSupabaseConfigured()) {
    await supabase.auth.signOut();
  }
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}

/**
 * Get current user
 */
export async function getCurrentUser(): Promise<any> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Get current user profile with company
 */
export async function getCurrentUserProfile(): Promise<{ profile?: UserProfile; company?: Company }> {
  const user = await getCurrentUser();
  if (!user) {
    return {};
  }

  return fetchUserProfileWithCompany(user.id);
}

/**
 * Update user profile
 */
export async function updateProfile(updates: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Update company
 */
export async function updateCompany(companyId: string, updates: Partial<Company>): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', companyId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Change PIN (password)
 */
export async function changePin(oldPin: string, newPin: string): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  // Validate new PIN
  if (!/^\d{6}$/.test(newPin)) {
    return { success: false, error: 'PIN must be 6 digits' };
  }

  try {
    // First verify old PIN by attempting to sign in
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      return { success: false, error: 'Not authenticated' };
    }

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: oldPin
    });

    if (verifyError) {
      return { success: false, error: 'Current PIN is incorrect' };
    }

    // Update password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPin
    });

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Reset PIN (requires phone verification in production)
 */
export async function resetPin(phone: string, newPin: string): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  // Validate new PIN
  if (!/^\d{6}$/.test(newPin)) {
    return { success: false, error: 'PIN must be 6 digits' };
  }

  try {
    // Find user by phone
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('phone', phone)
      .limit(1);

    if (profileError || !profiles || profiles.length === 0) {
      return { success: false, error: 'User not found with this phone number' };
    }

    // This would typically require phone verification (OTP)
    // For now, we'll allow direct reset (not recommended for production)
    const profile = profiles[0];
    
    // Use admin client to update password (requires service role in production)
    // For now, return error - implement proper phone verification
    return { success: false, error: 'Phone verification required. Contact support.' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
