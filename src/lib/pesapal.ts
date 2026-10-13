/**
 * Pesapal checkout — uses local pipeline /api/pesapal/checkout (real credentials on server).
 */

function pipelineUrl(path: string): string {
  try {
    const base = String((import.meta.env as any).VITE_PIPELINE_URL || '')
      .trim()
      .replace(/\/$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  } catch {
    return path;
  }
}

interface SubmitOrderParams {
  amount: string | number;
  currency: string;
  description: string;
  billingAddress: {
    email_address: string;
    phone_number: string;
    country_code: string;
    first_name: string;
    last_name: string;
  };
  orderId?: string;
  orderNumber?: string;
  callbackUrl?: string;
}

export async function initiatePesapalCheckout(params: SubmitOrderParams) {
  const resp = await fetch(pipelineUrl('/api/pesapal/checkout'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      billingAddress: params.billingAddress,
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      callbackUrl: params.callbackUrl,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `Pesapal checkout failed (${resp.status})`);
  }
  return {
    checkoutUrl: data.checkoutUrl || data.redirect_url,
    orderTrackingId: data.orderTrackingId || data.order_tracking_id,
    merchantReference: data.merchantReference || data.merchant_reference,
    status: data.status || 'PENDING',
    ...data,
  };
}
