import * as Tesseract from 'tesseract.js';
import type { SmartImportRow } from '@/lib/vantageOcr';

type PipelineResponse = {
  rows: Array<Record<string, unknown>>;
};

// Track extraction method used
export type ExtractionMethod = 'pipeline' | 'server-gemini' | 'tesseract-ocr' | 'gemini-puter' | 'free-ocr' | 'unknown';
let lastExtractionMethod: ExtractionMethod = 'unknown';

export function getLastExtractionMethod(): ExtractionMethod {
  return lastExtractionMethod;
}

function setExtractionMethod(method: ExtractionMethod) {
  lastExtractionMethod = method;
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('mtz:extraction_method', method);
  }
}

const PUTER_SCRIPT_URL = 'https://js.puter.com/v2/';
const DEFAULT_FREE_OCR_API_URL = 'https://apis-freeocr-ai.p.rapidapi.com/extract';

function readFreeOcrConfig() {
  const viteEnv = (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined')
    ? import.meta.env
    : ({} as Record<string, unknown>);
  const processEnv = (typeof process !== 'undefined' && process.env)
    ? process.env
    : ({} as Record<string, unknown>);

  const apiKey = String(viteEnv.VITE_FREE_OCR_API_KEY || processEnv.VITE_FREE_OCR_API_KEY || '').trim();
  const host = String(viteEnv.VITE_FREE_OCR_HOST || processEnv.VITE_FREE_OCR_HOST || 'apis-freeocr-ai.p.rapidapi.com').trim();
  const apiUrl = String(viteEnv.VITE_FREE_OCR_API_URL || processEnv.VITE_FREE_OCR_API_URL || DEFAULT_FREE_OCR_API_URL).trim();

  return { apiKey, host, apiUrl };
}

function isFreeOcrConfigured() {
  const { apiKey } = readFreeOcrConfig();
  return apiKey.length > 0;
}

function extractTextFromFreeOcrResponse(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;

  if (typeof result === 'object' && result !== null) {
    const response = result as Record<string, unknown>;
    const candidates = [
      response.text,
      response.ocr_text,
      response.extracted_text,
      response.output,
      response.result,
      response.data,
      response.rawText,
      response.raw_text,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
      if (Array.isArray(candidate)) {
        const joined = candidate.map((item) => String(item || '')).filter(Boolean).join('\n');
        if (joined.trim()) {
          return joined;
        }
      }
    }

    if (Array.isArray(response.data)) {
      return response.data.map((item) => String(item || '')).filter(Boolean).join('\n');
    }

    return JSON.stringify(response);
  }

  return '';
}

async function processFilesWithFreeOcr(
  files: File[],
  onProgress?: (update: { progress: number; status: string }) => void
): Promise<SmartImportRow[]> {
  const { apiKey, host, apiUrl } = readFreeOcrConfig();
  if (!apiKey) {
    return processFilesWithTesseract(files, onProgress);
  }

  setExtractionMethod('free-ocr');
  const rows: SmartImportRow[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const isImage = file.type?.startsWith('image/') || /\.(jpe?g|png|bmp|webp|gif|tiff?)$/i.test(file.name);
    if (!isImage) {
      console.warn(`Skipping unsupported free OCR file: ${file.name} (${file.type || 'unknown'})`);
      onProgress?.({
        progress: ((index + 1) / files.length) * 0.5,
        status: `Skipping unsupported OCR file: ${file.name}`,
      });
      continue;
    }

    onProgress?.({ progress: (index / files.length) * 0.5, status: `Extracting text from ${file.name} with free OCR` });

    try {
      const base64 = await fileToBase64(file);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': host,
        },
        body: JSON.stringify({ base64, fileName: file.name, mimeType: file.type || 'application/octet-stream' }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => 'Free OCR service failed');
        throw new Error(`Free OCR request failed: ${text}`);
      }

      const payload = await response.json().catch(async () => {
        return { text: await response.text().catch(() => '') };
      });

      const text = extractTextFromFreeOcrResponse(payload);
      const extractedRows = parseOcrText(text);
      rows.push(...extractedRows);

      onProgress?.({
        progress: 0.5 + ((index + 1) / files.length) * 0.4,
        status: `Extracted ${extractedRows.length} items from ${file.name}`,
      });
    } catch (error) {
      console.warn(`Free OCR failed for ${file.name}:`, error);
      onProgress?.({
        progress: 0.5 + ((index + 1) / files.length) * 0.4,
        status: `Free OCR failed for ${file.name}`,
      });
    }
  }

  onProgress?.({ progress: 1, status: 'Free OCR complete' });
  return rows;
}

async function loadPuterScript(): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('Puter.js can only be loaded in the browser');
  }

  if ((window as any).puter) {
    return;
  }

  if (typeof window.customElements !== 'undefined' && window.customElements.get('puter-dialog')) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${PUTER_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Puter.js')));
      return;
    }

    const script = document.createElement('script');
    script.src = PUTER_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Puter.js'));
    document.head.appendChild(script);
  });
}

export async function initPuter(): Promise<any> {
  // Public initializer: only call when user explicitly enables Gemini
  if (typeof window === 'undefined') {
    throw new Error('Puter.js is only available in the browser');
  }
  if (!(window as any).puter) {
    await loadPuterScript();
  }
  const puter = (window as any).puter;
  if (!puter || typeof (puter.ai?.chat) !== 'function') {
    throw new Error('Puter.js did not initialize correctly');
  }
  return puter;
}

async function ensurePuter(): Promise<any> {
  // internal wrapper kept for compatibility; prefer initPuter from UI
  return initPuter();
}

export async function unloadPuterScript(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const existing = document.querySelector(`script[src="${PUTER_SCRIPT_URL}"]`);
    if (existing && existing.parentElement) existing.parentElement.removeChild(existing);

    // Attempt to gracefully close any open puter socket/connection
    const anyWin = window as any;
    if (anyWin.puter) {
      try {
        if (typeof anyWin.puter.close === 'function') {
          anyWin.puter.close();
        }
        // Attempt to close nested socket if available
        if (anyWin.puter._socket && typeof anyWin.puter._socket.close === 'function') {
          anyWin.puter._socket.close();
        }
      } catch (e) {
        // ignore
      }
      try {
        delete anyWin.puter;
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // ignore unload errors
  }
}

function extractJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const jsonMatch = trimmed.match(/\[.*\]/s);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // fall through and try raw parse
      }
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      // nothing
    }
    return [];
  }

  if (typeof value === 'object' && value !== null) {
    const tentative = (value as Record<string, unknown>);
    if (Array.isArray(tentative.data)) return tentative.data;
    if (Array.isArray(tentative.rows)) return tentative.rows;
    if (typeof tentative.text === 'string') {
      return extractJsonArray(tentative.text);
    }
  }

  return [];
}

function normalizeGeminiRows(payload: unknown): SmartImportRow[] {
  const rawRows = extractJsonArray(payload);
  return rawRows
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((row) => normalizeRow(row));
}

const GEMINI_STOCK_PROMPT = `You are a smart stock import assistant.
You will be given an image of a stock ledger, invoice, receipt, or delivery note.
Extract only useful inventory rows for import.
Return only valid JSON: an array of objects.
Each object should include:
- name: product name
- selling_price: unit price if available
- buying_price: buying price if available
- quantity: quantity or units sold/received if available
Do not add any explanation or extra text.
Do not invent values. If a field is missing, omit it from that object.
If you cannot find any inventory row, return an empty JSON array.
`;

function shouldUseGeminiFallback(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('econnrefused') ||
    message.includes('connection refused') ||
    message.includes('failed to fetch') ||
    message.includes('net::err_connection_refused') ||
    message.includes('socket.io') ||
    message.includes('websocket') ||
    message.includes('timeout') ||
    message.includes('socket is closed') ||
    message.includes('failed to connect') ||
    message.includes('404') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('networkerror') ||
    message.includes('puter.js') ||
    message.includes('puter did not initialize') ||
    message.includes('failed to load puter') ||
    message.includes('puter timeout')
  );
}

function normalizeRow(rawRow: Record<string, unknown>): SmartImportRow {
  const name = String(rawRow.name ?? rawRow.Name ?? rawRow.productName ?? '').trim();
  const buyingPrice = String(rawRow.buyingPrice ?? rawRow.buying_price ?? rawRow.BuyingPrice ?? '0');
  const sellingPrice = String(rawRow.sellingPrice ?? rawRow.selling_price ?? rawRow.SellingPrice ?? buyingPrice);
  const quantity = String(rawRow.quantity ?? rawRow.qty ?? rawRow.Amount ?? rawRow.amount ?? '0');
  const id = String(rawRow.id ?? rawRow.ID ?? rawRow.id ?? crypto.randomUUID() ?? '');

  return {
    id: id || crypto.randomUUID(),
    name,
    buyingPrice: buyingPrice || '0',
    sellingPrice: sellingPrice || buyingPrice || '0',
    quantity: quantity || '0',
  };
}

export async function processFilesWithPipeline(
  files: File[],
  onProgress?: (update: { progress: number; status: string }) => void,
  freeOnly = false
): Promise<SmartImportRow[]> {
  // Quick health check to avoid trying to upload large files when pipeline is down.
  const pingPipeline = async (ms = 1500): Promise<boolean> => {
    try {
      const p = fetch('/api/pipeline/health', { method: 'GET' });
      const res = await Promise.race([
        p,
        new Promise<Response>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
      ]) as Response;
      return res.ok;
    } catch {
      return false;
    }
  };

  const healthy = await pingPipeline().catch(() => false);
  if (!healthy) {
    setExtractionMethod('unknown');
    if (freeOnly) {
      onProgress?.({ progress: 0.01, status: 'Local pipeline offline — using local OCR fallback' });
      return processFilesWithTesseract(files, onProgress);
    }
    onProgress?.({ progress: 0.01, status: 'Local pipeline offline — using server AI fallback' });
    return processFilesWithServerGemini(files, onProgress);
  }

  setExtractionMethod('pipeline');
  const filePayloads = await Promise.all(
    files.map(async (file) => ({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      fileBase64: await fileToBase64(file),
    }))
  );

  onProgress?.({ progress: 0.05, status: 'Uploading to local pipeline' });

  try {
    const response = await fetch('/api/pipeline/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files: filePayloads }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown pipeline error');
      throw new Error(`Pipeline request failed: ${text}`);
    }

    onProgress?.({ progress: 0.6, status: 'Processing uploaded file(s)' });

    const payload = (await response.json()) as PipelineResponse;
    if (!Array.isArray(payload.rows)) {
      throw new Error('Pipeline server returned invalid data');
    }

    const rows = payload.rows.map((row) => normalizeRow(row));
    onProgress?.({ progress: 1, status: 'Pipeline complete' });
    return rows;
  } catch (error) {
    if (shouldUseGeminiFallback(error)) {
      if (freeOnly) {
        setExtractionMethod('tesseract-ocr');
        onProgress?.({ progress: 0.08, status: 'Local pipeline unavailable. Falling back to local OCR' });
        return processFilesWithTesseract(files, onProgress);
      }
      setExtractionMethod('server-gemini');
      onProgress?.({ progress: 0.08, status: 'Local pipeline unavailable. Falling back to server AI' });
      return processFilesWithServerGemini(files, onProgress);
    }
    throw error;
  }
}

// OCR fallback removed: Puter/Gemini is the primary extraction path.

export async function processFilesWithGemini(
  files: File[],
  onProgress?: (update: { progress: number; status: string }) => void
): Promise<SmartImportRow[]> {
  setExtractionMethod('gemini-puter');
  // Retry helper with backoff
  const retryWithBackoff = async <T,>(fn: () => Promise<T>, attempts = 3, baseMs = 500): Promise<T> => {
    let lastErr: any;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const wait = baseMs * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  };

  const withTimeout = <T,>(p: Promise<T>, ms: number) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Puter timeout')), ms);
      p.then((v) => {
        clearTimeout(t);
        resolve(v);
      }).catch((e) => {
        clearTimeout(t);
        reject(e);
      });
    });

  // Ensure Puter initializes; retry a couple times before giving up.
  const puter = await retryWithBackoff(() => ensurePuter(), 3, 500).catch((e) => {
    throw new Error(`Puter initialization failed: ${e instanceof Error ? e.message : String(e)}`);
  });

  const normalizedRows: SmartImportRow[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    onProgress?.({ progress: 0.05 + (index / files.length) * 0.8, status: `Analyzing ${file.name} with Gemini AI` });

    try {
      const attemptFn = () => puter.ai.chat(GEMINI_STOCK_PROMPT, file, { model: 'gemini-3.5-flash', stream: false, maxTokens: 1024 });
      const result = await withTimeout(retryWithBackoff(attemptFn, 2, 300), 20000);
      const rows = normalizeGeminiRows(result);
      normalizedRows.push(...rows);
      onProgress?.({ progress: 0.9 + (index / files.length) * 0.1, status: `Gemini extracted ${rows.length} rows` });
    } catch (e) {
      if (shouldUseGeminiFallback(e)) {
        setExtractionMethod('server-gemini');
        onProgress?.({ progress: 0.05 + (index / files.length) * 0.8, status: `Client Gemini failed, using server fallback for ${file.name}` });
        try {
          const serverRows = await processFilesWithServerGemini([file], onProgress);
          normalizedRows.push(...serverRows);
          continue;
        } catch (srvErr) {
          throw new Error(`Gemini extraction failed for ${file.name}: ${srvErr instanceof Error ? srvErr.message : String(srvErr)}`);
        }
      }
      throw new Error(`Gemini extraction failed for ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  onProgress?.({ progress: 1, status: 'Gemini extraction complete' });
  return normalizedRows;
}

export async function processFilesWithServerGemini(
  files: File[],
  onProgress?: (update: { progress: number; status: string }) => void
): Promise<SmartImportRow[]> {
  setExtractionMethod('server-gemini');
  const payloads = await Promise.all(
    files.map(async (f) => ({
      fileName: f.name,
      mimeType: f.type || 'application/octet-stream',
      fileBase64: await fileToBase64(f),
    }))
  );

  onProgress?.({ progress: 0.05, status: 'Uploading to server AI fallback' });

  try {
    const response = await fetch('/api/gemini/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: payloads }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown server AI error');
      throw new Error(`Server Gemini request failed: ${text}`);
    }

    const payload = (await response.json()) as PipelineResponse;
    if (!Array.isArray(payload.rows)) {
      throw new Error('Server Gemini returned invalid data');
    }

    const rows = payload.rows.map((row) => normalizeRow(row));
    onProgress?.({ progress: 1, status: 'Server AI extraction complete' });
    return rows;
  } catch (error) {
    if (isFreeOcrConfigured()) {
      onProgress?.({ progress: 0.08, status: 'Server AI unavailable — using free OCR fallback' });
      setExtractionMethod('free-ocr');
      return processFilesWithFreeOcr(files, onProgress);
    }
    onProgress?.({ progress: 0.08, status: 'Server AI unavailable — falling back to local OCR' });
    setExtractionMethod('tesseract-ocr');
    return processFilesWithTesseract(files, onProgress);
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unable to convert file to data URL'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
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

export async function processFilesWithTesseract(
  files: File[],
  onProgress?: (update: { progress: number; status: string }) => void
): Promise<SmartImportRow[]> {
  setExtractionMethod('tesseract-ocr');
  // Fallback: client-side OCR using Tesseract.js for basic text extraction
  const rows: SmartImportRow[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const isImage = file.type?.startsWith('image/') || /\.(jpe?g|png|bmp|webp|gif|tiff?)$/i.test(file.name);
    if (!isImage) {
      console.warn(`Skipping unsupported file for browser OCR: ${file.name} (${file.type || 'unknown'})`);
      onProgress?.({
        progress: ((i + 1) / files.length) * 0.5,
        status: `Skipping unsupported OCR file: ${file.name}`,
      });
      continue;
    }

    onProgress?.({ progress: (i / files.length) * 0.5, status: `Extracting text from ${file.name} with Tesseract` });

    try {
      const result = await Tesseract.recognize(file, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing') {
            onProgress?.({
              progress: 0.5 + (i / files.length) * 0.4 * m.progress,
              status: `OCR progress: ${Math.round(m.progress * 100)}%`,
            });
          }
        },
      });

      const text = result.data?.text || '';
      if (typeof Tesseract.terminate === 'function') {
        Tesseract.terminate();
      }

      // Parse OCR text to extract items and amounts
      const extractedRows = parseOcrText(text);
      rows.push(...extractedRows);

      onProgress?.({
        progress: 0.5 + ((i + 1) / files.length) * 0.4,
        status: `Extracted ${extractedRows.length} items from ${file.name}`,
      });
    } catch (e) {
      console.warn(`Tesseract OCR failed for ${file.name}:`, e);
      onProgress?.({
        progress: (i + 1) / files.length,
        status: `Failed to extract from ${file.name} — no data available`,
      });
    }
  }

  onProgress?.({ progress: 1, status: 'Tesseract OCR complete' });
  return rows;
}

function parseOcrText(text: string): SmartImportRow[] {
  if (!text || typeof text !== 'string') return [];

  const rows: SmartImportRow[] = [];
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  // Enhanced parsing patterns:
  // Pattern 1: "Product Name - 150" or "Product Name  150" (name followed by price)
  // Pattern 2: "Product Name (qty: 5) - 150"
  // Pattern 3: Formatted invoice rows

  const priceRegex = /([0-9]+[.,][0-9]{2}|[0-9]+)/;
  const qtyRegex = /(?:qty|quantity|unit|units)[\s:]*([0-9]+)/i;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length < 3) continue;

    // Try to extract price from line
    const priceMatch = line.match(/[\s\-]([0-9]{1,5}[.,][0-9]{2})(?:\s|$|[^\d])/);
    if (!priceMatch) continue;

    const priceStr = priceMatch[1].replace(',', '.');
    const price = parseFloat(priceStr);
    if (!Number.isFinite(price) || price <= 0) continue;

    // Extract product name (everything before the price)
    let name = line.substring(0, priceMatch.index).trim();
    name = name.replace(/[-–—]\s*$/, '').trim(); // Remove trailing dashes
    name = name.replace(/^\d+[\s.]/, '').trim(); // Remove leading numbers
    name = name.replace(/[()[\]{}]/g, '').trim(); // Remove brackets
    
    if (name.length < 2) continue;

    // Try to extract quantity from line or next line
    let quantity = 1;
    const qtyLineMatch = line.match(qtyRegex);
    if (qtyLineMatch) {
      quantity = parseInt(qtyLineMatch[1], 10);
    } else if (i + 1 < lines.length) {
      const nextLineQty = lines[i + 1].match(qtyRegex);
      if (nextLineQty) {
        quantity = parseInt(nextLineQty[1], 10);
      }
    }

    // Smart cost estimation: try to find buying price
    // Check if line has two prices (buying and selling)
    const allPrices = line.match(/[0-9]{1,5}[.,][0-9]{2}/g) || [];
    let buyingPrice = Math.round(price * 0.6); // Default: 60% markup

    if (allPrices.length >= 2) {
      const first = parseFloat(allPrices[0].replace(',', '.'));
      const second = parseFloat(allPrices[1].replace(',', '.'));
      if (first < second) {
        buyingPrice = Math.round(first);
      } else if (second < price) {
        buyingPrice = Math.round(second);
      }
    }

    // Validate and add row
    if (name && price > 0) {
      rows.push({
        id: crypto.randomUUID(),
        name,
        buyingPrice: String(Math.max(1, buyingPrice)),
        sellingPrice: String(Math.round(price)),
        quantity: String(Math.max(1, quantity)),
      });
    }
  }

  return rows;
}

export function validateDraftRows(rows: SmartImportRow[]) {
  return rows
    .map((row, index) => {
      const issues: string[] = [];
      if (!row.name || !row.name.trim()) issues.push('Missing item name');
      const buying = Number(row.buyingPrice);
      if (!Number.isFinite(buying) || buying <= 0) issues.push('Missing or invalid buying price');
      const selling = Number(row.sellingPrice);
      if (!Number.isFinite(selling) || selling <= 0) issues.push('Missing or invalid selling price');
      const quantity = Number(row.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) issues.push('Missing or invalid quantity');
      return { index, name: row.name, issues };
    })
    .filter((item) => item.issues.length > 0);
}
