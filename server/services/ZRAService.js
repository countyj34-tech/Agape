import crypto from 'crypto';
import { ZRASettings } from '../models/ZRASettings.js';
import { ZRAInvoiceLog } from '../models/ZRAInvoiceLog.js';

const ENVELOPE_VERSION = 'v1';

function encryptionKey() {
  const configured = String(process.env.ZRA_ENCRYPTION_KEY || '').trim();
  if (!configured) {
    const error = new Error('ZRA_ENCRYPTION_KEY is not configured on the server');
    error.statusCode = 503;
    throw error;
  }

  let key;
  if (/^[a-f0-9]{64}$/i.test(configured)) {
    key = Buffer.from(configured, 'hex');
  } else {
    try {
      key = Buffer.from(configured, 'base64');
    } catch {
      key = null;
    }
  }

  if (!key || key.length !== 32) {
    const error = new Error(
      'ZRA_ENCRYPTION_KEY must be a 32-byte key encoded as base64 or 64-character hex'
    );
    error.statusCode = 503;
    throw error;
  }
  return key;
}

export function encryptApiSecret(plainText) {
  const secret = String(plainText || '');
  if (!secret) throw new Error('API Secret is required');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptApiSecret(envelope) {
  const [version, ivBase64, tagBase64, cipherBase64] = String(envelope || '').split('.');
  if (version !== ENVELOPE_VERSION || !ivBase64 || !tagBase64 || !cipherBase64) {
    throw new Error('Stored ZRA API Secret has an invalid encrypted format');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivBase64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Format Date → yyyyMMddHHmmss / yyyyMMdd for VSDC */
function vsdcDateTime(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return (
    `${x.getFullYear()}${pad2(x.getMonth() + 1)}${pad2(x.getDate())}` +
    `${pad2(x.getHours())}${pad2(x.getMinutes())}${pad2(x.getSeconds())}`
  );
}

function vsdcDateOnly(d = new Date()) {
  return vsdcDateTime(d).slice(0, 8);
}

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function paymentTypeCode(method) {
  const m = String(method || '').toLowerCase();
  if (m.includes('cash')) return '01';
  if (m.includes('card') || m.includes('bank')) return '02';
  if (m.includes('mobile') || m.includes('mtn') || m.includes('airtel')) return '03';
  return '01';
}

/**
 * Build ZRA VSDC /trnsSales/saveSales body from our sale + settings.
 * Tax: if sale has VAT amounts use them; otherwise treat total as VAT-inclusive category A (16%).
 */
export function buildVsdcSaveSalesPayload(sale, settings) {
  const created = sale.createdAt ? new Date(sale.createdAt) : new Date();
  const items = Array.isArray(sale.items) ? sale.items : [];
  const vatMode = String(sale.salesTaxMode || '').toLowerCase() === 'vat';
  const vatRate = vatMode ? Number(sale.salesTaxRate || 16) || 16 : 16;

  let taxblAmtA = 0;
  let taxAmtA = 0;
  const itemList = items.map((item, idx) => {
    const qty = Number(item.quantity || 0);
    const lineTot = Number(item.total != null ? item.total : qty * Number(item.unitPrice || 0));
    let vatAmt = 0;
    let vatTaxbl = lineTot;
    if (vatMode) {
      vatTaxbl = round4(lineTot / (1 + vatRate / 100));
      vatAmt = round4(lineTot - vatTaxbl);
      taxblAmtA += vatTaxbl;
      taxAmtA += vatAmt;
    } else {
      // Non-VAT / TOT shops: send as exempt-ish zero VAT but still report totals
      vatTaxbl = round4(lineTot);
      vatAmt = 0;
    }
    return {
      itemSeq: idx + 1,
      itemCd: String(item.productId || `ITEM${idx + 1}`).slice(0, 100),
      itemClsCd: String(item.itemClsCd || process.env.ZRA_DEFAULT_ITEM_CLS_CD || '50102518').slice(0, 10),
      itemNm: String(item.productName || 'Item').slice(0, 200),
      bcd: '',
      pkgUnitCd: 'NT',
      pkg: 0,
      qtyUnitCd: 'U',
      qty,
      prc: round4(item.unitPrice || (qty ? lineTot / qty : 0)),
      splyAmt: round4(lineTot),
      dcRt: 0,
      dcAmt: 0,
      isrccCd: '',
      isrccNm: '',
      isrcRt: 0,
      isrcAmt: 0,
      vatCatCd: vatMode ? 'A' : 'D',
      exciseTxCatCd: null,
      tlCatCd: null,
      iplCatCd: null,
      vatTaxblAmt: vatTaxbl,
      vatAmt,
      exciseTaxblAmt: 0,
      tlTaxblAmt: 0,
      iplTaxblAmt: 0,
      iplAmt: 0,
      tlAmt: 0,
      exciseTxAmt: 0,
      totAmt: round2(lineTot),
    };
  });

  if (!vatMode) {
    taxblAmtA = 0;
    taxAmtA = 0;
  }

  const totAmt = round2(sale.total);
  const totTaxblAmt = vatMode ? round2(taxblAmtA) : round2(sale.subtotal || totAmt);
  const totTaxAmt = vatMode ? round2(taxAmtA) : round2(sale.salesTaxAmount || 0);

  return {
    tpin: String(settings.tpin),
    bhfId: String(settings.branch_id || '000').padStart(3, '0').slice(-3),
    orgInvcNo: 0,
    cisInvcNo: String(sale.receiptNumber || sale.id).slice(0, 50),
    custTpin: null,
    custNm: String(sale.customerName || 'Walk-in').slice(0, 60),
    salesTyCd: 'N',
    rcptTyCd: 'S',
    pmtTyCd: paymentTypeCode(sale.paymentMethod),
    salesSttsCd: '02',
    cfmDt: vsdcDateTime(created),
    salesDt: vsdcDateOnly(created),
    stockRlsDt: null,
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: null,
    rfdRsnCd: null,
    totItemCnt: itemList.length,
    taxblAmtA: round4(taxblAmtA),
    taxblAmtB: 0,
    taxblAmtC1: 0,
    taxblAmtC2: 0,
    taxblAmtC3: 0,
    taxblAmtD: vatMode ? 0 : totTaxblAmt,
    taxblAmtRvat: 0,
    taxblAmtE: 0,
    taxblAmtF: 0,
    taxblAmtIpl1: 0,
    taxblAmtIpl2: 0,
    taxblAmtTl: 0,
    taxblAmtEcm: 0,
    taxblAmtExeeg: 0,
    taxblAmtTot: 0,
    taxRtA: 16,
    taxRtB: 16,
    taxRtC1: 0,
    taxRtC2: 0,
    taxRtC3: 0,
    taxRtD: 0,
    taxRtRvat: 16,
    taxRtE: 0,
    taxRtF: 10,
    taxRtIpl1: 5,
    taxRtIpl2: 0,
    taxRtTl: 1.5,
    taxRtEcm: 5,
    taxRtExeeg: 3,
    taxRtTot: 0,
    taxAmtA: round4(taxAmtA),
    taxAmtB: 0,
    taxAmtC1: 0,
    taxAmtC2: 0,
    taxAmtC3: 0,
    taxAmtD: 0,
    taxAmtRvat: 0,
    taxAmtE: 0,
    taxAmtF: 0,
    taxAmtIpl1: 0,
    taxAmtIpl2: 0,
    taxAmtTl: 0,
    taxAmtEcm: 0,
    taxAmtExeeg: 0,
    taxAmtTot: 0,
    totTaxblAmt,
    totTaxAmt,
    cashDcRt: 0,
    cashDcAmt: round2(sale.discount || 0),
    totAmt,
    prchrAcptcYn: 'N',
    remark: '',
    regrId: 'ADMIN',
    regrNm: 'ADMIN',
    modrId: 'ADMIN',
    modrNm: 'ADMIN',
    saleCtyCd: '1',
    lpoNumber: null,
    currencyTyCd: 'ZMW',
    exchangeRt: '1',
    destnCountryCd: '',
    dbtRsnCd: '',
    invcAdjustReason: '',
    itemList,
  };
}

/**
 * Live call to local/remote VSDC: POST {ZRA_VSDC_BASE_URL}/trnsSales/saveSales
 * Auth: ZRA typically uses device serial + keys from init; we send apiKey/apiSecret headers
 * and also tpin/bhfId in body (VSDC validates against initialized device).
 */
export async function sendInvoiceToZRA(invoicePayload, credentials) {
  const base = String(process.env.ZRA_VSDC_BASE_URL || '').trim().replace(/\/$/, '');
  if (!base) {
    const err = new Error(
      'ZRA_VSDC_BASE_URL is not set. Deploy ZRA VSDC (e.g. http://127.0.0.1:8080/zravsdc) and set the env var.'
    );
    err.statusCode = 503;
    throw err;
  }

  const path = process.env.ZRA_VSDC_SAVE_SALES_PATH || '/trnsSales/saveSales';
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (credentials?.apiKey) headers['X-API-KEY'] = credentials.apiKey;
  if (credentials?.apiSecret) headers['X-API-SECRET'] = credentials.apiSecret;
  // Some VSDC builds expect Authorization
  if (credentials?.apiKey) headers.Authorization = `Bearer ${credentials.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.ZRA_TIMEOUT_MS || 15000));
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(invoicePayload),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`VSDC returned non-JSON (${resp.status}): ${text.slice(0, 200)}`);
    }

    const resultCd = String(json.resultCd ?? json.result_cd ?? '');
    const data = json.data || {};
    if (!resp.ok || (resultCd && resultCd !== '000')) {
      return {
        status: 'FAILED',
        invoiceNumber: '',
        qrCode: '',
        verificationCode: '',
        resultCd,
        resultMsg: json.resultMsg || json.result_msg || `HTTP ${resp.status}`,
        raw: json,
      };
    }

    return {
      status: 'SUCCESS',
      invoiceNumber: String(data.rcptNo ?? data.cisInvcNo ?? invoicePayload.cisInvcNo ?? ''),
      verificationCode: String(data.rcptSign || data.intrlData || ''),
      qrCode: String(data.qrCodeUrl || data.qrCode || ''),
      resultCd: resultCd || '000',
      resultMsg: json.resultMsg || 'It is succeeded',
      sdcId: data.sdcId,
      mrcNo: data.mrcNo,
      raw: json,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function prepareInvoicePayload(sale, settings) {
  // Prefer VSDC wire format for the live adapter; keep meta for logs.
  const vsdc = buildVsdcSaveSalesPayload(sale, settings);
  return {
    ...vsdc,
    _meta: {
      schemaVersion: 1,
      businessId: settings.business_id,
      deviceId: settings.device_id,
      environment: settings.environment,
      saleId: sale.id,
    },
  };
}

export async function processSaleForZRA({ businessId, sale }) {
  const settings = await ZRASettings.findByBusinessId(businessId, { includeSecret: true });
  if (!settings?.smart_invoice_enabled) {
    return { enabled: false, status: 'DISABLED' };
  }

  const existing = await ZRAInvoiceLog.findBySale(businessId, sale.id);
  if (existing) {
    return {
      enabled: true,
      status: existing.status,
      tpin: settings.tpin,
      invoiceNumber: existing.invoice_number || '',
      verificationCode: existing.verification_code || '',
      qrCode: existing.qr_code || '',
    };
  }

  const requestPayload = prepareInvoicePayload(sale, settings);
  const credentials = {
    apiKey: settings.api_key,
    apiSecret: decryptApiSecret(settings.api_secret),
    environment: settings.environment,
  };

  let response;
  try {
    // Strip _meta before wire call
    const { _meta, ...wire } = requestPayload;
    response = await sendInvoiceToZRA(wire, credentials);
  } catch (error) {
    response = {
      status: 'FAILED',
      invoiceNumber: '',
      qrCode: '',
      verificationCode: '',
      resultMsg: error?.message || String(error),
    };
    await ZRAInvoiceLog.create({
      sale_id: sale.id,
      business_id: businessId,
      request_json: requestPayload,
      response_json: response,
      status: 'FAILED',
      invoice_number: null,
      verification_code: null,
      qr_code: null,
    });
    throw error;
  }

  await ZRAInvoiceLog.create({
    sale_id: sale.id,
    business_id: businessId,
    request_json: requestPayload,
    response_json: response,
    status: response.status,
    invoice_number: response.invoiceNumber || null,
    verification_code: response.verificationCode || null,
    qr_code: response.qrCode || null,
  });

  return {
    enabled: true,
    status: response.status,
    tpin: settings.tpin,
    invoiceNumber: response.invoiceNumber || '',
    verificationCode: response.verificationCode || '',
    qrCode: response.qrCode || '',
  };
}
