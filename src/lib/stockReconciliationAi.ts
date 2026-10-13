import { cleanOcrProductName } from '@/lib/stockReconciliationClean';
import type { StockReconciliationOcrRow } from '@/types/pos';

export type StockSheetType = 'opening' | 'closing' | 'refill' | 'combined';
export type ExtractionMethod = 'python-easyocr' | 'tesseract-stock-sheet' | 'failed' | 'unknown';

function parseQuantity(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/[^0-9.\-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.max(0, num) : 0;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unable to convert file to base64'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

export function mapAiRowsToStockSheet(
  rows: unknown[],
  sheetType: StockSheetType
): StockReconciliationOcrRow[] {
  const mapped: StockReconciliationOcrRow[] = [];

  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const rawName = cleanOcrProductName(
      String(row.name ?? row.product ?? row.product_name ?? row.item ?? '')
    );
    if (rawName.length < 2) continue;

    const opening = parseQuantity(
      row.opening ?? (sheetType === 'opening' ? row.quantity ?? row.qty : undefined)
    );
    const closing = parseQuantity(
      row.closing ?? (sheetType === 'closing' ? row.quantity ?? row.qty : undefined)
    );
    const refill = parseQuantity(
      row.refill ?? (sheetType === 'refill' ? row.quantity ?? row.qty : undefined)
    );

    const hasStock = opening > 0 || closing > 0 || refill > 0;
    if (!hasStock && sheetType !== 'combined') continue;

    mapped.push({
      rawName,
      quantity: opening || closing || refill,
      opening: sheetType === 'opening' || sheetType === 'combined' ? opening : undefined,
      closing: sheetType === 'closing' || sheetType === 'combined' ? closing : undefined,
      refill: sheetType === 'refill' || sheetType === 'combined' ? refill : undefined,
      unitPrice: parseQuantity(row.selling_price ?? row.unit_price ?? row.price) || undefined,
    });
  }

  return mapped;
}

/** Call local Python EasyOCR via pipeline server — never opens Puter */
export async function extractStockSheetWithVisionAi(
  file: File,
  sheetType: StockSheetType,
  onProgress?: (update: { progress: number; status: string }) => void
): Promise<{ rows: StockReconciliationOcrRow[]; method: ExtractionMethod; warning?: string }> {
  onProgress?.({ progress: 15, status: `Python OCR reading ${file.name}...` });

  try {
    const fileBase64 = await fileToBase64(file);
    onProgress?.({ progress: 40, status: 'Running local EasyOCR (OpenCV cleaned)...' });

    const response = await fetch('/api/stock-reconciliation/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetType,
        files: [
          {
            fileName: file.name,
            mimeType: file.type || 'image/jpeg',
            fileBase64,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Python OCR unavailable');
      throw new Error(text);
    }

    const payload = (await response.json()) as { rows?: unknown[]; method?: string; error?: string };
    const rows = mapAiRowsToStockSheet(payload.rows ?? [], sheetType);

    if (rows.length > 0) {
      onProgress?.({ progress: 100, status: `Extracted ${rows.length} products` });
      return { rows, method: 'python-easyocr' };
    }

    return {
      rows: [],
      method: 'python-easyocr',
      warning: 'Python OCR found no rows. Trying browser OCR next — or use a clearer photo.',
    };
  } catch (error) {
    console.warn('Python EasyOCR extraction failed:', error);
    return {
      rows: [],
      method: 'unknown',
      warning:
        'Local Python OCR failed. Make sure `npm run pipeline:server` is running and EasyOCR is installed. Falling back to browser OCR.',
    };
  }
}
