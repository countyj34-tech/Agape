import * as Tesseract from 'tesseract.js';
import {
  extractStockSheetWithVisionAi,
  type StockSheetType,
} from '@/lib/stockReconciliationAi';
import {
  detectStockFileKind,
  parseCsvStockFile,
  parseExcelStockFile,
  parsePdfStockFile,
} from '@/lib/stockReconciliationFileParse';
import {
  cleanOcrProductName,
  isLikelyValidStockRow,
  normalizeOcrRows,
} from '@/lib/stockReconciliationClean';
import type { StockReconciliationOcrRow } from '@/types/pos';

export type OcrProgressUpdate = { progress: number; status: string };
export type { StockSheetType };
export { cleanOcrProductName, isLikelyValidStockRow, normalizeOcrRows };

function parseQuantity(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/[^0-9.\-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

export function mapRowsToStockSheet(
  rows: Array<{ name?: string; quantity?: string; sellingPrice?: string; buyingPrice?: string }>
): StockReconciliationOcrRow[] {
  return rows
    .map((row) => ({
      rawName: String(row.name ?? '').trim(),
      quantity: parseQuantity(row.quantity),
      unitPrice: parsePrice(row.sellingPrice) ?? parsePrice(row.buyingPrice),
    }))
    .filter((row) => row.rawName.length > 0);
}

function parsePrice(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^0-9.\-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

/**
 * Parse stock-sheet OCR text (Tesseract fallback only).
 */
export function parseStockSheetText(text: string): StockReconciliationOcrRow[] {
  if (!text?.trim()) return [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2);

  const headerSkip =
    /^(item|product|name|description|opening|closing|refill|qty|quantity|price|amount|total|stock|s\/n|no\.?#?)$/i;
  const rows: StockReconciliationOcrRow[] = [];

  for (const line of lines) {
    if (headerSkip.test(line)) continue;
    if (/opening|closing|refill/i.test(line) && line.split(/\s+/).length <= 5 && !/\d/.test(line)) {
      continue;
    }

    const match = line.match(/^(.+?)\s+(-?\d+(?:[.,]\d+)?)(?:\s+(-?\d+(?:[.,]\d+)?))?(?:\s+(-?\d+(?:[.,]\d+)?))?\s*$/);
    if (!match) {
      const nums = [...line.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => parseQuantity(m[1]));
      const namePart = line.replace(/[\d.,]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (namePart.length < 2 || nums.length === 0) continue;
      if (nums.length >= 3) {
        rows.push({
          rawName: namePart,
          quantity: nums[0],
          opening: nums[0],
          refill: nums[1],
          closing: nums[2],
        });
      } else if (nums.length === 2) {
        rows.push({
          rawName: namePart,
          quantity: nums[0],
          opening: nums[0],
          closing: nums[1],
          refill: 0,
        });
      } else {
        rows.push({ rawName: namePart, quantity: nums[0] });
      }
      continue;
    }

    const rawName = match[1]
      .replace(/^\d+[\).\-\s]+/, '')
      .replace(/[|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (rawName.length < 2 || headerSkip.test(rawName)) continue;

    const n1 = parseQuantity(match[2]);
    const n2 = match[3] !== undefined ? parseQuantity(match[3]) : undefined;
    const n3 = match[4] !== undefined ? parseQuantity(match[4]) : undefined;

    if (n3 !== undefined) {
      rows.push({ rawName, quantity: n1, opening: n1, refill: n2 ?? 0, closing: n3 });
    } else if (n2 !== undefined) {
      rows.push({ rawName, quantity: n1, opening: n1, closing: n2, refill: 0 });
    } else {
      rows.push({ rawName, quantity: n1 });
    }
  }

  return rows;
}

async function preprocessImageForOcr(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxSide = Math.max(bitmap.width, bitmap.height);
  const scale = maxSide < 1400 ? 1400 / maxSide : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  ctx.drawImage(bitmap, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Grayscale + contrast stretch
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const boosted = Math.min(255, Math.max(0, (gray - 40) * 1.35));
    data[i] = data[i + 1] = data[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('preprocess failed'))), 'image/png');
  });
}

async function extractWithTesseractStockParser(
  file: File,
  sheetType: StockSheetType,
  onProgress?: (update: OcrProgressUpdate) => void
): Promise<StockReconciliationOcrRow[]> {
  onProgress?.({ progress: 5, status: `Cleaning ${file.name} for OCR...` });
  let source: File | Blob = file;
  try {
    source = await preprocessImageForOcr(file);
  } catch {
    source = file;
  }

  onProgress?.({ progress: 15, status: `Browser OCR reading ${file.name}...` });
  const result = await Tesseract.recognize(source, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress?.({
          progress: 15 + Math.round((m.progress || 0) * 75),
          status: `Browser OCR ${file.name}: ${Math.round((m.progress || 0) * 100)}%`,
        });
      }
    },
  });
  const text = result.data?.text || '';
  let rows = parseStockSheetText(text);

  if (sheetType === 'opening') {
    rows = rows.map((r) => ({ ...r, opening: r.opening ?? r.quantity, quantity: r.opening ?? r.quantity }));
  } else if (sheetType === 'closing') {
    rows = rows.map((r) => ({ ...r, closing: r.closing ?? r.quantity, quantity: r.closing ?? r.quantity }));
  } else if (sheetType === 'refill') {
    rows = rows.map((r) => ({ ...r, refill: r.refill ?? r.quantity, quantity: r.refill ?? r.quantity }));
  }

  onProgress?.({ progress: 100, status: `Browser OCR found ${rows.length} rows` });
  return rows;
}

export async function extractStockSheetFromFile(
  file: File,
  options?: { sheetType?: StockSheetType; onProgress?: (update: OcrProgressUpdate) => void }
): Promise<{ rows: StockReconciliationOcrRow[]; method: string; warning?: string }> {
  const sheetType = options?.sheetType ?? 'combined';
  const onProgress = options?.onProgress;
  const kind = detectStockFileKind(file);

  if (kind === 'excel') {
    onProgress?.({ progress: 20, status: `Reading Excel ${file.name}...` });
    const rows = await parseExcelStockFile(file, sheetType);
    onProgress?.({ progress: 100, status: `Excel: ${rows.length} products` });
    return {
      rows: normalizeOcrRows(rows, { fromAi: true }),
      method: 'excel',
    };
  }

  if (kind === 'csv') {
    onProgress?.({ progress: 20, status: `Reading CSV ${file.name}...` });
    const rows = await parseCsvStockFile(file, sheetType);
    onProgress?.({ progress: 100, status: `CSV: ${rows.length} products` });
    return {
      rows: normalizeOcrRows(rows, { fromAi: true }),
      method: 'csv',
    };
  }

  if (kind === 'pdf') {
    onProgress?.({ progress: 15, status: `Reading PDF ${file.name}...` });
    const pdfResult = await parsePdfStockFile(file, sheetType);
    if (pdfResult.rows.length > 0) {
      onProgress?.({ progress: 100, status: `PDF: ${pdfResult.rows.length} products` });
      return {
        rows: normalizeOcrRows(pdfResult.rows, { fromAi: true }),
        method: 'pdf-text',
      };
    }

    // Scanned PDF: render pages → OCR images
    try {
      onProgress?.({ progress: 25, status: 'Rendering scanned PDF pages for OCR...' });
      const { renderPdfPagesToImageFiles } = await import('@/lib/stockReconciliationFileParse');
      const pageImages = await renderPdfPagesToImageFiles(file);
      if (!pageImages.length) {
        return {
          rows: [],
          method: 'pdf-text',
          warning:
            'This PDF looks scanned and pages could not be rendered. Upload Excel/CSV or a clear photo instead.',
        };
      }
      const merged: StockReconciliationOcrRow[] = [];
      for (let i = 0; i < pageImages.length; i += 1) {
        onProgress?.({
          progress: 30 + Math.round((i / pageImages.length) * 65),
          status: `OCR PDF page ${i + 1}/${pageImages.length}...`,
        });
        const pageResult = await extractStockSheetFromImage(pageImages[i], {
          sheetType,
          onProgress,
        });
        merged.push(...pageResult.rows);
      }
      onProgress?.({ progress: 100, status: `PDF OCR: ${merged.length} products` });
      return {
        rows: normalizeOcrRows(merged, { fromAi: true }),
        method: 'pdf-ocr',
        warning: merged.length === 0 ? 'No products found on scanned PDF pages.' : undefined,
      };
    } catch (error) {
      console.warn('Scanned PDF OCR failed:', error);
      return {
        rows: [],
        method: 'pdf-text',
        warning:
          'This PDF looks scanned (no readable text). Export to Excel, or upload a clear photo of the sheet instead.',
      };
    }
  }

  if (kind === 'unknown') {
    return {
      rows: [],
      method: 'failed',
      warning: `Unsupported file: ${file.name}. Use image, PDF, Excel (.xlsx), or CSV.`,
    };
  }

  return extractStockSheetFromImage(file, options);
}

/** @deprecated use extractStockSheetFromFile */
export async function extractStockSheetFromImage(
  file: File,
  options?: { sheetType?: StockSheetType; onProgress?: (update: OcrProgressUpdate) => void }
): Promise<{ rows: StockReconciliationOcrRow[]; method: string; warning?: string }> {
  const sheetType = options?.sheetType ?? 'combined';
  const onProgress = options?.onProgress;

  let aiWarning: string | undefined;

  // 1) Local Python EasyOCR (OpenCV cleaned) — no Puter
  try {
    const aiResult = await extractStockSheetWithVisionAi(file, sheetType, onProgress);
    aiWarning = aiResult.warning;
    if (aiResult.rows.length > 0) {
      return {
        rows: normalizeOcrRows(aiResult.rows, { fromAi: true }),
        method: aiResult.method,
        warning: aiWarning,
      };
    }
  } catch (error) {
    console.warn('Python OCR failed, falling back to browser OCR:', error);
  }

  // 2) Browser Tesseract.js as last resort
  try {
    onProgress?.({ progress: 5, status: `Python OCR unavailable — browser OCR for ${file.name}...` });
    const rows = await extractWithTesseractStockParser(file, sheetType, onProgress);
    if (rows.length > 0) {
      return {
        rows: normalizeOcrRows(rows, { fromAi: true }),
        method: 'tesseract-stock-sheet',
        warning:
          aiWarning ||
          'Python OCR was unavailable. Browser OCR was used — fix product names in Step 1 before matching.',
      };
    }
  } catch (error) {
    console.warn('Tesseract fallback failed:', error);
  }

  return { rows: [], method: 'failed', warning: aiWarning };
}

export async function extractStockSheetsFromImages(
  files: File[],
  options?: {
    sheetType?: StockSheetType;
    onProgress?: (update: OcrProgressUpdate) => void;
  }
): Promise<{
  rows: StockReconciliationOcrRow[];
  method: string;
  rawCount?: number;
  keptCount?: number;
  warning?: string;
}> {
  if (!files.length) return { rows: [], method: 'none' };

  const sheetType = options?.sheetType ?? 'combined';
  const onProgress = options?.onProgress;
  const allRows: StockReconciliationOcrRow[] = [];
  let method = 'unknown';
  let warning: string | undefined;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const kind = detectStockFileKind(file);
    onProgress?.({
      progress: (i / files.length) * 100,
      status: `Extracting ${sheetType} from ${file.name} (${kind}) (${i + 1}/${files.length})...`,
    });
    const result = await extractStockSheetFromFile(file, {
      sheetType,
      onProgress: (inner) => {
        const base = (i / files.length) * 100;
        const span = 100 / files.length;
        onProgress?.({
          progress: base + (inner.progress / 100) * span,
          status: inner.status,
        });
      },
    });
    allRows.push(...result.rows);
    method = result.method;
    if (result.warning) warning = result.warning;
  }

  onProgress?.({ progress: 100, status: `Extraction complete — ${allRows.length} rows` });
  // Already cleaned per file; light pass for consistency
  const cleaned = normalizeOcrRows(allRows, { fromAi: true });
  return {
    rows: cleaned,
    method,
    rawCount: allRows.length,
    keptCount: cleaned.length,
    warning,
  };
}
