import { supabaseRest } from './SupabaseModel.js';

const PUBLIC_COLUMNS = [
  'id',
  'business_id',
  'business_name',
  'tpin',
  'branch_id',
  'device_id',
  'api_key',
  'environment',
  'smart_invoice_enabled',
  'created_at',
  'updated_at',
].join(',');

export class ZRASettings {
  static async findByBusinessId(businessId, { includeSecret = false } = {}) {
    const columns = includeSecret ? `${PUBLIC_COLUMNS},api_secret` : PUBLIC_COLUMNS;
    const rows = await supabaseRest(
      'GET',
      `zra_settings?select=${columns}&business_id=eq.${encodeURIComponent(businessId)}&limit=1`
    );
    return Array.isArray(rows) ? rows[0] ?? null : null;
  }

  static async create(data) {
    const rows = await supabaseRest('POST', 'zra_settings', data);
    return Array.isArray(rows) ? rows[0] ?? null : rows;
  }

  static async updateByBusinessId(businessId, patch) {
    const rows = await supabaseRest(
      'PATCH',
      `zra_settings?business_id=eq.${encodeURIComponent(businessId)}`,
      patch
    );
    return Array.isArray(rows) ? rows[0] ?? null : rows;
  }

  static async deleteByBusinessId(businessId) {
    return supabaseRest(
      'DELETE',
      `zra_settings?business_id=eq.${encodeURIComponent(businessId)}`
    );
  }

  static toPublic(row) {
    if (!row) return null;
    const { api_secret: apiSecret, ...safe } = row;
    return {
      ...safe,
      has_api_secret: Boolean(apiSecret),
    };
  }
}
