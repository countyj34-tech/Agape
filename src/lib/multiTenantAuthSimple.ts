/**
 * Multi-Tenant Auth Service (Simplified - No Profiles)
 * 
 * Replaces device-based auth with proper multi-tenant signup/login flow
 * Uses direct auth.users -> companies relationship, no profiles table
 */

import { supabase, isSupabaseConfigured } from './supabase';

export interface CompanySignupData {
  email: string;
  pin: string; // 6-digit PIN as password
  companyName: string;
  companyEmail: string;
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

export interface Company {
  id: string;
  name: string;
  owner_phone: string;
  owner_email?: string;
  address?: string;
  currency: string;
  currency_symbol: string;
  tax_rate: number;
  plan: string;
  is_active: boolean;
}

export interface AuthResult {
  success: boolean;
  error?: string;
  user?: any;
  membership?: UserMembership;
  company?: Company;
}

/**
 * Sign up a new company admin
 * Creates: Auth user -> Company -> Membership
 */
export async function signUpCompanyAdmin(data: CompanySignupData): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    // Validate inputs
    if (!data.email || !data.pin || !data.companyName || !data.companyEmail) {
      return { success: false, error: 'Missing required fields' };
    }

    // Validate company email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.companyEmail)) {
      return { success: false, error: 'Invalid company email address' };
    }

    // Validate PIN is 6 digits
    if (!/^\d{6}$/.test(data.pin)) {
      return { success: false, error: 'PIN must be 6 digits' };
    }

    // Step 1: Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email.toLowerCase(),
      password: data.pin,
      options: {
        data: {
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

    // Step 2: Create company using the database function
    const { data: companyResult, error: companyError } = await supabase.rpc('admin_signup', {
      p_email: data.email.toLowerCase(),
      p_phone: null,
      p_pin: data.pin,
      p_company_name: data.companyName,
      p_company_phone: null,
      p_company_email: data.companyEmail || null,
      p_company_address: data.companyAddress || null,
      p_currency: data.currency || 'ZMW'
    });

    if (companyError || !companyResult?.success) {
      console.error('Company creation failed:', companyError);
      // Rollback: delete auth user if company creation failed
      await supabase.auth.signOut();
      return { success: false, error: companyResult?.error || 'Failed to create company' };
    }

    const companyId = companyResult.company_id;

    // Step 3: Create membership
    const { error: membershipError } = await supabase
      .from('memberships')
      .insert({
        user_id: authData.user.id,
        company_id: companyId,
        role: 'admin'
      });

    if (membershipError) {
      console.error('Membership creation failed:', membershipError);
    }

    // Step 4: Sign in the user
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: data.email.toLowerCase(),
      password: data.pin
    });

    if (signInError || !signInData?.user) {
      return { success: false, error: 'Signup successful but login failed' };
    }

    // Step 5: Fetch user membership and company data
    const membershipResult = await fetchUserMembershipAndCompany(signInData.user.id);

    return {
      success: true,
      user: signInData.user,
      membership: membershipResult.membership,
      company: membershipResult.company
    };
  } catch (error: any) {
    console.error('Signup error:', error);
    return { success: false, error: error.message || 'Signup failed' };
  }
}

/**
 * Login with email/phone and PIN
 */
export async function loginWithCredentials(credentials: LoginCredentials): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase is not configured' };
  }

  try {
    const { emailOrPhone, pin } = credentials;

    if (!emailOrPhone || !pin) {
      return { success: false, error: 'Email/phone and PIN are required' };
    }

    // Determine if input is email or phone
    const isEmail = emailOrPhone.includes('@');
    let email = emailOrPhone;

    // If phone, try to find the associated email from auth.users
    if (!isEmail) {
      const { data: users, error: userError } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('user_id', emailOrPhone)
        .limit(1);

      if (userError || !users || users.length === 0) {
        return { success: false, error: 'User not found with this phone number' };
      }

      // For now, we'll need to get email from auth.users metadata
      // This is a limitation - you might want to store phone in memberships
      return { success: false, error: 'Please use email for login' };
    }

    // Attempt to sign in
    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase(),
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

    // Fetch user membership and company data
    const membershipResult = await fetchUserMembershipAndCompany(authData.user.id);

    return {
      success: true,
      user: authData.user,
      membership: membershipResult.membership,
      company: membershipResult.company
    };
  } catch (error: any) {
    console.error('Login error:', error);
    return { success: false, error: error.message || 'Login failed' };
  }
}

/**
 * Fetch user membership and company data
 */
async function fetchUserMembershipAndCompany(userId: string): Promise<{ membership?: UserMembership; company?: Company }> {
  try {
    const { data: result, error } = await supabase.rpc('get_user_company_data', {
      p_user_id: userId
    });

    if (error || !result || !result.success) {
      console.error('Failed to fetch membership:', error);
      return {};
    }

    return {
      membership: result.membership as UserMembership,
      company: result.company as Company
    };
  } catch (error) {
    console.error('Membership fetch error:', error);
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
 * Get current user membership and company
 */
export async function getCurrentUserMembership(): Promise<{ membership?: UserMembership; company?: Company }> {
  const user = await getCurrentUser();
  if (!user) {
    return {};
  }

  return fetchUserMembershipAndCompany(user.id);
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
    // This would typically require phone verification (OTP)
    // For now, we'll return error - implement proper phone verification
    return { success: false, error: 'Phone verification required. Contact support.' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
