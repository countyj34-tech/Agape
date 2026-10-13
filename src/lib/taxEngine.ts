import type { Settings, Sale } from '@/types/pos';

export type SalesTaxMode = 'none' | 'tot' | 'vat';

export type TaxComputation = {
  mode: SalesTaxMode;
  rate: number; // percent
  label: string;
  taxableBase: number;
  taxAmount: number;
  totalWithTax: number;
};

export function labelForSalesTaxMode(mode: SalesTaxMode): string {
  return mode === 'vat' ? 'VAT' : mode === 'tot' ? 'Turnover Tax' : 'Tax';
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.max(0, Math.min(100, rate));
}

export function getSalesTaxMode(settings?: Settings | null): SalesTaxMode {
  const mode = (settings?.salesTaxMode ?? 'none') as SalesTaxMode;
  if (mode === 'tot' || mode === 'vat' || mode === 'none') return mode;
  return 'none';
}

export function getDefaultSalesTaxRate(mode: SalesTaxMode): number {
  if (mode === 'tot') return 5;
  if (mode === 'vat') return 16;
  return 0;
}

export function getSalesTaxRate(settings?: Settings | null): number {
  const mode = getSalesTaxMode(settings);
  const configured = Number(settings?.salesTaxRate);
  if (Number.isFinite(configured) && configured >= 0) return clampRate(configured);
  return getDefaultSalesTaxRate(mode);
}

export function computeSalesTax(args: {
  settings?: Settings | null;
  subtotal: number;
  discount: number;
}): TaxComputation {
  const mode = getSalesTaxMode(args.settings);
  const rate = mode === 'none' ? 0 : getSalesTaxRate(args.settings);
  const taxableBase = Math.max(0, Number(args.subtotal || 0) - Number(args.discount || 0));
  const taxAmount = rate > 0 ? (taxableBase * rate) / 100 : 0;
  const totalWithTax = taxableBase + taxAmount;
  const label = labelForSalesTaxMode(mode);

  return {
    mode,
    rate,
    label,
    taxableBase,
    taxAmount,
    totalWithTax,
  };
}

export function computeSalesTaxForSale(sale: Sale, settings?: Settings | null): TaxComputation {
  return computeSalesTax({ settings, subtotal: sale.subtotal, discount: sale.discount });
}
