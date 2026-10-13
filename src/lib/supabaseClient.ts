import { supabase } from './supabase';
import { signUpCompanyAdmin, type CompanySignupData } from './multiTenantAuth';
import { normalizeAdminSignupResponse } from './functionResponseNormalizer';
import { invokeAdminSignup } from './adminSignupClient';

export { supabase };

export async function signUpAdmin(data: CompanySignupData) {
  return signUpCompanyAdmin(data);
}

export async function signUpStaff({
  email,
  password,
  companyId,
  storeId,
  name,
  phone,
  role = 'staff',
}: {
  email: string;
  password: string;
  companyId: string;
  storeId?: string;
  name?: string;
  phone?: string;
  role?: 'admin' | 'owner' | 'manager' | 'staff';
}) {
  const payload = {
    email,
    pin: password,
    companyId,
    storeId,
    name,
    phone,
    role,
  };

  const { data: rawData, error } = await invokeAdminSignup(payload);

  if (error) {
    console.error('Failed to sign up staff via admin-signup (direct fetch):', error);
    throw error;
  }

  // Normalize response to handle different deployed function shapes
  const normalized = normalizeAdminSignupResponse(rawData);
  return normalized;
}
