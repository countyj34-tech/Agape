// File processing and data extraction service for Mthunzi Parallel
import type { UploadedFile, FileFormat, ParallelReportItem } from '@/types/pos';

// Types for extracted data
export interface ExtractedStockData {
  openingStockItems: ParallelReportItem[];
  closingStockItems: ParallelReportItem[];
  metadata?: Record<string, any>;
}

export interface FileProcessingResult {
  success: boolean;
  data?: ExtractedStockData;
  error?: string;
  warnings?: string[];
}

/**
 * Detect file format based on MIME type or filename
 */
export function detectFileFormat(fileName: string, mimeType?: string): FileFormat {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  const mime = (mimeType || '').toLowerCase();

  if (ext === 'xlsx' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return 'xlsx';
  }
  if (ext === 'csv' || mime === 'text/csv') {
    return 'csv';
  }
  if (ext === 'pdf' || mime === 'application/pdf') {
    return 'pdf';
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) || mime.startsWith('image/')) {
    return 'image';
  }

  return 'unknown';
}

/**
 * Parse CSV data
 */
export function parseCSVData(csvText: string): ParallelReportItem[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const items: ParallelReportItem[] = [];

  // Find column indices
  const nameIdx = headers.findIndex((h) => h.includes('product') || h.includes('name'));
  const qtyIdx = headers.findIndex((h) => h.includes('quantity') || h.includes('qty'));
  const priceIdx = headers.findIndex((h) => h.includes('price') || h.includes('unit'));

  if (nameIdx === -1 || qtyIdx === -1 || priceIdx === -1) {
    console.warn('CSV missing required columns (product name, quantity, price)');
    return items;
  }

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim());
    if (values.length < Math.max(nameIdx, qtyIdx, priceIdx) + 1) continue;

    const name = values[nameIdx];
    const qty = parseFloat(values[qtyIdx]);
    const price = parseFloat(values[priceIdx]);

    if (name && !isNaN(qty) && !isNaN(price)) {
      items.push({
        productName: name,
        quantity: Math.floor(qty),
        unitPrice: price,
        totalValue: qty * price,
      });
    }
  }

  return items;
}

/**
 * Process CSV file
 */
export async function processCSV(file: File): Promise<FileProcessingResult> {
  try {
    const text = await file.text();
    const items = parseCSVData(text);

    if (items.length === 0) {
      return {
        success: false,
        error: 'No valid data found in CSV file. Expected columns: product name, quantity, unit price',
      };
    }

    return {
      success: true,
      data: {
        openingStockItems: items,
        closingStockItems: [],
        metadata: { source: 'csv', fileName: file.name },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to process CSV: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Process Excel file (XLSX)
 * Requires xlsx library
 */
export async function processXLSX(file: File): Promise<FileProcessingResult> {
  try {
    const xlsxModule = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/xlsx@0.18.19/dist/xlsx.full.min.mjs');
    const { read, utils } = xlsxModule as { read: any; utils: any };
    const arrayBuffer = await file.arrayBuffer();
    const workbook = read(arrayBuffer, { type: 'array' });

    if (workbook.SheetNames.length === 0) {
      return {
        success: false,
        error: 'Excel file has no sheets',
      };
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = utils.sheet_to_json(worksheet) as Record<string, any>[];

    if (jsonData.length === 0) {
      return {
        success: false,
        error: 'No data found in Excel sheet',
      };
    }

    const items: ParallelReportItem[] = jsonData
      .map((row) => {
        const keys = Object.keys(row);
        const nameKey = keys.find((k) => k.toLowerCase().includes('product') || k.toLowerCase().includes('name'));
        const qtyKey = keys.find((k) => k.toLowerCase().includes('quantity') || k.toLowerCase().includes('qty'));
        const priceKey = keys.find(
          (k) => k.toLowerCase().includes('price') || k.toLowerCase().includes('unit') || k.toLowerCase().includes('cost')
        );

        if (!nameKey || !qtyKey || !priceKey) return null;

        const name = String(row[nameKey] || '').trim();
        const qty = parseFloat(String(row[qtyKey] || 0));
        const price = parseFloat(String(row[priceKey] || 0));

        if (!name || isNaN(qty) || isNaN(price)) return null;

        return {
          productName: name,
          quantity: Math.floor(qty),
          unitPrice: price,
          totalValue: qty * price,
        };
      })
      .filter((item) => item !== null) as ParallelReportItem[];

    if (items.length === 0) {
      return {
        success: false,
        error: 'No valid products found. Expected columns: product name, quantity, unit price',
      };
    }

    return {
      success: true,
      data: {
        openingStockItems: items,
        closingStockItems: [],
        metadata: {
          source: 'xlsx',
          fileName: file.name,
          sheetName,
          rowCount: items.length,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to process Excel file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Process PDF file - simple text extraction
 * For production, consider using pdfjs-dist or similar
 */
export async function processPDF(file: File): Promise<FileProcessingResult> {
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf');

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocument({ data: arrayBuffer }).promise;

    let allText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      allText += pageText + '\n';
    }

    // Try to extract tabular data (simple approach)
    const items = extractTableFromText(allText);

    if (items.length === 0) {
      return {
        success: false,
        error: 'Could not extract stock data from PDF. Please ensure it contains a table with columns: Product Name, Quantity, Unit Price',
        warnings: ['PDF text extraction may be limited. Manual review recommended.'],
      };
    }

    return {
      success: true,
      data: {
        openingStockItems: items,
        closingStockItems: [],
        metadata: {
          source: 'pdf',
          fileName: file.name,
          pages: pdf.numPages,
          extractedText: true,
        },
      },
      warnings: ['PDF extraction is approximate. Please review extracted data carefully.'],
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to process PDF: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Extract table-like data from unstructured text
 */
function extractTableFromText(text: string): ParallelReportItem[] {
  const items: ParallelReportItem[] = [];
  const lines = text.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    // Look for patterns: "Product Name  Number  Price" or similar
    const tokens = line.split(/\s{2,}|\t/).filter((t) => t.trim());
    if (tokens.length >= 3) {
      const qty = parseFloat(tokens[tokens.length - 2]);
      const price = parseFloat(tokens[tokens.length - 1]);

      if (!isNaN(qty) && !isNaN(price) && qty > 0 && price > 0) {
        const name = tokens.slice(0, -2).join(' ');
        items.push({
          productName: name,
          quantity: Math.floor(qty),
          unitPrice: price,
          totalValue: qty * price,
        });
      }
    }
  }

  return items;
}

/**
 * Process image file - OCR extraction
 * For production, use external OCR service like Tesseract.js or Claude Vision
 */
export async function processImage(file: File): Promise<FileProcessingResult> {
  try {
    // For now, return a placeholder
    // In production, integrate with OCR service like Tesseract.js or Cloud Vision API
    return {
      success: false,
      error: 'Image OCR processing requires manual setup. Please upload Excel or CSV files for automatic processing.',
      warnings: [
        'Image processing requires OCR integration. Consider using:',
        '- Tesseract.js for browser-side OCR',
        '- Google Cloud Vision API',
        '- Azure Computer Vision API',
        'Or manually enter data in Excel/CSV format.',
      ],
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to process image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Main file processing orchestrator
 */
export async function processFile(file: File): Promise<FileProcessingResult> {
  const format = detectFileFormat(file.name, file.type);

  switch (format) {
    case 'xlsx':
      return processXLSX(file);
    case 'csv':
      return processCSV(file);
    case 'pdf':
      return processPDF(file);
    case 'image':
      return processImage(file);
    default:
      return {
        success: false,
        error: `Unsupported file format: ${file.name}. Supported formats: Excel (.xlsx), CSV, PDF, Images (JPG/PNG)`,
      };
  }
}

/**
 * Match extracted products with existing products in the database
 * Returns products with matching status
 */
export function matchProductsWithDatabase(
  extractedItems: ParallelReportItem[],
  databaseProducts: Array<{ id: string; name: string; sellingPrice: number }>
): ParallelReportItem[] {
  return extractedItems.map((item) => {
    // Exact match
    let match = databaseProducts.find((p) => p.name.toLowerCase() === item.productName.toLowerCase());

    // Partial match if no exact match
    if (!match) {
      match = databaseProducts.find((p) => p.name.toLowerCase().includes(item.productName.toLowerCase()) ||
        item.productName.toLowerCase().includes(p.name.toLowerCase())
      );
    }

    return {
      ...item,
      productId: match?.id,
      status: match ? 'matched' : 'new',
      unitPrice: item.unitPrice || match?.sellingPrice || 0,
    };
  });
}

/**
 * Validate extracted data
 */
export function validateExtractedData(data: ExtractedStockData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.openingStockItems || data.openingStockItems.length === 0) {
    errors.push('No opening stock items found');
  }

  data.openingStockItems?.forEach((item, idx) => {
    if (!item.productName) errors.push(`Item ${idx + 1}: Missing product name`);
    if (item.quantity < 0) errors.push(`Item ${idx + 1}: Quantity cannot be negative`);
    if (item.unitPrice < 0) errors.push(`Item ${idx + 1}: Price cannot be negative`);
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
