import { supabaseRest } from './SupabaseModel.js';

export class ZRAInvoiceLog {
  static async findBySale(businessId, saleId) {
    const rows = await supabaseRest(
      'GET',
      `zra_invoice_logs?select=*&business_id=eq.${encodeURIComponent(
        businessId
      )}&sale_id=eq.${encodeURIComponent(saleId)}&limit=1`
    );
    return Array.isArray(rows) ? rows[0] ?? null : null;
  }

  static async create(data) {
    const rows = await supabaseRest(
      'POST',
      'zra_invoice_logs?on_conflict=sale_id,business_id',
      data,
      { prefer: 'return=representation,resolution=merge-duplicates' }
    );
    return Array.isArray(rows) ? rows[0] ?? null : rows;
  }
}
