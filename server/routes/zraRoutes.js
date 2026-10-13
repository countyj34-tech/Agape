import {
  createSettings,
  deleteSettings,
  getSettings,
  submitInvoice,
  updateSettings,
} from '../controllers/ZRAController.js';

function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.ZRA_CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Request body must be valid JSON');
    error.statusCode = 400;
    throw error;
  }
}

function send(res, result) {
  const statusCode = result.statusCode ?? 200;
  res.writeHead(statusCode, jsonHeaders());
  res.end(result.body == null ? '' : JSON.stringify(result.body));
}

function sendError(res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  if (statusCode >= 500) console.error('ZRA API error:', error);
  res.writeHead(statusCode, jsonHeaders());
  res.end(
    JSON.stringify({
      error: statusCode >= 500 ? 'ZRA service request failed' : String(error?.message || error),
    })
  );
}

/**
 * Handle /api/zra routes. Returns true when the request belongs to this module.
 */
export async function handleZraRoute(req, res, url) {
  if (!url.pathname.startsWith('/api/zra/')) return false;

  try {
    if (req.method === 'OPTIONS') {
      send(res, { statusCode: 204, body: null });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/zra/settings') {
      send(res, await createSettings(req, await readJson(req)));
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/zra/invoices') {
      send(res, await submitInvoice(req, await readJson(req)));
      return true;
    }

    const match = url.pathname.match(/^\/api\/zra\/settings\/([^/]+)$/);
    if (match) {
      const businessId = decodeURIComponent(match[1]);
      if (req.method === 'GET') {
        send(res, await getSettings(req, businessId));
        return true;
      }
      if (req.method === 'PUT') {
        send(res, await updateSettings(req, businessId, await readJson(req)));
        return true;
      }
      if (req.method === 'DELETE') {
        send(res, await deleteSettings(req, businessId));
        return true;
      }
    }

    send(res, { statusCode: 404, body: { error: 'ZRA route not found' } });
  } catch (error) {
    sendError(res, error);
  }
  return true;
}
