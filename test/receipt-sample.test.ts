import { buildEscPosReceipt } from '@/lib/escpos';
import type { Sale, Settings } from '@/types/pos';

test('generate sample receipt bytes', () => {
  const sale: Partial<Sale> = {
    id: 'test-1',
    receiptNumber: 'R20260227-641836',
    createdAt: new Date().toISOString(),
    items: [
      { productName: 'Coca-Cola 500ml', quantity: 1, unitPrice: 18, total: 18 },
      { productName: 'Fanta Orange 500ml', quantity: 1, unitPrice: 18, total: 18 },
      { productName: "Lay's Classic", quantity: 26, unitPrice: 18, total: 468 },
      { productName: 'Full Cream Milk 1L', quantity: 1, unitPrice: 28, total: 28 },
    ],
    subtotal: 602,
    total: 602,
    amountPaid: 602,
    paymentMethod: 'cash',
  } as Sale;

  const settings: Partial<Settings> = {
    shopName: 'Mthunzi Store',
    thermalPrinterWidth: '80mm',
    currencySymbol: 'K',
    receiptUrl: 'https://mthunzi.tech/receipt',
  } as Settings;

  const bytes = buildEscPosReceipt({ sale: sale as Sale, settings: settings as Settings });

  // Log hex for inspection
  // eslint-disable-next-line no-console
  console.log('Receipt bytes hex:', Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' '));

  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(bytes.length).toBeGreaterThan(0);
});
