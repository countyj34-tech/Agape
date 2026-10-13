import * as XLSX from 'xlsx';
import type { StockReconciliationOcrRow } from '@/types/pos';
import {
  cleanOcrProductName,
  isLikelyValidStockRow,
} from '@/lib/stockReconciliationClean';
import type { StockSheetType } from '@/lib/stockReconciliationAi';

export type StockFileKind = 'image' | 'excel' | 'csv' | 'pdf' | 'unknown';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i;
const EXCEL_EXT = /\.(xlsx|xls|xlsm)$/i;
const CSV_EXT = /\.csv$/i;
const PDF_EXT = /\.pdf$/i;

export function detectStockFileKind(file: File): StockFileKind {
  const name = file.name || '';
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
  if (
    type.includes('spreadsheet') ||
    type.includes('excel') ||
    type === 'application/vnd.ms-excel' ||
    EXCEL_EXT.test(name)
  ) {
    return 'excel';
  }
  if (type === 'text/csv' || type === 'application/csv' || CSV_EXT.test(name)) return 'csv';
  if (type === 'application/pdf' || PDF_EXT.test(name)) return 'pdf';
  return 'unknown';
}

function parseQuantity(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  let s = String(value).trim();
  // "K 12.50" / "ZMW 12,50" / "12.50 K"
  s = s.replace(/[kK]|zmw|usd|\$/gi, '').trim();
  // European decimal comma: 12,50 → 12.50 (but keep thousands 1,250)
  if (/^\d{1,3},\d{1,2}$/.test(s)) {
    s = s.replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

function parseMoney(value: unknown): number {
  return parseQuantity(value);
}

function pickColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const candidate of candidates) {
    const key = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const exact = normalized.findIndex((h) => h === key);
    if (exact >= 0) return exact;
  }
  for (const candidate of candidates) {
    const key = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const idx = normalized.findIndex((h) => h.includes(key) || key.includes(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

type ColumnIndexes = {
  name: number;
  opening: number;
  closing: number;
  refill: number;
  qty: number;
  buying: number;
  selling: number;
};

function findHeaderRow(matrix: unknown[][]): { rowIndex: number; indexes: ColumnIndexes } | null {
  const maxScan = Math.min(matrix.length, 25);
  for (let i = 0; i < maxScan; i += 1) {
    const headers = (matrix[i] || []).map((c) => String(c ?? '').trim());
    if (!headers.some((c) => c.length > 0)) continue;

    const looksLikeHeader = headers.some((c) =>
      /product|item|name|description|opening|closing|refill|qty|quantity|stock|buying|selling|price|cost|retail|wholesale/i.test(
        c
      )
    );
    if (!looksLikeHeader) continue;

    const indexes: ColumnIndexes = {
      name: pickColumn(headers, [
        'product name',
        'productname',
        'item name',
        'itemname',
        'description',
        'product',
        'item',
        'name',
      ]),
      opening: pickColumn(headers, ['opening stock', 'openingstock', 'opening', 'open', 'start']),
      closing: pickColumn(headers, ['closing stock', 'closingstock', 'closing', 'close', 'end']),
      refill: pickColumn(headers, ['refill', 'restock', 'received', 'purchases']),
      qty: pickColumn(headers, [
        'quantity',
        'qty',
        'stock qty',
        'stockqty',
        'on hand',
        'onhand',
        'units',
        'count',
        'stock',
      ]),
      buying: pickColumn(headers, [
        'buying price',
        'buyingprice',
        'cost price',
        'costprice',
        'purchase price',
        'purchaseprice',
        'wholesale',
        'buy price',
        'buyprice',
        'cost',
        'buying',
      ]),
      selling: pickColumn(headers, [
        'selling price',
        'sellingprice',
        'retail price',
        'retailprice',
        'unit price',
        'unitprice',
        'sale price',
        'saleprice',
        'sell price',
        'sellprice',
        'price',
        'selling',
        'retail',
      ]),
    };

    // Avoid mapping the same column to both buying and selling
    if (indexes.buying >= 0 && indexes.buying === indexes.selling) {
      const buyHeader = headers[indexes.buying]?.toLowerCase() || '';
      if (/sell|retail|unit/.test(buyHeader) && !/buy|cost|wholesale|purchase/.test(buyHeader)) {
        indexes.buying = -1;
      } else if (/buy|cost|wholesale|purchase/.test(buyHeader)) {
        indexes.selling = -1;
      }
    }

    if (indexes.name < 0 && indexes.qty < 0 && indexes.buying < 0 && indexes.selling < 0) {
      continue;
    }
    if (indexes.name < 0) indexes.name = 0;
    return { rowIndex: i, indexes };
  }
  return null;
}

function rowFromCells(
  cells: unknown[],
  sheetType: StockSheetType,
  indexes?: ColumnIndexes
): StockReconciliationOcrRow | null {
  const get = (i: number) => (i >= 0 && i < cells.length ? cells[i] : undefined);

  let rawName = '';
  let opening = 0;
  let closing = 0;
  let refill = 0;
  let buyingPrice = 0;
  let sellingPrice = 0;

  if (indexes) {
    rawName = cleanOcrProductName(String(get(indexes.name) ?? ''));
    opening = parseQuantity(get(indexes.opening >= 0 ? indexes.opening : -1));
    closing = parseQuantity(get(indexes.closing));
    refill = parseQuantity(get(indexes.refill));
    const qty = parseQuantity(get(indexes.qty));
    if (sheetType === 'opening' && opening <= 0) opening = qty;
    if (sheetType === 'closing' && closing <= 0) closing = qty;
    if (sheetType === 'refill' && refill <= 0) refill = qty;
    if (sheetType === 'combined' || sheetType === 'opening') {
      if (opening <= 0 && qty > 0) opening = qty;
    }
    buyingPrice = parseMoney(get(indexes.buying));
    sellingPrice = parseMoney(get(indexes.selling));
  } else {
    // No headers: first text-like cell(s) = name; numbers = qty / prices
    const texts: string[] = [];
    const nums: number[] = [];
    for (const cell of cells) {
      const s = String(cell ?? '').trim();
      if (!s) continue;
      const asMoney = parseMoney(s);
      const looksNumeric =
        /^-?\d+(?:[.,]\d+)?$/.test(s.replace(/[kK$]|zmw|usd/gi, '').trim()) ||
        (/^\d/.test(s) && asMoney > 0 && !/[a-zA-Z]{3,}/.test(s));
      if (looksNumeric) {
        nums.push(asMoney);
      } else {
        texts.push(s);
      }
    }
    rawName = cleanOcrProductName(texts.join(' '));
    // Heuristic: if 3+ numbers → qty, buying, selling OR buying, selling, qty
    if (nums.length >= 3) {
      // Prefer last as selling, middle buying, first qty when first is integer-ish
      const first = nums[0];
      const mid = nums[1];
      const last = nums[nums.length - 1];
      if (Number.isInteger(first) || first === Math.floor(first)) {
        opening = first;
        buyingPrice = mid;
        sellingPrice = last;
      } else {
        buyingPrice = first;
        sellingPrice = mid;
        opening = last;
      }
    } else if (nums.length === 2) {
      // qty + price, or buying + selling
      if (Number.isInteger(nums[0]) || nums[0] === Math.floor(nums[0])) {
        opening = nums[0];
        sellingPrice = nums[1];
      } else {
        buyingPrice = nums[0];
        sellingPrice = nums[1];
        opening = 1;
      }
    } else if (nums.length === 1) {
      if (sheetType === 'closing') closing = nums[0];
      else if (sheetType === 'refill') refill = nums[0];
      else opening = nums[0];
    }
  }

  if (sheetType === 'opening') {
    closing = 0;
    refill = 0;
  } else if (sheetType === 'closing') {
    opening = 0;
    refill = 0;
  } else if (sheetType === 'refill') {
    opening = 0;
    closing = 0;
  }

  const quantity = opening || closing || refill;
  // Inventory import: allow rows that have prices even if qty missing (default later)
  const effectiveQty = quantity > 0 ? quantity : buyingPrice > 0 || sellingPrice > 0 ? 1 : 0;

  const row: StockReconciliationOcrRow = {
    rawName,
    quantity: effectiveQty,
    opening: sheetType === 'opening' || sheetType === 'combined' ? opening || effectiveQty : undefined,
    closing: sheetType === 'closing' || sheetType === 'combined' ? closing : undefined,
    refill: sheetType === 'refill' || sheetType === 'combined' ? refill : undefined,
    unitPrice: sellingPrice > 0 ? sellingPrice : undefined,
    buyingPrice: buyingPrice > 0 ? buyingPrice : undefined,
  };

  return isLikelyValidStockRow(row, { fromAi: true }) ? row : null;
}

function parseSheetMatrix(matrix: unknown[][], sheetType: StockSheetType): StockReconciliationOcrRow[] {
  if (!matrix.length) return [];

  const header = findHeaderRow(matrix);
  let start = 0;
  let indexes: ColumnIndexes | undefined;

  if (header) {
    indexes = header.indexes;
    start = header.rowIndex + 1;
  }

  const rows: StockReconciliationOcrRow[] = [];
  for (let i = start; i < matrix.length; i += 1) {
    const cells = matrix[i] || [];
    if (!cells.some((c) => String(c ?? '').trim())) continue;
    const row = rowFromCells(cells, sheetType, indexes);
    if (row) rows.push(row);
  }
  return rows;
}

function matrixFromWorkbook(workbook: XLSX.WorkBook, sheetType: StockSheetType): StockReconciliationOcrRow[] {
  const all: StockReconciliationOcrRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    }) as unknown[][];
    all.push(...parseSheetMatrix(matrix, sheetType));
  }
  return all;
}

export async function parseExcelStockFile(
  file: File,
  sheetType: StockSheetType
): Promise<StockReconciliationOcrRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  return matrixFromWorkbook(workbook, sheetType);
}

export async function parseCsvStockFile(
  file: File,
  sheetType: StockSheetType
): Promise<StockReconciliationOcrRow[]> {
  const text = await file.text();
  const workbook = XLSX.read(text, { type: 'string' });
  return matrixFromWorkbook(workbook, sheetType);
}

type PdfTextItem = { str: string; x: number; y: number };

function groupPdfItemsIntoRows(items: PdfTextItem[]): string[][] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  const yTolerance = 4;

  for (const item of sorted) {
    if (!item.str.trim()) continue;
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - item.y) <= yTolerance) {
      last.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows.map((rowItems) => {
    rowItems.sort((a, b) => a.x - b.x);
    // Merge adjacent fragments into cells by X gap
    const cells: string[] = [];
    let current = '';
    let lastX = -Infinity;
    for (const it of rowItems) {
      const gap = it.x - lastX;
      if (current && gap > 18) {
        cells.push(current.trim());
        current = it.str;
      } else {
        current = current ? `${current} ${it.str}` : it.str;
      }
      lastX = it.x + it.str.length * 4;
    }
    if (current.trim()) cells.push(current.trim());
    return cells;
  });
}

/** Text PDF: rebuild table rows from positioned text items. */
export async function parsePdfStockFile(
  file: File,
  sheetType: StockSheetType
): Promise<{ rows: StockReconciliationOcrRow[]; needsImageOcr: boolean }> {
  try {
    const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url
    ).toString();

    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    const matrix: unknown[][] = [];
    let letterCount = 0;

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const raw of content.items as any[]) {
        if (typeof raw?.str !== 'string' || !raw.str.trim()) continue;
        const tx = raw.transform || [1, 0, 0, 1, 0, 0];
        items.push({ str: raw.str, x: Number(tx[4]) || 0, y: Number(tx[5]) || 0 });
        letterCount += (raw.str.match(/[A-Za-z]/g) || []).length;
      }
      const pageRows = groupPdfItemsIntoRows(items);
      matrix.push(...pageRows);
    }

    if (letterCount < 20) {
      return { rows: [], needsImageOcr: true };
    }

    let rows = parseSheetMatrix(matrix, sheetType);
    rows = rows.map((row) => ({ ...row, rawName: cleanOcrProductName(row.rawName) }));
    rows = rows.filter((r) => isLikelyValidStockRow(r, { fromAi: true }));
    return { rows, needsImageOcr: rows.length === 0 };
  } catch (error) {
    console.warn('PDF text extract failed:', error);
    return { rows: [], needsImageOcr: true };
  }
}

/** Render each PDF page to a PNG File for OCR when text layer is empty/scanned. */
export async function renderPdfPagesToImageFiles(file: File): Promise<File[]> {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const images: File[] = [];
  const maxPages = Math.min(doc.numPages, 8);

  for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const renderTask = page.render({
      canvasContext: ctx as any,
      viewport,
      canvas,
    } as any);
    await renderTask.promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (!blob) continue;
    const base = file.name.replace(/\.pdf$/i, '') || 'page';
    images.push(new File([blob], `${base}-page-${pageNum}.png`, { type: 'image/png' }));
  }

  return images;
}

export const STOCK_FILE_ACCEPT =
  'image/*,.pdf,.xlsx,.xls,.xlsm,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv';
