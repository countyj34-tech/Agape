import type { Sale, Settings } from '@/types/pos';
import { computeSalesTaxForSale } from '@/lib/taxEngine';

export type SmartInvoicePayloadV1 = {
  v: 1;
  saleId: string;
  receiptNumber: string;
  createdAt: string; // ISO
  storeId: string;
  amount: number; // total paid (incl tax if enabled)
  taxMode: 'none' | 'tot' | 'vat';
  taxRate: number;
  taxAmount: number;
};

export function isZraSmartInvoiceActive(sale?: Sale | null): boolean {
  return Boolean(
    sale?.zraSmartInvoiceEnabled &&
      (sale.zraInvoiceNumber ||
        sale.zraVerificationCode ||
        sale.zraQrCode ||
        sale.zraTpin)
  );
}

export function buildSmartInvoicePayload(sale: Sale, settings?: Settings | null): SmartInvoicePayloadV1 {
  const t = computeSalesTaxForSale(sale, settings);
  const mode = (sale.salesTaxMode ?? t.mode) as 'none' | 'tot' | 'vat';
  const rate = Number(sale.salesTaxRate ?? t.rate ?? 0);
  const amount = Number(sale.salesTaxAmount ?? t.taxAmount ?? 0);
  return {
    v: 1,
    saleId: sale.id,
    receiptNumber: sale.receiptNumber,
    createdAt: new Date(sale.createdAt).toISOString(),
    storeId: sale.storeId,
    amount: Number(sale.total || 0),
    taxMode: mode,
    taxRate: Number.isFinite(rate) ? rate : 0,
    taxAmount: Number.isFinite(amount) ? amount : 0,
  };
}

export function encodeSmartInvoiceQrData(sale: Sale, settings?: Settings | null): string {
  // Prefer the official ZRA QR payload once Smart Invoice is enabled for the sale.
  if (sale.zraSmartInvoiceEnabled && sale.zraQrCode) {
    return sale.zraQrCode;
  }

  // Prefix so scanners can quickly detect MTZ payloads.
  const payload = buildSmartInvoicePayload(sale, settings);
  return `MTZ-INVOICE:${JSON.stringify(payload)}`;
}
