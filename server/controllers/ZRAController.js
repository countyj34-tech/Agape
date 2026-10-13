import { ZRASettings } from '../models/ZRASettings.js';
import { authorizeZRARequest } from '../services/ZRAAuthorization.js';
import { encryptApiSecret, processSaleForZRA } from '../services/ZRAService.js';

const ENVIRONMENTS = new Set(['sandbox', 'production']);

function cleanString(value, field, { min = 1, max = 255, optional = false } = {}) {
  const result = String(value ?? '').trim();
  if (!result && optional) return '';
  if (result.length < min || result.length > max) {
    throw validationError(`${field} must be between ${min} and ${max} characters`);
  }
  return result;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

function validateSettingsInput(body, { requireSecret }) {
  const businessId = cleanString(body.business_id ?? body.businessId, 'Business ID', {
    max: 100,
  });
  const environment = cleanString(body.environment, 'Environment', { max: 20 });
  if (!ENVIRONMENTS.has(environment)) {
    throw validationError('Environment must be sandbox or production');
  }

  const apiSecret = cleanString(body.api_secret ?? body.apiSecret, 'API Secret', {
    min: requireSecret ? 1 : 0,
    max: 2048,
    optional: !requireSecret,
  });

  return {
    businessId,
    apiSecret,
    row: {
      business_id: businessId,
      business_name: cleanString(
        body.business_name ?? body.businessName,
        'Business Name',
        { max: 200 }
      ),
      tpin: cleanString(body.tpin, 'TPIN', { min: 5, max: 32 }),
      branch_id: cleanString(body.branch_id ?? body.branchId, 'Branch ID', { max: 100 }),
      device_id: cleanString(body.device_id ?? body.deviceId, 'Device ID', { max: 100 }),
      api_key: cleanString(body.api_key ?? body.apiKey, 'API Key', { max: 512 }),
      environment,
      smart_invoice_enabled: Boolean(
        body.smart_invoice_enabled ?? body.smartInvoiceEnabled
      ),
    },
  };
}

export async function getSettings(req, businessId) {
  await authorizeZRARequest(req, businessId, { adminOnly: true });
  const row = await ZRASettings.findByBusinessId(businessId, { includeSecret: true });
  return { statusCode: 200, body: { settings: ZRASettings.toPublic(row) } };
}

export async function createSettings(req, body) {
  const parsed = validateSettingsInput(body, { requireSecret: true });
  await authorizeZRARequest(req, parsed.businessId, { adminOnly: true });
  if (await ZRASettings.findByBusinessId(parsed.businessId)) {
    const error = new Error('ZRA settings already exist for this business');
    error.statusCode = 409;
    throw error;
  }

  const created = await ZRASettings.create({
    ...parsed.row,
    api_secret: encryptApiSecret(parsed.apiSecret),
  });
  return {
    statusCode: 201,
    body: { settings: ZRASettings.toPublic({ ...created, api_secret: 'encrypted' }) },
  };
}

export async function updateSettings(req, businessId, body) {
  const parsed = validateSettingsInput(
    { ...body, business_id: businessId },
    { requireSecret: false }
  );
  await authorizeZRARequest(req, businessId, { adminOnly: true });
  const existing = await ZRASettings.findByBusinessId(businessId, { includeSecret: true });
  if (!existing) {
    const error = new Error('ZRA settings were not found for this business');
    error.statusCode = 404;
    throw error;
  }

  const updated = await ZRASettings.updateByBusinessId(businessId, {
    ...parsed.row,
    ...(parsed.apiSecret ? { api_secret: encryptApiSecret(parsed.apiSecret) } : {}),
  });
  return {
    statusCode: 200,
    body: {
      settings: ZRASettings.toPublic({
        ...updated,
        api_secret: parsed.apiSecret ? 'encrypted' : existing.api_secret,
      }),
    },
  };
}

export async function deleteSettings(req, businessId) {
  await authorizeZRARequest(req, businessId, { adminOnly: true });
  await ZRASettings.deleteByBusinessId(businessId);
  return { statusCode: 204, body: null };
}

export async function submitInvoice(req, body) {
  const businessId = cleanString(body.business_id ?? body.businessId, 'Business ID', {
    max: 100,
  });
  if (!body.sale || typeof body.sale !== 'object') {
    throw validationError('Sale is required');
  }
  cleanString(body.sale.id, 'Sale ID', { max: 100 });
  await authorizeZRARequest(req, businessId);
  const invoice = await processSaleForZRA({ businessId, sale: body.sale });
  return { statusCode: 200, body: { invoice } };
}
