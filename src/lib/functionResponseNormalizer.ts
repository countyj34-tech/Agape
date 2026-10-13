/**
 * Normalize responses from admin-signup and other Edge functions.
 * Returns a canonical shape with common fields extracted for callers.
 */
export function normalizeAdminSignupResponse(raw: any) {
  const out: any = {
    success: false,
    error: undefined,
    user_id: undefined,
    company_id: undefined,
    store_id: undefined,
    user: undefined,
    company: undefined,
    store: undefined,
    raw,
  };

  if (!raw) return out;

  // Unwrap common wrappers: { data: <body> } or { result: { data: <body> } }
  let data: any = raw;
  if (data && typeof data === 'object') {
    if (data.result && typeof data.result === 'object' && 'data' in data.result) {
      data = data.result.data;
    } else if (data.data && typeof data.data === 'object' && (('success' in data.data) || ('user_id' in data.data) || ('company_id' in data.data))) {
      data = data.data;
    }
  }

  // Helper to pick the first present key
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (data && Object.prototype.hasOwnProperty.call(data, k) && data[k] != null) return data[k];
    }
    return undefined;
  };

  out.success = Boolean(pick('success', 'ok') || (data && data.success === true));
  out.error = pick('error', 'error_message', 'message', 'errorMessage');

  out.user_id = pick('user_id', 'uid', 'id', 'userId') ?? (data && data.user && (data.user.id || data.user.user_id));
  out.company_id = pick('company_id', 'companyId') ?? (data && data.company && (data.company.id || data.company.company_id));
  out.store_id = pick('store_id', 'storeId') ?? (data && data.store && (data.store.id || data.store.store_id));

  out.user = data && data.user ? data.user : (out.user_id ? { id: out.user_id } : undefined);
  out.company = data && data.company ? data.company : (out.company_id ? { id: out.company_id } : undefined);
  out.store = data && data.store ? data.store : (out.store_id ? { id: out.store_id } : undefined);

  return out;
}
