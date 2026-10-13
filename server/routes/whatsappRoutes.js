/**
 * WhatsApp Cloud API send (Meta). Falls back not handled here — client uses wa.me.
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

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function toWhatsAppDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = `260${d.slice(1)}`;
  if (d.length === 9) d = `260${d}`;
  return d;
}

export async function handleWhatsAppRoute(req, res, url) {
  if (!url.pathname.startsWith('/api/whatsapp')) return false;

  if (req.method === 'OPTIONS') {
    send(res, 204, null);
    return true;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/whatsapp/health') {
      send(res, 200, {
        ok: true,
        configured: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/whatsapp/send') {
      const token = process.env.WHATSAPP_TOKEN || process.env.META_WHATSAPP_TOKEN;
      const phoneNumberId =
        process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID;
      if (!token || !phoneNumberId) {
        send(res, 503, {
          error: 'WhatsApp Cloud API not configured (WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID)',
          fallback: 'wa.me',
        });
        return true;
      }

      const body = await readJson(req);
      const to = toWhatsAppDigits(body.to || body.phone);
      const text = String(body.text || body.message || '').trim();
      if (!to || !text) {
        send(res, 400, { error: 'to and text are required' });
        return true;
      }

      const resp = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { preview_url: false, body: text.slice(0, 4000) },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        send(res, 502, { error: data.error?.message || 'WhatsApp send failed', raw: data });
        return true;
      }
      send(res, 200, { success: true, messageId: data.messages?.[0]?.id, raw: data });
      return true;
    }

    send(res, 404, { error: 'WhatsApp route not found' });
  } catch (error) {
    send(res, 500, { error: String(error?.message || error) });
  }
  return true;
}
