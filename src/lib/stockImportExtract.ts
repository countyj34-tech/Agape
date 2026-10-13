import type { SmartImportRow } from '@/lib/vantageOcr';
import { cleanOcrProductName } from '@/lib/stockReconciliationClean';
import {
  detectStockFileKind,
  parseCsvStockFile,
  parseExcelStockFile,
  parsePdfStockFile,
  renderPdfPagesToImageFiles,
  STOCK_FILE_ACCEPT,
} from '@/lib/stockReconciliationFileParse';
import { extractStockSheetFromFile } from '@/lib/stockReconciliationOcr';
import type { StockReconciliationOcrRow } from '@/types/pos';

export { STOCK_FILE_ACCEPT };

export type StockImportProgress = { progress: number; status: string };

function toSmartRow(args: {
  name: string;
  quantity?: number;
  buyingPrice?: number;
  sellingPrice?: number;
}): SmartImportRow | null {
  const name = cleanOcrProductName(args.name);
  if (name.length < 2) return null;

  const quantity = Math.max(0, Math.round(Number(args.quantity) || 0));
  const selling = Number(args.sellingPrice) || 0;
  const buyingExplicit = Number(args.buyingPrice) || 0;
  const buying =
    buyingExplicit > 0 ? buyingExplicit : selling > 0 ? Math.round(selling * 0.65) : 0;

  return {
    id: crypto.randomUUID(),
    name,
    buyingPrice: String(Math.max(0, buying)),
    sellingPrice: String(Math.max(0, selling)),
    quantity: String(Math.max(1, quantity || 1)),
  };
}

function stockRowsToSmartImport(rows: StockReconciliationOcrRow[]): SmartImportRow[] {
  const out: SmartImportRow[] = [];
  for (const row of rows) {
    const qty = row.quantity || row.opening || row.closing || row.refill || 0;
    const smart = toSmartRow({
      name: row.rawName,
      quantity: qty,
      sellingPrice: row.unitPrice,
      buyingPrice: row.buyingPrice,
    });
    if (smart) out.push(smart);
  }
  return out;
}

/** Extract inventory draft rows from images / PDF / Excel / CSV */
export async function extractSmartImportRowsFromFiles(
  files: File[],
  onProgress?: (update: StockImportProgress) => void
): Promise<{ rows: SmartImportRow[]; method: string }> {
  if (!files.length) return { rows: [], method: 'none' };

  const all: SmartImportRow[] = [];
  let method = 'unknown';

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const kind = detectStockFileKind(file);
    const base = (i / files.length) * 100;
    const span = 100 / files.length;

    const report = (progress: number, status: string) =>
      onProgress?.({ progress: base + (progress / 100) * span, status });

    report(5, `Reading ${file.name} (${kind})...`);

    try {
      if (kind === 'excel') {
        const rows = await parseExcelStockFile(file, 'opening');
        all.push(...stockRowsToSmartImport(rows));
        method = 'excel';
        report(100, `Excel: ${rows.length} products from ${file.name}`);
        continue;
      }

      if (kind === 'csv') {
        const rows = await parseCsvStockFile(file, 'opening');
        all.push(...stockRowsToSmartImport(rows));
        method = 'csv';
        report(100, `CSV: ${rows.length} products from ${file.name}`);
        continue;
      }

      if (kind === 'pdf') {
        report(15, `Reading PDF text from ${file.name}...`);
        const pdf = await parsePdfStockFile(file, 'opening');
        if (pdf.rows.length > 0) {
          all.push(...stockRowsToSmartImport(pdf.rows));
          method = 'pdf-text';
          report(100, `PDF: ${pdf.rows.length} products from ${file.name}`);
          continue;
        }

        // Scanned / image-only PDF → render pages and OCR each
        report(25, 'PDF has little text — converting pages for OCR...');
        try {
          const pageImages = await renderPdfPagesToImageFiles(file);
          if (!pageImages.length) {
            report(100, `Could not render pages from ${file.name}`);
            continue;
          }
          for (let p = 0; p < pageImages.length; p += 1) {
            const pageFile = pageImages[p];
            report(
              30 + Math.round((p / pageImages.length) * 60),
              `OCR page ${p + 1}/${pageImages.length} of ${file.name}...`
            );
            const result = await extractStockSheetFromFile(pageFile, {
              sheetType: 'opening',
              onProgress: (u) =>
                report(
                  30 + Math.round(((p + u.progress / 100) / pageImages.length) * 60),
                  u.status
                ),
            });
            all.push(...stockRowsToSmartImport(result.rows));
            method = `pdf-ocr:${result.method}`;
          }
          report(100, `PDF OCR done for ${file.name}`);
          continue;
        } catch (ocrErr) {
          console.warn('PDF page OCR failed:', ocrErr);
          report(100, `PDF OCR failed for ${file.name}`);
          continue;
        }
      }

      if (kind === 'image') {
        const result = await extractStockSheetFromFile(file, {
          sheetType: 'opening',
          onProgress: (u) => report(u.progress, u.status),
        });
        all.push(...stockRowsToSmartImport(result.rows));
        method = result.method;
        continue;
      }

      report(100, `Skipped unsupported file: ${file.name}`);
    } catch (error) {
      console.error(`Failed to extract ${file.name}:`, error);
      report(100, `Failed: ${file.name} — ${error instanceof Error ? error.message : 'error'}`);
    }
  }

  // Deduplicate by cleaned name — sum quantities when same product appears again
  const byName = new Map<string, SmartImportRow>();
  for (const row of all) {
    const key = row.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...row });
      continue;
    }
    const qty = Number(existing.quantity || 0) + Number(row.quantity || 0);
    existing.quantity = String(Math.max(1, qty));
    if (!Number(existing.sellingPrice) && Number(row.sellingPrice)) {
      existing.sellingPrice = row.sellingPrice;
    }
    if (!Number(existing.buyingPrice) && Number(row.buyingPrice)) {
      existing.buyingPrice = row.buyingPrice;
    }
  }
  const unique = Array.from(byName.values());

  onProgress?.({ progress: 100, status: `Ready — ${unique.length} products` });
  return { rows: unique, method };
}

/** Soft validation for inventory import: name + quantity required; prices optional */
export function validateStockImportRows(rows: SmartImportRow[]) {
  return rows
    .map((row, index) => {
      const issues: string[] = [];
      if (!row.name?.trim()) issues.push('Missing product name');
      const quantity = Number(row.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) issues.push('Invalid quantity');
      return { index, name: row.name, issues };
    })
    .filter((item) => item.issues.length > 0);
}
