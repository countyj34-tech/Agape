export type VantageOcrRowTuple = [string, number, number, number];

export interface SmartImportRow {
  id: string;
  name: string;
  buyingPrice: string;
  sellingPrice: string;
  quantity: string;
  localProductId?: string;
}

export interface VantageOcrExtractedRow {
  name: string;
  selling_price: number;
  amount?: number; // total amount handwritten/printed in sheet
}

export interface VantageOcrProgressUpdate {
  progress: number;
  status: string;
}

export interface VantageOcrSourceResult {
  rows: VantageOcrExtractedRow[];
}

const VANTAGE_OCR_FEW_SHOT_EXAMPLES: VantageOcrExtractedRow[] = [
  { name: 'BLACK LABEL SMALL', selling_price: 25, amount: 600 },
  { name: 'BLACK LABEL CANNED', selling_price: 40, amount: 960 },
  { name: 'MILLER GENUINE DRAFT', selling_price: 60, amount: 1200 },
  { name: 'AMARULA', selling_price: 30, amount: 690 },
  { name: 'KHYBER SMALL', selling_price: 22, amount: 528 },
  { name: 'KHYBER BIG', selling_price: 44, amount: 1056 },
  { name: 'WATER 500ML', selling_price: 12, amount: 240 },
  { name: 'RED BULL', selling_price: 45, amount: 1080 },
  { name: 'CASTLE LITE', selling_price: 27, amount: 648 },
  { name: 'HEINEKEN', selling_price: 32, amount: 768 },
  { name: 'JOHNNIE WALKER RED', selling_price: 180, amount: 4320 },
  { name: 'VODKA SMALL', selling_price: 20, amount: 480 },
  { name: 'VODKA BIG', selling_price: 38, amount: 912 },
  { name: 'COCA COLA 2L', selling_price: 35, amount: 840 },
  { name: 'SPIRIT COOLER', selling_price: 28, amount: 672 },
  { name: 'FANTA 500ML', selling_price: 15, amount: 360 },
  { name: 'STELLA ARTOIS', selling_price: 34, amount: 816 },
  { name: 'GUINNESS', selling_price: 45, amount: 1080 },
  { name: 'JOHNNIE WALKER BLACK', selling_price: 210, amount: 5040 },
  { name: 'AMSTEL LIGHT', selling_price: 26, amount: 624 },
];

type VantageOcrWorkerPayload = {
  rows?: unknown;
  rawText?: string;
  words?: unknown[];
};

function buildVantageOcrPrompt() {
  return `${VANTAGE_OCR_PROMPT_EXACT}\n\nExamples:\n${JSON.stringify(VANTAGE_OCR_FEW_SHOT_EXAMPLES, null, 2)}`;
}

export function validateOcrRows(rows: VantageOcrExtractedRow[]) {
  return rows.map((row, index) => {
    const issues: string[] = [];
    if (!row.name || !row.name.trim()) issues.push('Missing item name');
    if (!Number.isFinite(row.selling_price) || row.selling_price <= 0) issues.push('Missing or invalid unit price');
    if (row.amount !== undefined && (!Number.isFinite(row.amount) || row.amount <= 0)) issues.push('Missing or invalid amount');
    return { index, name: row.name, issues };
  }).filter((item) => item.issues.length > 0);
}

type RawOcrWord = {
  text?: string;
  symbol?: string;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  bbox?: { x0?: number; x1?: number; y0?: number; y1?: number };
};

type NormalizedWord = {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  isNumeric: boolean;
  numValue?: number;
};

function safeNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeRowObject(entry: any): VantageOcrExtractedRow {
  return {
    name: String(entry?.name ?? entry?.productName ?? '').trim(),
    selling_price: safeNumber(entry?.selling_price ?? entry?.sellingPrice ?? entry?.unit_price ?? entry?.unitPrice ?? 0) ?? 0,
    amount: entry?.amount !== undefined
      ? safeNumber(entry?.amount)
      : safeNumber(entry?.total ?? entry?.amt ?? entry?.amount),
  };
}

function getWordBounds(word: RawOcrWord): NormalizedWord | null {
  const text = String(word?.text ?? word?.symbol ?? '').trim();
  if (!text) return null;

  const left = Number(word?.x0 ?? word?.left ?? word?.bbox?.x0);
  const top = Number(word?.y0 ?? word?.top ?? word?.bbox?.y0);
  const rightSource = word?.x1 ?? (word?.left !== undefined && word?.width !== undefined ? word.left + word.width : undefined) ?? word?.bbox?.x1;
  const bottomSource = word?.y1 ?? (word?.top !== undefined && word?.height !== undefined ? word.top + word.height : undefined) ?? word?.bbox?.y1;

  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;

  const right = Number(rightSource);
  const bottom = Number(bottomSource);
  const width = Number.isFinite(right) ? Math.max(1, right - left) : Number(word?.width ?? 1);
  const height = Number.isFinite(bottom) ? Math.max(1, bottom - top) : Number(word?.height ?? 1);
  const centerX = Number.isFinite(right) ? left + width / 2 : left + width / 2;
  const centerY = Number.isFinite(bottom) ? top + height / 2 : top + height / 2;

  const numericMatch = /^[\d.,]+$/.test(text);
  const numValue = numericMatch ? Number(text.replace(',', '.')) : NaN;

  return {
    text,
    left,
    right: Number.isFinite(right) ? right : left + width,
    top,
    bottom: Number.isFinite(bottom) ? bottom : top + height,
    centerX,
    centerY,
    width,
    height,
    isNumeric: numericMatch && Number.isFinite(numValue),
    numValue: Number.isFinite(numValue) ? numValue : undefined,
  };
}

function normalizeRowsFromText(text: string): VantageOcrExtractedRow[] {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    const numericMatches = cleaned.match(/[\d]+[.,]?\d*/g) || [];
    const sellingPrice = numericMatches.length >= 2
      ? Number(numericMatches[numericMatches.length - 2].replace(',', '.'))
      : numericMatches.length === 1
        ? Number(numericMatches[0].replace(',', '.'))
        : 0;
    const amount = numericMatches.length >= 2
      ? Number(numericMatches[numericMatches.length - 1].replace(',', '.'))
      : undefined;
    const name = cleaned.replace(/(\d+[.,]?\d*\s*)+$/g, '').trim() || cleaned;

    return {
      name,
      selling_price: Number.isFinite(sellingPrice) ? sellingPrice : 0,
      amount: Number.isFinite(amount ?? NaN) ? amount : undefined,
    };
  }).filter((row) => row.name.length > 0);
}

function normalizeRowsFromWords(words: unknown[], rawText?: string): VantageOcrExtractedRow[] {
  const normalized = (words as RawOcrWord[])
    .map(getWordBounds)
    .filter((word): word is NormalizedWord => word !== null)
    .sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);

  if (!normalized.length) {
    return normalizeRowsFromText(rawText ?? '');
  }

  const heightValues = normalized.map((w) => w.height).filter((value) => value > 0);
  const averageHeight = heightValues.length > 0
    ? heightValues.reduce((sum, value) => sum + value, 0) / heightValues.length
    : 14;
  const lineThreshold = Math.max(8, averageHeight * 0.6);

  const lines: NormalizedWord[][] = [];
  let currentLine: NormalizedWord[] = [];
  let currentCenterY = 0;

  for (const word of normalized) {
    if (!currentLine.length || Math.abs(word.centerY - currentCenterY) <= lineThreshold) {
      currentLine.push(word);
      currentCenterY = currentLine.reduce((sum, entry) => sum + entry.centerY, 0) / currentLine.length;
      continue;
    }

    lines.push(currentLine);
    currentLine = [word];
    currentCenterY = word.centerY;
  }

  if (currentLine.length) {
    lines.push(currentLine);
  }

  const numericWords = normalized.filter((w) => w.isNumeric && w.numValue !== undefined);
  const numericClusters: NormalizedWord[][] = [];
  const clusterThreshold = Math.max(30, averageHeight * 1.5);

  for (const word of numericWords) {
    const lastCluster = numericClusters[numericClusters.length - 1];
    if (!lastCluster || word.centerX - lastCluster[lastCluster.length - 1].centerX > clusterThreshold) {
      numericClusters.push([word]);
    } else {
      lastCluster.push(word);
    }
  }

  const clusterCenters = numericClusters.map((cluster) =>
    cluster.reduce((sum, item) => sum + item.centerX, 0) / cluster.length
  );

  const getClusterIndex = (word: NormalizedWord) => {
    let bestIndex = 0;
    let bestDistance = Infinity;
    clusterCenters.forEach((center, index) => {
      const distance = Math.abs(center - word.centerX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  };

  const rawLines = rawText
    ? String(rawText)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  return lines
    .map((line, index) => {
      const sortedLine = line.slice().sort((a, b) => a.left - b.left);
      const lineNumeric = sortedLine.filter((word) => word.isNumeric && word.numValue !== undefined);
      const firstNumeric = lineNumeric[0];
      const beforeFirstNumber = firstNumeric
        ? sortedLine.filter((word) => word.right <= firstNumeric.left && !word.isNumeric)
        : sortedLine.filter((word) => !word.isNumeric);
      let name = beforeFirstNumber.map((word) => word.text).join(' ').trim();

      if (!name) {
        name = sortedLine
          .filter((word) => !word.isNumeric)
          .map((word) => word.text)
          .join(' ')
          .trim();
      }

      if (!name && rawLines[index]) {
        name = rawLines[index].replace(/(\d+[.,]?\d*\s*)+$/g, '').trim();
      }

      let selling_price: number | undefined;
      let amount: number | undefined;

      if (lineNumeric.length >= 2) {
        selling_price = lineNumeric[0].numValue;
        amount = lineNumeric[lineNumeric.length - 1].numValue;
      } else if (lineNumeric.length === 1) {
        const token = lineNumeric[0];
        const clusterIndex = numericClusters.length ? getClusterIndex(token) : 0;
        if (numericClusters.length > 1 && clusterIndex === numericClusters.length - 1) {
          amount = token.numValue;
        } else {
          selling_price = token.numValue;
        }
      }

      return {
        name,
        selling_price: selling_price ?? 0,
        amount: Number.isFinite(amount ?? NaN) ? amount : undefined,
      } as VantageOcrExtractedRow;
    })
    .filter((row) => {
      if (!row.name || !row.name.trim()) return false;
      const normalizedName = row.name.toLowerCase();
      return !/(item|items|unit price|selling price|amount|total|qty|quantity|price|description|header)/i.test(normalizedName);
    });
}

export const VANTAGE_OCR_PROMPT = `Analyze the attached image. It is a structured tabular sales sheet.

Ignore the vertical and horizontal grid lines.

Target Columns: Extract the 'ITEMS' column as name and the 'UNIT PRICE' column as selling_price.

Format: Output the result strictly as a JSON array of objects, for example: [{"name": "BLACK LABEL SMALL", "selling_price": 25}, {"name": "BLACK LABEL CANNED", "selling_price": 40}].

Cleanup: Do not include any headers, empty rows, or extra text in your output.`;

export const VANTAGE_OCR_PROMPT_EXACT = `You will be given an uploaded document (image, PDF, or DOCX). Extract EXACT words and numeric values from the tabular content only.

Requirements:
- Return only a JSON array of objects with keys: "name" (string), "selling_price" (number), and "amount" (number, total monetary amount found in the sheet for the row).
- Do not include headings, notes, dates, or unrelated text — only the product name text and the numeric prices/amounts.
- Preserve exact spelled words found in the document (do not normalize or expand abbreviations).
- For PDFs or DOCX files, assume the document contains tabular rows; extract rows in reading order.

Example output: [{"name": "BLACK LABEL SMALL", "selling_price": 25, "amount": 325}, {"name": "BLACK LABEL CANNED", "selling_price": 40, "amount": 540}]

If nothing relevant is found, return an empty JSON array: []`;

function readVantageBaseUrl(): string {
  const viteEnv = (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined') ? import.meta.env : {};
  const processEnv = typeof process !== 'undefined' && process.env ? process.env : {};
  return String(
    viteEnv.VITE_VANTAGE_URL
      || processEnv.VITE_VANTAGE_URL
      || viteEnv.VITE_VANTAGE_API_URL
      || processEnv.VITE_VANTAGE_API_URL
      || ''
  ).replace(/\/$/, '');
}

function readSupabaseBaseUrl(): string {
  const viteEnv = (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined') ? import.meta.env : {};
  const processEnv = typeof process !== 'undefined' && process.env ? process.env : {};
  return String(
    viteEnv.VITE_SUPABASE_URL
      || processEnv.VITE_SUPABASE_URL
      || ''
  ).replace(/\/$/, '');
}

function readVantageToken(): string {
  const viteEnv = (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined') ? import.meta.env : {};
  const processEnv = typeof process !== 'undefined' && process.env ? process.env : {};
  return String(
    viteEnv.VITE_VANTAGE_TOKEN
      || processEnv.VITE_VANTAGE_TOKEN
      || viteEnv.VITE_VANTAGE_BEARER_TOKEN
      || processEnv.VITE_VANTAGE_BEARER_TOKEN
      || ''
  ).trim();
}

function readOcrEndpoint(): string {
  const viteEnv = (typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined') ? import.meta.env : {};
  const processEnv = typeof process !== 'undefined' && process.env ? process.env : {};
  const supabaseBaseUrl = readSupabaseBaseUrl();
  const fallback = supabaseBaseUrl
    ? `${supabaseBaseUrl}/functions/v1/vantage-ocr`
    : `${readVantageBaseUrl()}/functions/v1/vantage-ocr`;
  return String(
    viteEnv.VITE_VANTAGE_OCR_URL
      || processEnv.VITE_VANTAGE_OCR_URL
      || fallback
  ).replace(/\/$/, '');
}

function buildOcrEndpointCandidates(endpoint: string): string[] {
  const clean = endpoint.replace(/\/$/, '');
  const candidates = new Set<string>([clean]);

  if (clean.includes('/functions/v1/')) {
    candidates.add(clean.replace('/functions/v1/vantage-ocr', '/functions/v1/ocr'));
    candidates.add(clean.replace('/functions/v1/vantage-ocr', '/api/v1/ocr'));
    candidates.add(clean.replace('/functions/v1/ocr', '/functions/v1/vantage-ocr'));
    candidates.add(clean.replace('/functions/v1/ocr', '/api/v1/ocr'));
  } else if (clean.includes('/api/v1/')) {
    candidates.add(clean.replace('/api/v1/ocr', '/functions/v1/vantage-ocr'));
    candidates.add(clean.replace('/api/v1/ocr', '/functions/v1/ocr'));
  } else {
    candidates.add(`${clean}/functions/v1/vantage-ocr`);
    candidates.add(`${clean}/functions/v1/ocr`);
    candidates.add(`${clean}/api/v1/ocr`);
  }

  return Array.from(candidates);
}

function chooseNumeric(primary: number | undefined, secondary: number | undefined): number | undefined {
  if (Number.isFinite(primary) && primary > 0) return primary;
  if (Number.isFinite(secondary) && secondary > 0) return secondary;
  if (Number.isFinite(primary)) return primary;
  if (Number.isFinite(secondary)) return secondary;
  return undefined;
}

function mergeRow(remote: VantageOcrExtractedRow, local?: VantageOcrExtractedRow): VantageOcrExtractedRow {
  return {
    name: String(remote.name || local?.name || '').trim(),
    selling_price: chooseNumeric(remote.selling_price, local?.selling_price) ?? 0,
    amount: chooseNumeric(remote.amount, local?.amount),
  };
}

function normalizeRows(payload: unknown): VantageOcrExtractedRow[] {
  const payloadObject = payload as VantageOcrWorkerPayload;
  const localRows = Array.isArray(payloadObject?.words)
    ? normalizeRowsFromWords(payloadObject.words, typeof payloadObject.rawText === 'string' ? payloadObject.rawText : undefined)
    : undefined;

  const rawRows = Array.isArray(payload)
    ? payload
    : Array.isArray(payloadObject?.rows)
      ? payloadObject.rows
      : Array.isArray((payload as any)?.data)
        ? (payload as any).data
        : [];

  const structuredRows: VantageOcrExtractedRow[] = rawRows
    .map((entry: any) => {
      if (Array.isArray(entry)) {
        const [name, sellingPrice, amount] = entry as unknown as (string | number)[];
        return {
          name: String(name ?? '').trim(),
          selling_price: safeNumber(sellingPrice) ?? 0,
          amount: amount === undefined ? undefined : safeNumber(amount),
        } satisfies VantageOcrExtractedRow;
      }

      return normalizeRowObject(entry);
    })
    .filter((row) => row.name.length > 0);

  const mergedRows = structuredRows.length && localRows && localRows.length
    ? structuredRows.map((remoteRow, index) => mergeRow(remoteRow, localRows[index]))
    : structuredRows.length
      ? structuredRows
      : localRows ?? [];

  return mergedRows.filter((row) => row.name.length > 0);
}

function toDraftRows(rows: VantageOcrExtractedRow[]): SmartImportRow[] {
  function inferUnitsPerContainer(name: string): number {
    const n = String(name || '').toLowerCase();
    // Business rules
    if (n.includes('whisk')) return 21;
    if (n.includes('amarula') || n.includes('best cream')) return 23;
    // Konyagi rules
    if (n.includes('konyagi') && n.includes('small')) return 24;
    if (n.includes('konyagi') && n.includes('big')) return 12;
    // Water / Drinks / Life Way
    if (n.includes('water') || n.includes('drink') || n.includes('life way') || n.includes('power') || n.includes('red bull')) return 12;
    // Lagers: detect common lager keywords
    const lagerKeywords = ['lager', 'black label', 'castle', 'budweiser', 'corona', 'heineken', 'windhoek', 'mossi', 'msi', 'moss', 'stella'];
    if (lagerKeywords.some((k) => n.includes(k))) return 24;
    // Default: 1 (fallback)
    return 1;
  }

  return rows.map((row) => {
    const selling = Number(row.selling_price) || 0;
    const amount = row.amount !== undefined && Number.isFinite(Number(row.amount)) ? Number(row.amount) : undefined;
    const unitsPerContainer = inferUnitsPerContainer(row.name);

    // Buying price per unit according to business rule: amount divided by units per container
    const buyingPrice = amount !== undefined && unitsPerContainer > 0 ? Number((amount / unitsPerContainer).toFixed(2)) : 0;

    // quantity sold approximated from amount / selling price when possible
    const qty = amount !== undefined && selling > 0 ? Math.round(amount / selling) : 0;

    return {
      id: crypto.randomUUID(),
      name: row.name,
      buyingPrice: String(buyingPrice),
      sellingPrice: String(selling),
      quantity: String(qty || 0),
    };
  });
}

export async function postToVantageOCR(
  file: File,
  onProgress?: (update: VantageOcrProgressUpdate) => void
): Promise<VantageOcrExtractedRow[]> {
  const endpoint = readOcrEndpoint();

  if (!endpoint) {
    throw new Error('Missing Vantage OCR endpoint configuration');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Background workers are not supported in this browser');
  }

  return await new Promise<VantageOcrExtractedRow[]>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/vantageOcrWorker.ts', import.meta.url), { type: 'module' });
    const requestId = crypto.randomUUID();
    let finished = false;

    console.info('Vantage OCR endpoint:', endpoint);

    const cleanup = () => {
      if (finished) return;
      finished = true;
      try {
        worker.terminate();
      } catch {
        // ignore
      }
    };

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { requestId: string; type: 'progress'; progress: number; status: string }
        | { requestId: string; type: 'result'; rows: unknown; rawText?: string; words?: unknown[] }
        | { requestId: string; type: 'error'; error: string };

      if (!message || message.requestId !== requestId) return;

      if (message.type === 'progress') {
        onProgress?.({ progress: message.progress, status: message.status });
        return;
      }

      cleanup();
      if (message.type === 'error') {
        reject(new Error(message.error));
        return;
      }

      resolve(normalizeRows(message));
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Vantage OCR worker failed'));
    };

    worker.postMessage({
      requestId,
      file,
      endpoints: buildOcrEndpointCandidates(endpoint),
      prompt: buildVantageOcrPrompt(),
    });
  });
}

export function mapVantageOcrRowsToDraftRows(rows: VantageOcrExtractedRow[]): SmartImportRow[] {
  return toDraftRows(rows);
}

export async function syncImportedStockToVantage(args: {
  storeId?: string | null;
  sourceFileName?: string;
  rows: SmartImportRow[];
}): Promise<void> {
  const baseUrl = readVantageBaseUrl();
  const token = readVantageToken();

  if (!baseUrl) {
    throw new Error('Missing Vantage sync endpoint configuration');
  }

  if (!token) {
    throw new Error('Missing Vantage bearer token');
  }

  const response = await fetch(`${baseUrl}/api/v1/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      source: 'ai-stock-import',
      storeId: args.storeId ?? null,
      sourceFileName: args.sourceFileName ?? null,
      importedAt: new Date().toISOString(),
      items: args.rows.map((row) => ({
        name: row.name,
        selling_price: Number(row.sellingPrice) || 0,
        buying_price: Number(row.buyingPrice) || 0,
        quantity: Number(row.quantity) || 0,
      })),
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => 'Vantage sync failed');
    throw new Error(message || `Vantage sync failed (${response.status})`);
  }
}
