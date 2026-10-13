import http from 'http';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { handleZraRoute } from './routes/zraRoutes.js';
import { handlePesapalRoute } from './routes/pesapalRoutes.js';
import { handleWhatsAppRoute } from './routes/whatsappRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  try {
    const envPath = path.resolve(__dirname, '../.env');
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // ignore
  }
}

loadEnv();

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_FETCH_TIMEOUT_MS = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS || 3000);
let supabaseOrdersCooldownUntil = 0;

async function fetchWithTimeout(url, options = {}, timeoutMs = SUPABASE_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseRestGet(pathWithQuery) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Supabase service role not configured in .env');
  }
  const resp = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(text || `Supabase error ${resp.status}`);
  }
  return text ? JSON.parse(text) : [];
}

async function supabaseRest(method, pathWithQuery, body) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Supabase service role not configured in .env');
  }
  const resp = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Prefer: method === 'POST' || method === 'PATCH' ? 'return=representation,resolution=merge-duplicates' : 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(text || `Supabase error ${resp.status}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Build a row that matches the existing online_orders table (no migration needed). */
function toExistingOnlineOrderRow(order) {
  const meta = {
    order_number: order.orderNumber || order.order_number || '',
    discount: Number(order.discount || 0) || 0,
    source: order.source || 'ONLINE',
    delivery_type: order.deliveryType || order.delivery_type || 'collect',
    payment_category: order.paymentCategory || order.payment_category || null,
    mobile_provider: order.mobileProvider || order.mobile_provider || null,
    selected_bank: order.selectedBank || order.selected_bank || null,
    payment_transaction_id: order.paymentTransactionId || order.payment_transaction_id || null,
    needs_payment_approval: Boolean(order.needsPaymentApproval ?? order.needs_payment_approval),
    completed_sale_id: order.completedSaleId || order.completed_sale_id || null,
    verified_by_staff_id: order.verifiedByStaffId || order.verified_by_staff_id || null,
  };

  const statusRaw = String(order.status || 'pending').toLowerCase();
  const status =
    statusRaw === 'completed' || statusRaw === 'delivered'
      ? 'delivered'
      : statusRaw === 'cancelled'
        ? 'cancelled'
        : statusRaw === 'confirmed' || statusRaw === 'preparing' || statusRaw === 'ready'
          ? statusRaw
          : 'pending';

  const payRaw = String(order.paymentStatus || order.payment_status || 'pending').toLowerCase();
  const payment_status = payRaw === 'paid' ? 'paid' : payRaw === 'failed' ? 'failed' : 'pending';

  const items = Array.isArray(order.items) ? order.items : [];

  return {
    id: order.id,
    store_id: order.storeId || order.store_id,
    company_id: order.companyId || order.company_id || null,
    customer_name: order.customerName || order.customer_name || 'Guest',
    customer_phone: order.customerPhone || order.customer_phone || null,
    customer_address: order.deliveryAddress || order.delivery_address || order.customer_address || null,
    items,
    subtotal: Number(order.subtotal) || 0,
    delivery_fee: Number(order.deliveryFee ?? order.delivery_fee ?? 0) || 0,
    total: Number(order.total) || 0,
    status,
    payment_method: order.paymentCategory === 'bank' || order.payment_category === 'bank' ? 'card' : 'mobile',
    payment_status,
    delivery_address: order.deliveryAddress || order.delivery_address || null,
    delivery_notes: JSON.stringify(meta),
    updated_at: new Date().toISOString(),
    created_at: order.createdAt
      ? new Date(order.createdAt).toISOString()
      : order.created_at || new Date().toISOString(),
  };
}

function isMasterRequest(req) {
  return req.headers['x-master-session'] === 'true';
}

function normalizeHostStatus(raw) {
  const value = String(raw || 'active').toLowerCase();
  if (value === 'paused' || value === 'suspended' || value === 'removed') return value;
  return 'active';
}

function customerShopMessage(status, reason) {
  const custom = String(reason || '').trim();
  if (custom) return custom;
  if (status === 'paused' || status === 'suspended') {
    return 'This system is hosted and maintained every month to keep your business running smooth and secure. To continue operating, please settle your hosting payment.';
  }
  if (status === 'removed') return 'This shop is no longer available.';
  return '';
}

async function getStoreHostStatus(storeId) {
  const stores = await supabaseRestGet(
    `stores?select=id,company_id,name&id=eq.${encodeURIComponent(storeId)}&limit=1`
  );
  const store = stores?.[0];
  if (!store) return null;

  const companyId = store.company_id;
  if (!companyId) {
    return {
      hostStatus: 'active',
      hostStatusReason: null,
      shopOpen: true,
      message: '',
      companyName: store.name,
    };
  }

  const companies = await supabaseRestGet(
    `companies?select=id,name,host_status,host_status_reason&id=eq.${encodeURIComponent(companyId)}&limit=1`
  );
  const company = companies?.[0] || {};
  const hostStatus = normalizeHostStatus(company.host_status);
  const hostStatusReason = company.host_status_reason || null;
  const shopOpen = hostStatus === 'active';

  return {
    hostStatus,
    hostStatusReason,
    shopOpen,
    message: customerShopMessage(hostStatus, hostStatusReason),
    companyName: company.name || store.name,
  };
}

const uploadDir = path.join(os.tmpdir(), 'bar_automation_pipeline', 'uploads');
await fs.mkdir(uploadDir, { recursive: true });

const networkPrinterSockets = new Map();

function getPrinterSocketKey(host, port) {
  return `${String(host || '').trim()}:${Number(port || 0)}`;
}

function getOrCreatePrinterSocket(host, port) {
  const key = getPrinterSocketKey(host, port);
  let socket = networkPrinterSockets.get(key);
  if (socket && !socket.destroyed) return socket;

  socket = net.createConnection({ host: String(host).trim(), port: Number(port) });
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30000);
  socket.on('error', () => {
    try {
      socket.destroy();
    } catch {
      // ignore
    }
    networkPrinterSockets.delete(key);
  });
  socket.on('close', () => {
    networkPrinterSockets.delete(key);
  });
  networkPrinterSockets.set(key, socket);
  return socket;
}

const port = Number(process.env.PIPELINE_PORT || 4000);
const host = process.env.PIPELINE_HOST || '0.0.0.0';
const localOrdersPath = path.join(uploadDir, 'online-orders-relay.json');

async function readLocalOrders() {
  try {
    const raw = await fs.readFile(localOrdersPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalOrders(orders) {
  await fs.writeFile(localOrdersPath, JSON.stringify(orders, null, 2), 'utf8');
}

async function upsertLocalOrder(row) {
  const orders = await readLocalOrders();
  const idx = orders.findIndex((o) => String(o.id) === String(row.id));
  if (idx >= 0) orders[idx] = { ...orders[idx], ...row };
  else orders.unshift(row);
  // Keep last 500 orders
  await writeLocalOrders(orders.slice(0, 500));
  return row;
}

async function patchLocalOrder(orderId, patch) {
  const orders = await readLocalOrders();
  const idx = orders.findIndex((o) => String(o.id) === String(orderId));
  if (idx < 0) return null;
  orders[idx] = { ...orders[idx], ...patch, updated_at: new Date().toISOString() };
  await writeLocalOrders(orders);
  return orders[idx];
}

function stockSheetPrompt(sheetType) {
  const base = `You are an expert at reading bar/restaurant handwritten STOCK COUNT sheets photographed on a phone.
Extract ONLY real product inventory rows. Ignore headers, totals, signatures, dates, and blank lines.
Fix obvious spelling mistakes in product names (e.g. "Jaueson" → "Jameson").
Return ONLY valid JSON — a single array. No markdown, no explanation.`;

  if (sheetType === 'opening') {
    return `${base}
This is an OPENING stock sheet. Each object: { "name": "Product Name", "opening": number }`;
  }
  if (sheetType === 'closing') {
    return `${base}
This is a CLOSING stock sheet. Each object: { "name": "Product Name", "closing": number }`;
  }
  if (sheetType === 'refill') {
    return `${base}
This is a REFILL sheet. Each object: { "name": "Product Name", "refill": number }`;
  }
  if (sheetType === 'stock-reconciliation' || sheetType === 'combined') {
    return `${base}
Columns may be Opening, Refill, Closing on one sheet.
Each object: { "name": "Product Name", "opening": number, "refill": number, "closing": number }`;
  }
  return `${base}
Each object: { "name": "Product Name", "quantity": number, "selling_price": number if visible }`;
}

async function extractWithGeminiVision({ fileBase64, mimeType, prompt }) {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GOOGLE_API_KEY not configured');
  }

  const models = [
    process.env.GEMINI_MODEL,
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash',
  ].filter(Boolean);
  const uniqueModels = [...new Set(models)];

  let lastError = null;
  for (const model of uniqueModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType || 'image/jpeg',
                  data: fileBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (resp.status === 429) {
      lastError = new Error(`Gemini quota exceeded for ${model}`);
      continue;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => 'Gemini API error');
      lastError = new Error(`Gemini request failed (${model}): ${text}`);
      continue;
    }

    const json = await resp.json();
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text || '').join('\n');
    const rows = extractJsonArray(text);
    if (Array.isArray(rows) && rows.length > 0) {
      return rows;
    }
    lastError = new Error(`Gemini returned no rows for ${model}`);
  }

  throw lastError || new Error('All Gemini models failed');
}

async function extractWithOpenAiVision({ fileBase64, mimeType, prompt }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType || 'image/jpeg'};base64,${fileBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => 'OpenAI API error');
    throw new Error(`OpenAI request failed: ${text}`);
  }
  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  return extractJsonArray(content);
}

async function extractStockSheetWithAi(file, sheetType) {
  const fileName = String(file.fileName || 'upload.bin');
  const mimeType = String(file.mimeType || 'image/jpeg');
  const fileBase64 = String(file.fileBase64 || '');
  const mode = file.mode || 'import';
  const prompt =
    mode === 'stock-reconciliation'
      ? stockSheetPrompt(sheetType || 'combined')
      : `You are a smart stock import assistant. Extract only useful inventory rows from this image.
Return ONLY a JSON array of objects with fields: name, quantity, selling_price, buying_price (omit missing fields).
No markdown, no explanation.`;

  const hasGoogle = Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);

  if (!hasGoogle && !hasOpenAi) {
    throw new Error('No AI API key configured. Set GOOGLE_API_KEY or OPENAI_API_KEY in .env');
  }

  try {
    if (hasGoogle) {
      return await extractWithGeminiVision({ fileBase64, mimeType, prompt });
    }
  } catch (geminiErr) {
    if (!hasOpenAi) throw geminiErr;
    console.warn(`Gemini failed for ${fileName}, trying OpenAI:`, geminiErr);
  }

  return extractWithOpenAiVision({ fileBase64, mimeType, prompt });
}

async function generateTextWithAi(prompt) {
  const hasGoogle = Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const errors = [];

  if (hasOpenAi) {
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2500,
        temperature: 0.4,
      }),
    });
    if (resp.ok) {
      const json = await resp.json();
      const text = String(json.choices?.[0]?.message?.content || '').trim();
      if (text) return text;
      errors.push('OpenAI returned empty text');
    } else {
      const text = await resp.text().catch(() => 'OpenAI error');
      errors.push(`OpenAI ${resp.status}: ${text.slice(0, 200)}`);
    }
  }

  if (hasGoogle) {
    const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2500 },
      }),
    });
    if (resp.ok) {
      const json = await resp.json();
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.text || '').join('\n').trim();
      if (text) return text;
      errors.push('Gemini returned empty text');
    } else {
      const text = await resp.text().catch(() => 'Gemini error');
      errors.push(`Gemini ${resp.status}: ${text.slice(0, 200)}`);
    }
  }

  if (hasAnthropic) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (resp.ok) {
      const json = await resp.json();
      const block = (json.content || []).find((b) => b.type === 'text');
      const text = String(block?.text || '').trim();
      if (text) return text;
      errors.push('Anthropic returned empty text');
    } else {
      const text = await resp.text().catch(() => 'Anthropic error');
      errors.push(`Anthropic ${resp.status}: ${text.slice(0, 200)}`);
    }
  }

  throw new Error(
    errors.length
      ? `AI report failed: ${errors.join(' | ')}`
      : 'No AI provider configured. Add OPENAI_API_KEY to .env'
  );
}

function dailyReportPrompt(session) {
  return `You are writing a daily bar/restaurant stock reconciliation report for the business owner in Zambia (currency: Kwacha, symbol K).

Write a clear, professional report with emojis for section headers (e.g. 📊 Summary, 🍺 Top Sellers, ⚠️ Low Stock, ✅ Actions).

Include:
1. Executive summary (revenue, profit, units sold)
2. Top selling products
3. Low stock warnings
4. Refill activity if any
5. Any unmatched products that need attention
6. Recommended actions for tomorrow

Keep it concise but complete — like what a human analyst sends every morning on WhatsApp.

DATA (JSON):
${JSON.stringify(session, null, 2)}

Return ONLY the report text. No JSON wrapper.`;
}

async function polishReportForPdf(reportText) {
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasAnthropic) return reportText;

  const prompt = `Polish this daily stock report for a professional PDF. Keep all numbers accurate. Replace emojis with short text labels like [SUMMARY] [TOP SELLERS] since PDF fonts may not render emojis. Keep paragraphs readable.

REPORT:
${reportText}`;

  try {
    const polished = await generateTextWithAi(prompt);
    return polished || reportText;
  } catch {
    return reportText.replace(/[\u{1F300}-\u{1FAFF}]/gu, '');
  }
}

async function sendEmailWithPdf({ to, subject, body, pdfBase64, filename }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.REPORT_FROM_EMAIL || user;
  if (!host || !user || !pass || !to) {
    return { ok: false, reason: 'SMTP not configured' };
  }

  // Lightweight SMTP via nodemailer would need a dependency — use a simple relay if available
  // For now return false so client uses mailto: fallback
  return { ok: false, reason: 'SMTP send not implemented — use mailto fallback' };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (await handleZraRoute(req, res, url)) {
      return;
    }
    if (await handlePesapalRoute(req, res, url)) {
      return;
    }
    if (await handleWhatsAppRoute(req, res, url)) {
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/pipeline/health') {
      const nets = os.networkInterfaces();
      const lanIps = [];
      for (const entries of Object.values(nets)) {
        for (const entry of entries || []) {
          if (entry && entry.family === 'IPv4' && !entry.internal) {
            lanIps.push(entry.address);
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(
        JSON.stringify({
          status: 'ok',
          supabase: Boolean(SUPABASE_URL && SERVICE_KEY),
          host,
          port,
          lanIps,
          marketplaceHint: lanIps[0]
            ? `Share http://${lanIps[0]}:8080/shop/<storeId> with customers on the same Wi‑Fi`
            : null,
        })
      );
      return;
    }

    // CORS preflight for marketplace / POS calling the pipeline API
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/online-orders')) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // Marketplace → POS: create/upsert online order (local relay + optional Supabase)
    if (req.method === 'POST' && url.pathname === '/api/online-orders') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        let row = toExistingOnlineOrderRow(body);
        if (!row.store_id) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'store_id is required' }));
          return;
        }

        try {
          const host = await getStoreHostStatus(row.store_id);
          if (host && !host.shopOpen) {
            res.writeHead(423, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(
              JSON.stringify({
                error: host.message || 'Shop is not accepting orders right now.',
                hostStatus: host.hostStatus,
              })
            );
            return;
          }
        } catch (hostError) {
          console.warn('Host status check skipped for online order:', hostError);
        }

        // Always persist on this shop machine so remote phones on Wi‑Fi work even if Supabase is blocked
        if (!row.company_id) {
          try {
            const stores = await supabaseRestGet(
              `stores?select=id,company_id&id=eq.${encodeURIComponent(row.store_id)}&limit=1`
            );
            row.company_id = stores?.[0]?.company_id || null;
          } catch {
            row.company_id = row.store_id;
          }
        }
        if (!row.company_id) row.company_id = row.store_id;

        const localSaved = await upsertLocalOrder(row);

        let cloudSaved = null;
        let cloudError = null;
        try {
          cloudSaved = await supabaseRest('POST', 'online_orders?on_conflict=id', row);
        } catch (error) {
          cloudError = String(error?.message || error);
          console.warn('Supabase online_orders upsert failed (local relay kept order):', cloudError);
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(
          JSON.stringify({
            success: true,
            order: Array.isArray(cloudSaved) ? cloudSaved[0] : cloudSaved || localSaved,
            local: true,
            cloud: Boolean(cloudSaved),
            cloudError,
          })
        );
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/online-orders') {
      try {
        const storeId = url.searchParams.get('store_id') || '';
        if (!storeId) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'store_id is required' }));
          return;
        }
        const statusFilter = (url.searchParams.get('status') || 'pending').toLowerCase();
        const byId = new Map();

        // Local relay first (LAN remote marketplace works without Supabase)
        const local = await readLocalOrders();
        for (const row of local) {
          if (String(row.store_id) !== String(storeId)) continue;
          const st = String(row.status || '').toLowerCase();
          if (statusFilter === 'pending') {
            if (st && st !== 'pending' && st !== 'confirmed') continue;
          } else if (st !== statusFilter) continue;
          byId.set(String(row.id), row);
        }

        // Local relay only — never block POS/LAN on unreachable Supabase.
        // Cloud pull belongs to Admin Sync / explicit refresh, not every list poll.

        const orders = Array.from(byId.values()).sort(
          (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ orders, localRelay: true }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      }
      return;
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/api/online-orders/')) {
      try {
        const orderId = decodeURIComponent(url.pathname.replace('/api/online-orders/', ''));
        const body = JSON.parse(await readRequestBody(req));
        const patch = {};
        if (body.status) {
          const s = String(body.status).toLowerCase();
          patch.status =
            s === 'completed' || s === 'delivered'
              ? 'delivered'
              : s === 'cancelled'
                ? 'cancelled'
                : s === 'confirmed'
                  ? 'confirmed'
                  : 'pending';
        }
        if (body.paymentStatus || body.payment_status) {
          const p = String(body.paymentStatus || body.payment_status).toLowerCase();
          patch.payment_status = p === 'paid' ? 'paid' : p === 'failed' ? 'failed' : 'pending';
        }
        if (body.completedSaleId || body.completed_sale_id || body.verifiedByStaffId) {
          let meta = {};
          try {
            const existingLocal = await readLocalOrders();
            const found = existingLocal.find((o) => String(o.id) === String(orderId));
            if (found?.delivery_notes) {
              meta =
                typeof found.delivery_notes === 'string'
                  ? JSON.parse(found.delivery_notes)
                  : found.delivery_notes;
            }
          } catch {
            meta = {};
          }
          if (body.completedSaleId || body.completed_sale_id) {
            meta.completed_sale_id = body.completedSaleId || body.completed_sale_id;
          }
          if (body.verifiedByStaffId) meta.verified_by_staff_id = body.verifiedByStaffId;
          patch.delivery_notes = JSON.stringify(meta);
        }
        patch.updated_at = new Date().toISOString();

        const localPatched = await patchLocalOrder(orderId, patch);

        let cloudPatched = null;
        try {
          cloudPatched = await supabaseRest(
            'PATCH',
            `online_orders?id=eq.${encodeURIComponent(orderId)}`,
            patch
          );
        } catch (error) {
          console.warn('Supabase order patch failed (local relay updated):', error?.message || error);
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(
          JSON.stringify({
            success: true,
            order: Array.isArray(cloudPatched) ? cloudPatched[0] : cloudPatched || localPatched,
          })
        );
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      }
      return;
    }

    // Deduct / set product stock via service role after POS confirms online order
    if (req.method === 'POST' && url.pathname === '/api/products/stock') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        const updates = Array.isArray(body.updates) ? body.updates : [];
        const results = [];
        for (const u of updates) {
          const productId = String(u.productId || u.product_id || '');
          if (!productId) continue;
          const patch = {
            updated_at: new Date().toISOString(),
          };
          if (typeof u.stock === 'number') {
            patch.stock = u.stock;
          } else if (typeof u.decrement === 'number') {
            try {
              const rows = await supabaseRestGet(
                `products?select=id,stock&id=eq.${encodeURIComponent(productId)}&limit=1`
              );
              const current = Number(rows?.[0]?.stock || 0);
              patch.stock = Math.max(0, current - Number(u.decrement));
            } catch {
              continue;
            }
          } else {
            continue;
          }
          try {
            const saved = await supabaseRest(
              'PATCH',
              `products?id=eq.${encodeURIComponent(productId)}`,
              patch
            );
            results.push(Array.isArray(saved) ? saved[0] : saved);
          } catch (error) {
            console.warn('Stock cloud update failed for', productId, error?.message || error);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, products: results }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/printer/connect') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        const hostValue = String(body.host || '').trim();
        const portValue = Number(body.port || 9100);
        if (!hostValue || !Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Valid printer host and port are required.' }));
          return;
        }

        const socket = getOrCreatePrinterSocket(hostValue, portValue);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, connected: !socket.destroyed, host: hostValue, port: portValue }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/printer/send') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        const hostValue = String(body.host || '').trim();
        const portValue = Number(body.port || 9100);
        const bytes = Array.isArray(body.data) ? Uint8Array.from(body.data.map(Number)) : new Uint8Array();
        if (!hostValue || !Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Valid printer host and port are required.' }));
          return;
        }

        const socket = getOrCreatePrinterSocket(hostValue, portValue);
        if (!socket.writable || socket.destroyed) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Printer socket is not writable.' }));
          return;
        }

        socket.write(Buffer.from(bytes));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/printer/disconnect') {
      try {
        const body = JSON.parse(await readRequestBody(req));
        const hostValue = String(body.host || '').trim();
        const portValue = Number(body.port || 9100);
        const key = getPrinterSocketKey(hostValue, portValue);
        const socket = networkPrinterSockets.get(key);
        if (socket && !socket.destroyed) {
          socket.end();
        }
        networkPrinterSockets.delete(key);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/public/store-host-status') {
      try {
        const storeId = url.searchParams.get('store_id') || '';
        if (!storeId) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'store_id is required' }));
          return;
        }
        const status = await getStoreHostStatus(storeId);
        if (!status) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Store not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(status));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/master/host-status') {
      if (!isMasterRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Master session required' }));
        return;
      }
      try {
        const body = JSON.parse(await readRequestBody(req));
        const companyId = String(body.companyId || body.company_id || '').trim();
        const hostStatus = normalizeHostStatus(body.hostStatus || body.host_status);
        const hostStatusReason = String(body.hostStatusReason || body.host_status_reason || '').trim() || null;
        if (!companyId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'companyId is required' }));
          return;
        }
        const updated = await supabaseRest('PATCH', `companies?id=eq.${encodeURIComponent(companyId)}`, {
          host_status: hostStatus,
          host_status_reason: hostStatusReason,
          updated_at: new Date().toISOString(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            company: Array.isArray(updated) ? updated[0] : updated,
            hostStatus,
            hostStatusReason,
          })
        );
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/master/catalog') {
      if (!isMasterRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Master session required' }));
        return;
      }
      const companies = await supabaseRestGet('companies?select=*&order=name.asc');
      const stores = await supabaseRestGet('stores?select=*');
      const productCountByStore = {};
      for (const store of stores) {
        const storeId = String(store.id || '');
        if (!storeId) continue;
        const rows = await supabaseRestGet(`products?select=id&store_id=eq.${encodeURIComponent(storeId)}`);
        productCountByStore[storeId] = Array.isArray(rows) ? rows.length : 0;
      }
      const summaries = (companies || []).map((company) => {
        const companyId = String(company.id || '');
        const companyStores = (stores || [])
          .filter((s) => String(s.company_id || '') === companyId)
          .map((s) => ({
            ...s,
            productCount: productCountByStore[String(s.id)] || 0,
          }))
          .sort((a, b) => (b.productCount || 0) - (a.productCount || 0));
        const productCount = companyStores.reduce((sum, s) => sum + (s.productCount || 0), 0);
        return {
          ...company,
          productCount,
          storeCount: companyStores.length,
          stores: companyStores,
          source: 'cloud',
        };
      });
      summaries.sort((a, b) => (b.productCount || 0) - (a.productCount || 0));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ companies: summaries, cloudConnected: true }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/master/products') {
      if (!isMasterRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Master session required' }));
        return;
      }
      const storeId = url.searchParams.get('store_id') || '';
      const companyId = url.searchParams.get('company_id') || '';
      if (!storeId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'store_id is required' }));
        return;
      }
      let rows = await supabaseRestGet(`products?select=*&store_id=eq.${encodeURIComponent(storeId)}`);
      if ((!rows || rows.length === 0) && companyId) {
        rows = await supabaseRestGet(`products?select=*&company_id=eq.${encodeURIComponent(companyId)}`);
      }
      const products = Array.isArray(rows) ? rows : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ products, cloudCount: products.length }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pipeline/process') {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body);
      const files = Array.isArray(payload.files) ? payload.files : [];

      if (!files.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No files uploaded' }));
        return;
      }

      const results = [];
      for (const file of files) {
        const fileName = String(file.fileName || 'upload.bin');
        const mimeType = String(file.mimeType || 'application/octet-stream');
        const fileBase64 = String(file.fileBase64 || '');
        const buffer = Buffer.from(fileBase64, 'base64');
        const inputPath = path.join(uploadDir, `${randomUUID()}-${fileName}`);
        const outputPath = path.join(uploadDir, `pipeline-output-${randomUUID()}.json`);

        await fs.writeFile(inputPath, buffer);
        try {
          const rows = await runPipeline(inputPath, outputPath);
          if (Array.isArray(rows)) results.push(...rows);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
          return;
        } finally {
          await fs.rm(inputPath, { force: true });
          await fs.rm(outputPath, { force: true });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: results }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stock-reconciliation/extract') {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body);
      const files = Array.isArray(payload.files) ? payload.files : [];
      const sheetType = String(payload.sheetType || 'combined');

      if (!files.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No files uploaded' }));
        return;
      }

      const results = [];
      let method = 'python-easyocr';
      for (const file of files) {
        const fileName = String(file.fileName || 'upload.bin');
        const fileBase64 = String(file.fileBase64 || '');
        const buffer = Buffer.from(fileBase64, 'base64');
        const inputPath = path.join(uploadDir, `${randomUUID()}-${fileName}`);
        await fs.writeFile(inputPath, buffer);
        try {
          const extracted = await runStockSheetExtract(inputPath, sheetType);
          method = extracted.method || method;
          if (Array.isArray(extracted.rows)) results.push(...extracted.rows);
          if (extracted.error && !extracted.rows?.length) {
            throw new Error(extracted.error);
          }
        } catch (err) {
          await fs.rm(inputPath, { force: true }).catch(() => undefined);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Stock extract failed for ${fileName}: ${String(err)}` }));
          return;
        } finally {
          await fs.rm(inputPath, { force: true }).catch(() => undefined);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: results, method, count: results.length }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gemini/process') {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body);
      const files = Array.isArray(payload.files) ? payload.files : [];
      const sheetType = String(payload.sheetType || 'combined');
      const mode = String(payload.mode || 'import');

      if (!files.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No files uploaded' }));
        return;
      }

      const results = [];
      for (const file of files) {
        const fileName = String(file.fileName || 'upload.bin');
        try {
          const rows = await extractStockSheetWithAi({ ...file, mode }, sheetType);
          if (Array.isArray(rows)) results.push(...rows);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `AI processing failed for ${fileName}: ${String(err)}` }));
          return;
        }
      }

      const provider = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY ? 'gemini' : 'openai';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: results, provider }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/stock-reconciliation/ai-status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          gemini: Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
          openai: Boolean(process.env.OPENAI_API_KEY),
          anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
          smtp: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
        })
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stock-reconciliation/generate-report') {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body);
      const session = payload.session || {};
      try {
        const report = await generateTextWithAi(dailyReportPrompt(session));
        const pdfText = await polishReportForPdf(report);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ report, pdfText }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stock-reconciliation/deliver-email') {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body);
      const result = await sendEmailWithPdf(payload);
      res.writeHead(result.ok ? 200 : 501, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error) }));
  }
});

server.listen(port, host, () => {
  console.log(`Pipeline server listening on http://127.0.0.1:${port} (bind ${host})`);
  console.log('Remote marketplace tip: phones should use this PC Network URL + keep this server running.');
});

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function extractJsonArray(text) {
  if (!text) return [];
  if (Array.isArray(text)) return text;
  try {
    const m = String(text).match(/\[.*\]/s);
    if (m) return JSON.parse(m[0]);
  } catch (e) {
    // ignore
  }
  try {
    return JSON.parse(String(text));
  } catch (e) {
    return [];
  }
}

function runPipeline(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const pythonExecutable = process.env.PYTHON || process.env.PYTHON3 || 'python';
    const scriptPath = path.resolve(__dirname, '../bar_automation/main_orchestrator.py');
    const child = spawn(pythonExecutable, [scriptPath, inputPath, '--save-json', outputPath], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', async (code) => {
      if (code !== 0) {
        return reject(new Error(stderr || `Python process exited with code ${code}`));
      }
      try {
        const content = await fs.readFile(outputPath, 'utf-8');
        resolve(JSON.parse(content));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** Local Python EasyOCR stock-sheet extraction — no Puter, no cloud popup */
function runStockSheetExtract(inputPath, sheetType) {
  return new Promise((resolve, reject) => {
    const pythonExecutable =
      process.env.PYTHON ||
      process.env.PYTHON3 ||
      'C:\\Users\\stephan\\AppData\\Local\\Microsoft\\WindowsApps\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\\python.exe';
    const scriptPath = path.resolve(__dirname, '../bar_automation/stock_sheet_extract.py');
    const outputPath = path.join(uploadDir, `stock-extract-${randomUUID()}.json`);
    const child = spawn(
      pythonExecutable,
      [scriptPath, inputPath, '--sheet-type', sheetType || 'combined', '--out', outputPath],
      {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      }
    );

    let stderr = '';
    let stdout = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', async (code) => {
      try {
        let payload = null;
        try {
          const content = await fs.readFile(outputPath, 'utf-8');
          payload = JSON.parse(content);
        } catch {
          if (stdout.trim()) payload = JSON.parse(stdout.trim().split('\n').pop());
        }
        await fs.rm(outputPath, { force: true }).catch(() => undefined);
        if (code !== 0 && !payload?.rows?.length) {
          return reject(new Error(stderr || stdout || `Python extract exited with code ${code}`));
        }
        resolve(payload || { rows: [], method: 'failed' });
      } catch (error) {
        reject(error);
      }
    });
  });
}
