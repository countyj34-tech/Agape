import { toast } from 'sonner';
import type { Sale } from '@/types/pos';

export type VantageSyncResult = {
  success: boolean;
  status?: number;
  error?: string;
};

function readVantageConfig() {
  const viteEnv = (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined')
    ? import.meta.env
    : {};
  const processEnv = typeof process !== 'undefined' && process.env ? process.env : {};

  const baseUrl = String(
    viteEnv.VITE_VANTAGE_URL
      || viteEnv.VITE_VANTAGE_API_URL
      || processEnv.VITE_VANTAGE_URL
      || processEnv.VITE_VANTAGE_API_URL
      || ''
  ).replace(/\/$/, '');

  const token = String(
    viteEnv.VITE_VANTAGE_TOKEN
      || viteEnv.VITE_VANTAGE_BEARER_TOKEN
      || processEnv.VITE_VANTAGE_TOKEN
      || processEnv.VITE_VANTAGE_BEARER_TOKEN
      || ''
  ).trim();

  return { baseUrl, token };
}

function serializeSale(sale: Sale) {
  return {
    ...sale,
    createdAt: sale.createdAt instanceof Date ? sale.createdAt.toISOString() : sale.createdAt,
    lastSyncedAt: sale.lastSyncedAt ? new Date(sale.lastSyncedAt).toISOString() : null,
  };
}

export async function syncToVantage(salesData: Sale[]): Promise<VantageSyncResult> {
  const { baseUrl, token } = readVantageConfig();

  if (!baseUrl) {
    const error = 'Missing Vantage endpoint configuration';
    toast.error(error);
    return { success: false, error };
  }

  if (!token) {
    const error = 'Missing Vantage bearer token';
    toast.error(error);
    return { success: false, error };
  }

  const payload = {
    source: 'mthunzi-pos-frontend',
    generatedAt: new Date().toISOString(),
    totals: {
      saleCount: salesData.length,
      revenue: salesData.reduce((sum, sale) => sum + (sale.total ?? 0), 0),
      profit: salesData.reduce((sum, sale) => sum + (sale.profit ?? 0), 0),
    },
    sales: salesData.map(serializeSale),
  };

  try {
    const response = await fetch(`${baseUrl}/api/v1/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 200) {
      toast.success('Sync Successful');
      return { success: true, status: 200 };
    }

    const message = await response.text().catch(() => 'Sync failed');
    const error = `Sync failed (${response.status})${message ? `: ${message}` : ''}`;
    toast.error(error);
    return { success: false, status: response.status, error };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    toast.error('Network issue detected', {
      action: {
        label: 'Retry',
        onClick: () => {
          void syncToVantage(salesData);
        },
      },
    });
    return { success: false, error: message };
  }
}