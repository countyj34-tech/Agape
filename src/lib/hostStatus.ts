/** Super-admin host kill switch — controls customer shop + tenant access. */

export type HostStatus = 'active' | 'paused' | 'suspended' | 'removed';

export const HOST_STATUS_OPTIONS: Array<{ value: HostStatus; label: string; hint: string }> = [
  { value: 'active', label: 'Active', hint: 'Shop and POS run normally' },
  {
    value: 'paused',
    label: 'Pause',
    hint: 'Online shop blocked only — POS keeps working on device storage',
  },
  { value: 'suspended', label: 'Suspend', hint: 'Locks POS + shop (hard stop)' },
  { value: 'removed', label: 'Remove', hint: 'Locks POS + shop (account removed)' },
];

export function normalizeHostStatus(raw?: string | null): HostStatus {
  const value = String(raw || 'active').toLowerCase();
  if (value === 'paused' || value === 'suspended' || value === 'removed') return value;
  return 'active';
}

/** Online shop / Netlify marketplace only. */
export function isCustomerShopOpen(status?: HostStatus | string | null): boolean {
  return normalizeHostStatus(status) === 'active';
}

/**
 * Hard-lock POS (suspend/remove).
 * Pause does NOT lock POS — installed terminals keep selling from device storage.
 */
export function isTenantAppBlocked(status?: HostStatus | string | null): boolean {
  const normalized = normalizeHostStatus(status);
  return normalized === 'suspended' || normalized === 'removed';
}

/** Soft hosting unpaid state — shop off, POS still works. */
export function isHostingPaused(status?: HostStatus | string | null): boolean {
  return normalizeHostStatus(status) === 'paused';
}

/** Default copy shown when super admin leaves the message blank. */
export const DEFAULT_HOSTING_PAYMENT_MESSAGE =
  'This system is hosted and maintained every month to keep your business running smooth and secure. To continue operating, please settle your hosting payment.';

export function getTenantBlockedTitle(status?: HostStatus | string | null): string {
  switch (normalizeHostStatus(status)) {
    case 'paused':
      return 'Online shop paused';
    case 'suspended':
      return 'Account suspended';
    case 'removed':
      return 'Account removed';
    default:
      return 'Access paused';
  }
}

export function getCustomerShopMessage(
  status: HostStatus | string | null | undefined,
  customReason?: string | null
): string {
  const custom = String(customReason || '').trim();
  if (custom) return custom;

  switch (normalizeHostStatus(status)) {
    case 'paused':
    case 'suspended':
      return DEFAULT_HOSTING_PAYMENT_MESSAGE;
    case 'removed':
      return 'This shop is no longer available.';
    default:
      return '';
  }
}

export function getTenantBlockedMessage(status?: HostStatus | string | null): string {
  switch (normalizeHostStatus(status)) {
    case 'paused':
    case 'suspended':
      return DEFAULT_HOSTING_PAYMENT_MESSAGE;
    case 'removed':
      return 'This account has been removed. Contact Mthunzi support.';
    default:
      return '';
  }
}

export function hostStatusLabel(status?: HostStatus | string | null): string {
  return HOST_STATUS_OPTIONS.find((o) => o.value === normalizeHostStatus(status))?.label || 'Active';
}

function pipelineUrl(path: string): string {
  try {
    const base = String((import.meta.env as Record<string, string>).VITE_PIPELINE_URL || '')
      .trim()
      .replace(/\/$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  } catch {
    return path;
  }
}

export type StoreHostStatus = {
  hostStatus: HostStatus;
  hostStatusReason?: string | null;
  shopOpen: boolean;
  message: string;
  companyName?: string;
};

export async function fetchStoreHostStatus(storeId: string): Promise<StoreHostStatus | null> {
  if (!storeId) return null;
  try {
    const resp = await fetch(
      pipelineUrl(`/api/public/store-host-status?store_id=${encodeURIComponent(storeId)}`)
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const hostStatus = normalizeHostStatus(data.hostStatus || data.host_status);
    return {
      hostStatus,
      hostStatusReason: data.hostStatusReason || data.host_status_reason || null,
      shopOpen: Boolean(data.shopOpen ?? data.shop_open ?? hostStatus === 'active'),
      message: String(data.message || getCustomerShopMessage(hostStatus)),
      companyName: data.companyName || data.company_name || undefined,
    };
  } catch {
    return null;
  }
}
