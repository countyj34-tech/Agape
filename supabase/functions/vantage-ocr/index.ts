/**
 * Supabase Edge Function: vantage-ocr
 * Accepts an uploaded receipt/stock-book image and returns normalized rows for
 * the POS smart import pipeline.
 *
 * System prompt:
 *   You are an expert document parser. Analyze the attached sales sheet image.
 *   Focus strictly on the table with headers 'ITEMS', 'UNIT PRICE', and 'AMOUNT'.
 *   Extract rows starting from item 1 ('BLACK LABEL SMALL') to item 65 ('GLENFFIDICH 12').
 *   Ignore all other text (titles, empty lines, grid lines).
 *   Return ONLY a JSON array in this format:
 *   [{"name": "BLACK LABEL SMALL", "selling_price": 25}, {"name": "BLACK LABEL CANNED", "selling_price": 40}, ...]
 *   Do not include markdown formatting like json ... , just return the pure raw JSON.
 *
 * The current provider path still uses OCR.Space via OCR_SPACE_API_KEY (or
 * VITE_OCR_SPACE_API_KEY), then applies table-oriented cleanup before returning
 * the extracted rows.
 */

import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { unzip } from 'https://deno.land/std@0.203.0/archive/zip.ts';

type OcrRow = {
  name: string;
  selling_price: number;
};

type ExtractedJsonRow = {
  name?: unknown;
  selling_price?: unknown;
  sellingPrice?: unknown;
};

const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey, x-client-meta, x-supabase-auth',
};

function getEnv(name: string): string {
  return Deno.env.get(name) || '';
}

function getOcrSpaceConfig() {
  const apiKey = getEnv('OCR_SPACE_API_KEY') || getEnv('VITE_OCR_SPACE_API_KEY');
  const apiUrl = getEnv('OCR_SPACE_API_URL') || getEnv('VITE_OCR_SPACE_API_URL') || 'https://api.ocr.space/parse/image';
  return { apiKey, apiUrl };
}

function normalizeRowsFromText(text: string): OcrRow[] {
  const rows: OcrRow[] = [];
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;

    if (/^(items?|item|unit price|price|qty|quantity|stock|description)$/i.test(cleaned)) {
      continue;
    }

    if (/^[|\-_=+\s]+$/.test(cleaned)) {
      continue;
    }

    const priceMatches = cleaned.match(/(\d+[.,]?\d*)/g) || [];
    const sellingPrice = priceMatches.length > 0 ? Number(priceMatches[priceMatches.length - 1].replace(',', '.')) : 0;

    const name = cleaned.replace(/(\d+[.,]?\d*\s*)+$/g, '').trim() || cleaned;
    rows.push({
      name,
      selling_price: Number.isFinite(sellingPrice) ? sellingPrice : 0,
    });
  }

  return rows;
}

function extractTextFromOcrSpace(payload: any): string {
  const parsedResults = Array.isArray(payload?.ParsedResults) ? payload.ParsedResults : [];
  return parsedResults
    .map((entry: any) => String(entry?.ParsedText || ''))
    .filter(Boolean)
    .join('\n');
}

function parseStructuredJson(payload: unknown): OcrRow[] | null {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.rows)
      ? (payload as any).rows
      : typeof (payload as any)?.json === 'string'
        ? safeJsonParse((payload as any).json)
        : null;

  if (!Array.isArray(source)) return null;

  const rows = source
    .map((entry: ExtractedJsonRow) => {
      const name = String(entry?.name ?? '').trim();
      const sellingPriceRaw = entry?.selling_price ?? entry?.sellingPrice ?? 0;
      const selling_price = Number(sellingPriceRaw);
      return { name, selling_price: Number.isFinite(selling_price) ? selling_price : 0 };
    })
    .filter((row) => row.name.length > 0);

  return rows.length > 0 ? rows : null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });
  }

  try {
    const { apiKey, apiUrl } = getOcrSpaceConfig();
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'OCR provider not configured',
          details: 'Set OCR_SPACE_API_KEY in the Supabase function environment and redeploy the function.',
        }),
        { status: 501, headers: CORS_HEADERS }
      );
    }

    const contentType = req.headers.get('content-type') || '';
    let imageBlob: Blob | null = null;
    let fileName = 'upload.jpg';
    let prompt = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('image') || formData.get('file');
      if (file instanceof File) {
        imageBlob = file;
        fileName = file.name || fileName;
      }
      prompt = String(formData.get('prompt') || '');
    } else {
        const body = await req.json().catch(() => ({}));
        // Accept multiple forms of base64 payloads: fileBase64 (raw base64), imageBase64 (data URL or raw), or image
        const maybeBase64 = String(body?.fileBase64 || body?.imageBase64 || body?.image || '').trim();
        const mimeTypeFromBody = String(body?.mimeType || '').trim();
        if (maybeBase64) {
          // strip data URL if present
          const match = maybeBase64.match(/^data:(.*);base64,(.*)$/);
          const raw = match ? match[2] : maybeBase64.match(/^data:.*;base64,(.*)$/)?.[1] ?? maybeBase64;
          // decode base64 to bytes
          const bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));

          // If the payload is plain text, decode and parse directly without calling the OCR provider
          const effectiveMime = mimeTypeFromBody || String(body?.fileType || '').trim();
          const fileNameFromBody = String(body?.fileName || '').toLowerCase();
          if (effectiveMime.startsWith('text/') || effectiveMime === 'text/plain' || fileNameFromBody.endsWith('.txt')) {
            const text = new TextDecoder().decode(bytes);
            const rows = normalizeRowsFromText(text);
            return new Response(JSON.stringify(rows), { status: 200, headers: CORS_HEADERS });
          }

          // If it's a DOCX file, attempt to unzip and extract word/document.xml for exact text extraction
          if (effectiveMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileNameFromBody.endsWith('.docx')) {
            try {
              const entries = await unzip(bytes);
              // unzip may return a Map or an object; handle both
              let docXmlBytes: Uint8Array | undefined;
              if (entries instanceof Map) {
                docXmlBytes = entries.get('word/document.xml');
              } else if (typeof entries === 'object' && entries !== null) {
                docXmlBytes = (entries as any)['word/document.xml'];
              }

              if (docXmlBytes) {
                const xmlText = new TextDecoder().decode(docXmlBytes);
                try {
                  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
                  const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
                  const lines: string[] = paragraphs.map((p) => {
                    const texts = Array.from(p.getElementsByTagName('w:t')).map((t) => t.textContent || '');
                    return texts.join(' ').trim();
                  }).filter(Boolean);

                  const joined = lines.join('\n');
                  const rows = normalizeRowsFromText(joined);
                  return new Response(JSON.stringify(rows), { status: 200, headers: CORS_HEADERS });
                } catch (err) {
                  console.warn('Failed to parse DOCX XML, falling back to OCR provider', err);
                }
              }
            } catch (err) {
              console.warn('DOCX unzip failed, falling back to OCR provider', err);
            }
          }

          imageBlob = new Blob([bytes], { type: effectiveMime || 'application/octet-stream' });
        }
        fileName = String(body?.fileName || body?.fileName || fileName);
        prompt = String(body?.prompt || '');
    }

    console.log('vantage-ocr prompt', prompt || '(none)');

    if (!imageBlob) {
      return new Response(JSON.stringify({ error: 'Missing image file' }), { status: 400, headers: CORS_HEADERS });
    }

    const formData = new FormData();
    formData.append('file', imageBlob, fileName);
    formData.append('language', 'eng');
    formData.append('scale', 'true');
    formData.append('isTable', 'true');
    formData.append('OCREngine', '2');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        apikey: apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const message = await response.text().catch(() => 'OCR provider request failed');
      return new Response(JSON.stringify({ error: message || `OCR provider returned ${response.status}` }), {
        status: 502,
        headers: CORS_HEADERS,
      });
    }

    const payload = await response.json();
    const structuredRows = parseStructuredJson(payload);
    const rows = structuredRows ?? normalizeRowsFromText(extractTextFromOcrSpace(payload));

    return new Response(JSON.stringify(rows), { status: 200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: CORS_HEADERS });
  }
});