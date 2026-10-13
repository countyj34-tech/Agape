/**
 * Complete Local Authentication System
 * Bypasses Supabase Auth entirely - uses only local storage
 */

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
 * Completely local signup - no Supabase Auth calls
 */
export async function signUpCompanyAdmin(data: CompanySignupData): Promise<AuthResult> {
  try {
    // Validate inputs
    if (!data.email || !data.phone || !data.pin || !data.companyName || !data.companyPhone) {
      return { success: false, error: 'Missing required fields' };
    }

    // Validate PIN is 6 digits
    if (!/^\d{6}$/.test(data.pin)) {
      return { success: false, error: 'PIN must be 6 digits' };
    }

    // Check if user already exists locally
    const existingUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const existingUser = existingUsers.find((u: any) => u.email === data.email.toLowerCase());
    if (existingUser) {
      return { success: false, error: 'Email already registered' };
    }

    // Create user data locally
    const userId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const storeId = crypto.randomUUID();

    const user = {
      id: userId,
      email: data.email.toLowerCase(),
      phone: data.phone,
      pin: data.pin, // Store PIN for local validation
      role: 'admin',
      full_name: data.companyName,
      company_id: companyId,
      store_id: storeId,
      created_at: new Date().toISOString()
    };

    const company = {
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
    };

    const store = {
      id: storeId,
      company_id: companyId,
      name: data.companyName + ' - Main Store',
      location_name: 'Main Location',
      address: data.companyAddress,
      phone: data.companyPhone,
      currency: data.currency || 'ZMW',
      currency_symbol: data.currency === 'ZMW' ? 'K' : data.currency || 'K',
      is_public: true,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Save to local storage
    localStorage.setItem('users', JSON.stringify([...existingUsers, user]));
    localStorage.setItem('companies', JSON.stringify([company]));
    localStorage.setItem('stores', JSON.stringify([store]));
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('currentCompany', JSON.stringify(company));
    localStorage.setItem('currentStore', JSON.stringify(store));
    localStorage.setItem('isAuthenticated', 'true');

    return { 
      success: true, 
      user: user,
      company: company
    };

  } catch (error) {
    console.error('Signup error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Local sign in
 */
export async function signIn(credentials: LoginCredentials): Promise<AuthResult> {
  try {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const user = users.find((u: any) => 
      u.email === credentials.emailOrPhone.toLowerCase() && u.pin === credentials.pin
    );

    if (!user) {
      return { success: false, error: 'Invalid credentials' };
    }

    // Get user's company and store
    const companies = JSON.parse(localStorage.getItem('companies') || '[]');
    const stores = JSON.parse(localStorage.getItem('stores') || '[]');
    
    const company = companies.find((c: any) => c.id === user.company_id);
    const store = stores.find((s: any) => s.id === user.store_id);

    // Update current session
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('currentCompany', JSON.stringify(company));
    localStorage.setItem('currentStore', JSON.stringify(store));
    localStorage.setItem('isAuthenticated', 'true');

    return { 
      success: true, 
      user: user,
      company: company
    };

  } catch (error) {
    console.error('Sign in error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

/**
 * Sign out user
 */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
  try {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentCompany');
    localStorage.removeItem('currentStore');
    localStorage.removeItem('isAuthenticated');
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
  try {
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    if (isAuthenticated === 'true') {
      const userStr = localStorage.getItem('currentUser');
      return userStr ? JSON.parse(userStr) : null;
    }
    return null;
  } catch (error) {
    console.error('Get current user error:', error);
    return null;
  }
}

/**
 * Get current company
 */
export async function getCurrentCompany() {
  try {
    const companyStr = localStorage.getItem('currentCompany');
    return companyStr ? JSON.parse(companyStr) : null;
  } catch (error) {
    console.error('Get current company error:', error);
    return null;
  }
}

/**
 * Get current store
 */
export async function getCurrentStore() {
  try {
    const storeStr = localStorage.getItem('currentStore');
    return storeStr ? JSON.parse(storeStr) : null;
  } catch (error) {
    console.error('Get current store error:', error);
    return null;
  }
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    return localStorage.getItem('isAuthenticated') === 'true';
  } catch (error) {
    return false;
  }
}
