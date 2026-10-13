import { supabase } from '@/lib/supabase';
import type { Sale } from '@/types/pos';

export type ZRAEnvironment = 'sandbox' | 'production';

export interface ZRASettingsRecord {
  id: string;
  business_id: string;
  business_name: string;
  tpin: string;
  branch_id: string;
  device_id: string;
  api_key: string;
  environment: ZRAEnvironment;
  smart_invoice_enabled: boolean;
  has_api_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZRASettingsInput {
  business_id: string;
  business_name: string;
  tpin: string;
  branch_id: string;
  device_id: string;
  api_key: string;
  api_secret?: string;
  environment: ZRAEnvironment;
  smart_invoice_enabled: boolean;
}

export interface ZRAInvoiceResult {
  enabled: boolean;
  status: string;
  tpin?: string;
  invoiceNumber?: string;
  verificationCode?: string;
  qrCode?: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('A cloud-authenticated owner, admin, or manager session is required');
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(await authHeaders()),
        ...(init.headers || {}),
      },
    });

    if (response.status === 204) return undefined as T;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `ZRA request failed (${response.status})`);
    }
    return payload as T;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getZRASettings(businessId: string): Promise<ZRASettingsRecord | null> {
  const result = await apiRequest<{ settings: ZRASettingsRecord | null }>(
    `/api/zra/settings/${encodeURIComponent(businessId)}`
  );
  return result.settings;
}

export async function createZRASettings(
  input: ZRASettingsInput
): Promise<ZRASettingsRecord> {
  const result = await apiRequest<{ settings: ZRASettingsRecord }>('/api/zra/settings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.settings;
}

export async function updateZRASettings(
  businessId: string,
  input: ZRASettingsInput
): Promise<ZRASettingsRecord> {
  const result = await apiRequest<{ settings: ZRASettingsRecord }>(
    `/api/zra/settings/${encodeURIComponent(businessId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    }
  );
  return result.settings;
}

export async function deleteZRASettings(businessId: string): Promise<void> {
  await apiRequest<void>(`/api/zra/settings/${encodeURIComponent(businessId)}`, {
    method: 'DELETE',
  });
}

export async function submitSaleToZRA(
  businessId: string,
  sale: Sale
): Promise<ZRAInvoiceResult> {
  const result = await apiRequest<{ invoice: ZRAInvoiceResult }>('/api/zra/invoices', {
    method: 'POST',
    body: JSON.stringify({
      business_id: businessId,
      sale: {
        ...sale,
        createdAt: new Date(sale.createdAt).toISOString(),
      },
    }),
  });
  return result.invoice;
}
