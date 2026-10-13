/**
 * Pesapal payment checkout (Zambia-friendly card/mobile aggregate).
 * Docs: https://developer.pesapal.com/
 */

function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function send(res, statusCode, body) {
  res.writeHead(statusCode, jsonHeaders());
  res.end(body == null ? '' : JSON.stringify(body));
}

function pesapalBase() {
  const env = String(process.env.PESAPAL_ENV || 'sandbox').toLowerCase();
  if (env === 'live' || env === 'production') {
    return 'https://pay.pesapal.com/v3';
  }
  return 'https://cybqa.pesapal.com/pesapalv3';
}

async function getPesapalToken() {
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY || process.env.VITE_PESAPAL_CONSUMER_KEY;
  const consumerSecret =
    process.env.PESAPAL_CONSUMER_SECRET || process.env.VITE_PESAPAL_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    const err = new Error('PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET not configured');
    err.statusCode = 503;
    throw err;
  }

  const resp = await fetch(`${pesapalBase()}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: consumerKey, consumer_secret: consumerSecret }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.token) {
    const err = new Error(data.error?.message || data.message || 'Pesapal auth failed');
    err.statusCode = 502;
    throw err;
  }
  return data.token;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

/**
 * Handle /api/pesapal/* routes.
 */
export async function handlePesapalRoute(req, res, url) {
  if (!url.pathname.startsWith('/api/pesapal')) return false;

  if (req.method === 'OPTIONS') {
    send(res, 204, null);
    return true;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/pesapal/health') {
      const configured = Boolean(
        process.env.PESAPAL_CONSUMER_KEY || process.env.VITE_PESAPAL_CONSUMER_KEY
      );
      send(res, 200, { ok: true, configured, env: process.env.PESAPAL_ENV || 'sandbox' });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/pesapal/checkout') {
      const body = await readJson(req);
      const amount = Number(body.amount);
      if (!amount || amount <= 0) {
        send(res, 400, { error: 'amount is required' });
        return true;
      }

      const token = await getPesapalToken();
      const callbackUrl =
        body.callbackUrl ||
        process.env.PESAPAL_CALLBACK_URL ||
        'https://www.pesapal.com/';
      const merchantReference =
        body.merchantReference || body.orderNumber || body.orderId || `MTZ-${Date.now()}`;

      const billing = body.billingAddress || {};
      const payload = {
        id: merchantReference,
        currency: body.currency || 'ZMW',
        amount,
        description: body.description || `Order ${merchantReference}`,
        callback_url: callbackUrl,
        redirect_mode: '',
        notification_id: process.env.PESAPAL_IPN_ID || undefined,
        billing_address: {
          email_address: billing.email_address || billing.email || 'customer@example.com',
          phone_number: billing.phone_number || billing.phone || '',
          country_code: billing.country_code || 'ZM',
          first_name: billing.first_name || 'Customer',
          middle_name: '',
          last_name: billing.last_name || 'Guest',
          line_1: billing.line_1 || '',
          line_2: '',
          city: billing.city || '',
          state: '',
          postal_code: '',
          zip_code: '',
        },
      };

      const resp = await fetch(`${pesapalBase()}/api/Transactions/SubmitOrderRequest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        send(res, 502, { error: data.message || data.error || 'Pesapal SubmitOrder failed', raw: data });
        return true;
      }

      send(res, 200, {
        checkoutUrl: data.redirect_url || data.checkoutUrl,
        orderTrackingId: data.order_tracking_id || data.orderTrackingId,
        merchantReference: data.merchant_reference || merchantReference,
        status: data.status || 'PENDING',
        raw: data,
      });
      return true;
    }

    send(res, 404, { error: 'Pesapal route not found' });
  } catch (error) {
    send(res, Number(error?.statusCode) || 500, {
      error: String(error?.message || error),
    });
  }
  return true;
}
