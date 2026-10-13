import type { Sale, Settings } from '@/types/pos';
import { MTZ_SUPPORT } from '@/lib/systemInfo';
import { computeSalesTaxForSale, labelForSalesTaxMode } from '@/lib/taxEngine';

export type PaperWidth = '58mm' | '80mm';

const encoder = new TextEncoder();

function sanitizeForPrinter(text: string): string {
  // Many ESC/POS printers default to legacy code pages; keep this conservative.
  // Replace common Unicode punctuation and strip non-ASCII.
  return text
    .replace(/\u2019/g, "'")
    .replace(/\u2018/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

function textBytes(text: string): Uint8Array {
  return encoder.encode(sanitizeForPrinter(text));
}

function repeat(ch: string, count: number): string {
  return Array.from({ length: Math.max(0, count) }, () => ch).join('');
}

export function formatReceiptRow(left: string, right: string, totalWidth = 32): string {
  const L = sanitizeForPrinter(left || '');
  const R = sanitizeForPrinter(right || '');

  if (L.length + R.length + 1 <= totalWidth) {
    const leftWidth = Math.max(0, totalWidth - R.length);
    return `${padRight(L, leftWidth)}${R}`;
  }

  // Wrap the left side across multiple lines; place the right value on the last line.
  const leftLines = wrapText(L, totalWidth);
  const out: string[] = [];
  for (let i = 0; i < leftLines.length; i++) {
    if (i === leftLines.length - 1) {
      const leftWidth = Math.max(0, totalWidth - R.length);
      out.push(`${padRight(leftLines[i], leftWidth)}${R}`);
    } else {
      out.push(leftLines[i]);
    }
  }

  return out.join('\n');
}

function wrapText(text: string, width: number): string[] {
  const t = text.trim();
  if (!t) return [''];

  const words = t.split(/\s+/g);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
      continue;
    }
    if ((current + ' ' + w).length <= width) {
      current += ' ' + w;
      continue;
    }
    lines.push(current);
    current = w;
  }
  if (current) lines.push(current);

  // Hard-wrap any overlong tokens.
  const flattened: string[] = [];
  for (const line of lines) {
    if (line.length <= width) {
      flattened.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += width) {
      flattened.push(line.slice(i, i + width));
    }
  }

  return flattened.length ? flattened : [''];
}

function padRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + repeat(' ', width - text.length);
}

function padLeft(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return repeat(' ', width - text.length) + text;
}

function colsForWidth(width: PaperWidth): number {
  return width === '58mm' ? 32 : 48;
}

function money(symbol: string, value: number): string {
  return `${symbol}${value.toFixed(2)}`;
}

export function buildEscPosTestPrint(settings: Settings): Uint8Array {
  const cols = colsForWidth(settings.thermalPrinterWidth ?? '80mm');
  const lines: string[] = [];
  lines.push(settings.shopName || 'Mthunzi POS');
  lines.push('BLUETOOTH TEST PRINT');
  lines.push(new Date().toLocaleString());
  lines.push(repeat('-', cols));
  lines.push('If you can read this, your');
  lines.push('printer is connected.');
  lines.push(repeat('-', cols));
  lines.push('Thank you.');
  lines.push(MTZ_SUPPORT.receiptSignature);

  // Build base bytes but postpone cutting so we can append QR and a polished footer.
  const base = buildEscPosFromLines(lines, { cut: false, centerHeaderLines: 3 });

  const bytes: number[] = Array.from(base);

  // QR payload: prefer store receipt URL if provided, otherwise include receipt id.
  const receiptId = settings.storeId || settings.companyId || settings.shopName || 'test-print';
  const qrPayload = settings.receiptUrl
    ? `${settings.receiptUrl.replace(/\/?$/, '')}?id=${encodeURIComponent(String(receiptId))}`
    : `receipt:${String(receiptId)}`;

  // Append native ESC/POS QR code sequence
  const buildQrCommand = (data: string, size = 6, errorLevel: 'L' | 'M' | 'Q' | 'H' = 'M') => {
    const b: number[] = [];
    const push = (...x: number[]) => b.push(...x);
    const dbytes = Array.from(textBytes(data));

    // Select model: 2
    push(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // Set module size
    push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
    // Set error correction level
    const eclMap: Record<string, number> = { L: 0x30, M: 0x31, Q: 0x32, H: 0x33 };
    push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, eclMap[errorLevel]);

    // Store data in symbol storage area
    const pl = (dbytes.length + 3) & 0xff;
    const ph = ((dbytes.length + 3) >> 8) & 0xff;
    push(0x1d, 0x28, 0x6b, pl, ph, 0x31, 0x50, 0x30, ...dbytes);

    // Print the symbol
    push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);

    return b;
  };

  bytes.push(...buildQrCommand(qrPayload, 6, 'M'));

  // Polished footer: center-aligned thank-you and a combined software|phone line.
  const thankYou = settings.receiptFooter || 'Thank you for shopping with us!';
  const phoneLine = settings.shopPhone || '+260979171520';
  const creditLine = `Software by Mthunzi-Tech-Labs | ${phoneLine}`;

  // Centered thank you
  bytes.push(0x1b, 0x61, 0x01);
  bytes.push(...textBytes(thankYou));
  bytes.push(...textBytes('\n'));

  // Centered credit + phone on one line
  bytes.push(0x1b, 0x61, 0x01);
  bytes.push(...textBytes(creditLine));
  bytes.push(...textBytes('\n'));

  // Feed and cut
  bytes.push(0x1b, 0x64, 0x03);
  bytes.push(0x1d, 0x56, 0x00);

  return new Uint8Array(bytes);
}

export function buildEscPosReceipt(args: {
  sale: Sale;
  settings: Settings;
}): Uint8Array {
  const { sale, settings } = args;
  const cols = colsForWidth(settings.thermalPrinterWidth ?? '80mm');
  const currencySymbol = settings.currencySymbol || 'K';
  const salesTax = computeSalesTaxForSale(sale, settings);
  const salesTaxAmount = Math.max(0, Number(sale.salesTaxAmount ?? salesTax.taxAmount ?? 0));
  const salesTaxRate = Math.max(0, Number(sale.salesTaxRate ?? salesTax.rate ?? 0));
  const salesTaxMode = (sale.salesTaxMode ?? salesTax.mode) as 'none' | 'tot' | 'vat';
  const salesTaxLabel = labelForSalesTaxMode(salesTaxMode);

  const lines: string[] = [];

  // Header
  lines.push(settings.shopName || 'Mthunzi POS');
  if (settings.shopAddress) lines.push(settings.shopAddress);
  if (settings.shopPhone) lines.push(settings.shopPhone);
  lines.push('');
  lines.push(`Receipt: ${sale.receiptNumber || sale.id}`);
  lines.push(`Date: ${new Date(sale.createdAt).toLocaleString()}`);
  lines.push(`Pay: ${String(sale.paymentMethod || '').toUpperCase()}`);
  lines.push(repeat('-', cols));

  // Items
  for (const item of sale.items) {
    const nameLines = wrapText(item.productName || 'Item', cols);
    for (const nl of nameLines) lines.push(nl);

    const qtyUnit = `${item.quantity} x ${money(currencySymbol, item.unitPrice)}`;
    const total = money(currencySymbol, item.total ?? item.unitPrice * item.quantity);

    // 2nd line: left qty/unit, right total.
    const leftWidth = Math.max(0, cols - total.length - 1);
    lines.push(`${padRight(qtyUnit, leftWidth)} ${total}`);
    lines.push('');
  }

  lines.push(repeat('-', cols));

  const subtotal = money(currencySymbol, sale.subtotal ?? 0);
  lines.push(`${padRight('Subtotal', cols - subtotal.length)}${subtotal}`);

  if ((sale.discount ?? 0) > 0) {
    const discount = money(currencySymbol, sale.discount);
    lines.push(`${padRight('Discount', cols - discount.length)}-${discount}`);
  }

  if (salesTaxRate > 0 && salesTaxAmount > 0) {
    const tax = money(currencySymbol, salesTaxAmount);
    const label = `${salesTaxLabel} ${salesTaxRate.toFixed(0)}%`;
    lines.push(`${padRight(label, cols - tax.length)}${tax}`);
  }

  const total = money(currencySymbol, sale.total ?? 0);
  lines.push(`${padRight('TOTAL', cols - total.length)}${total}`);

  if ((sale.amountPaid ?? 0) > 0) {
    const paid = money(currencySymbol, sale.amountPaid ?? 0);
    lines.push(`${padRight('Paid', cols - paid.length)}${paid}`);
  }

  if ((sale.changeGiven ?? 0) > 0) {
    const change = money(currencySymbol, sale.changeGiven ?? 0);
    lines.push(`${padRight('Change', cols - change.length)}${change}`);
  }

  if ((sale.balanceDue ?? 0) > 0) {
    const bal = money(currencySymbol, sale.balanceDue ?? 0);
    lines.push(`${padRight('Balance', cols - bal.length)}${bal}`);
  }

  if (sale.zraSmartInvoiceEnabled) {
    lines.push(repeat('-', cols));
    if (sale.zraTpin) lines.push(`TPIN: ${sale.zraTpin}`);
    lines.push(`Invoice Number: ${sale.zraInvoiceNumber || ''}`);
    lines.push(`Verification Code: ${sale.zraVerificationCode || ''}`);
  }

  lines.push(repeat('-', cols));

  const footer = settings.receiptFooter || 'Thank you for shopping with us!';
  for (const fl of wrapText(footer, cols)) lines.push(fl);
  for (const fl of wrapText(MTZ_SUPPORT.receiptSignature, cols)) lines.push(fl);

  const base = buildEscPosFromLines(lines, { cut: false, centerHeaderLines: 3 });
  const bytes: number[] = Array.from(base);

  if (sale.zraSmartInvoiceEnabled && sale.zraQrCode) {
    const buildQrCommand = (data: string, size = 6, errorLevel: 'L' | 'M' | 'Q' | 'H' = 'M') => {
      const b: number[] = [];
      const push = (...x: number[]) => b.push(...x);
      const dbytes = Array.from(textBytes(data));

      push(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
      push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
      const eclMap: Record<string, number> = { L: 0x30, M: 0x31, Q: 0x32, H: 0x33 };
      push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, eclMap[errorLevel]);

      const pl = (dbytes.length + 3) & 0xff;
      const ph = ((dbytes.length + 3) >> 8) & 0xff;
      push(0x1d, 0x28, 0x6b, pl, ph, 0x31, 0x50, 0x30, ...dbytes);
      push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
      return b;
    };

    bytes.push(0x1b, 0x61, 0x01);
    bytes.push(...textBytes('QR Code'));
    bytes.push(...textBytes('\n'));
    bytes.push(...buildQrCommand(sale.zraQrCode, 6, 'M'));
    bytes.push(...textBytes('\n'));
  }

  bytes.push(0x1b, 0x64, 0x03);
  bytes.push(0x1d, 0x56, 0x00);
  return new Uint8Array(bytes);
}

export function buildEscPosShortageSlip(args: {
  staffName: string;
  shortageAmount: number;
  settings: Settings;
}): Uint8Array {
  const { staffName, shortageAmount, settings } = args;
  const cols = colsForWidth(settings.thermalPrinterWidth ?? '80mm');
  const currencySymbol = settings.currencySymbol || 'K';

  const lines: string[] = [];
  lines.push(settings.shopName || 'Mthunzi POS');
  lines.push('AUDIT SHORTAGE SLIP');
  lines.push(new Date().toLocaleString());
  lines.push(repeat('-', cols));
  lines.push(`Staff: ${staffName}`);
  lines.push(`Shortage: ${currencySymbol}${shortageAmount.toFixed(2)}`);
  lines.push('');
  lines.push('Sign: ____________________________');
  lines.push('');
  lines.push(repeat('-', cols));
  lines.push('This slip is a record of a cash variance flagged by the Audit Shield.');

  return buildEscPosFromLines(lines, { cut: true, centerHeaderLines: 2 });
}

export function buildEscPosDrawerPulse(): Uint8Array {
  // Common drawer kick pulse: ESC p m t1 t2 -> 0x1b 0x70 m t1 t2
  // m=0 (drawer 1), t1=25, t2=250 are common safe defaults.
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);

  // Init printer
  push(0x1b, 0x40);
  // Pulse
  push(0x1b, 0x70, 0x00, 0x19, 0xfa);
  // A short feed
  push(0x1b, 0x64, 0x01);

  return new Uint8Array(bytes);
}

function buildEscPosFromLines(
  lines: string[],
  opts: { cut: boolean; centerHeaderLines?: number }
): Uint8Array {
  const bytes: number[] = [];

  const push = (...b: number[]) => bytes.push(...b);
  const pushText = (t: string) => bytes.push(...textBytes(t));

  // Init
  push(0x1b, 0x40);

  // Slightly larger header (double height/width) for first line.
  if (lines.length > 0) {
    // Center
    push(0x1b, 0x61, 0x01);
    // Bold on
    push(0x1b, 0x45, 0x01);
    // Double size
    push(0x1d, 0x21, 0x11);
    pushText(lines[0]);
    pushText('\n');
    // Normal size
    push(0x1d, 0x21, 0x00);
    // Bold off
    push(0x1b, 0x45, 0x00);
  }

  const centerCount = Math.max(0, opts.centerHeaderLines ?? 0);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (i < centerCount) {
      push(0x1b, 0x61, 0x01); // center
    } else {
      push(0x1b, 0x61, 0x00); // left
    }

    pushText(line);
    pushText('\n');
  }

  // Feed a bit
  push(0x1b, 0x64, 0x03);

  // Cut
  if (opts.cut) {
    // Full cut (common). Some printers may do partial cut; OK.
    push(0x1d, 0x56, 0x00);
  }

  return new Uint8Array(bytes);
}
