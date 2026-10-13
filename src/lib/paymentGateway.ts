/**
 * Payment Gateway Integration
 * Real Pesapal via pipeline; MoMo direct APIs only when VITE_* creds exist.
 * Never fake-success in production.
 */

export type PaymentGateway = 'mtn' | 'airtel' | 'zamtel' | 'zedmobile' | 'bank' | 'pesapal';

export interface PaymentRequest {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency: string;
  customerName: string;
  customerPhone: string;
  gateway: PaymentGateway;
  metadata?: Record<string, any>;
}

export interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  message: string;
  redirectUrl?: string;
  manualConfirm?: boolean;
}

function viteEnv(key: string): string {
  try {
    const env = import.meta.env as Record<string, string | undefined>;
    return String(env[key] || env[key.replace('VITE_', 'REACT_APP_')] || '').trim();
  } catch {
    return '';
  }
}

function pipelineBase(): string {
  return String(viteEnv('VITE_PIPELINE_URL') || '').replace(/\/$/, '');
}

function pipelineUrl(path: string): string {
  const base = pipelineBase();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

const mobileMoneyConfig = {
  mtn: {
    name: 'MTN Mobile Money',
    apiEndpoint: viteEnv('VITE_MTN_API_URL') || 'https://proxy.momoapi.mtn.com',
    clientId: viteEnv('VITE_MTN_CLIENT_ID'),
    clientSecret: viteEnv('VITE_MTN_CLIENT_SECRET'),
    merchantId: viteEnv('VITE_MTN_MERCHANT_ID'),
  },
  airtel: {
    name: 'Airtel Money',
    apiEndpoint: viteEnv('VITE_AIRTEL_API_URL') || 'https://openapi.airtel.africa',
    clientId: viteEnv('VITE_AIRTEL_CLIENT_ID'),
    clientSecret: viteEnv('VITE_AIRTEL_CLIENT_SECRET'),
    merchantId: viteEnv('VITE_AIRTEL_MERCHANT_ID'),
  },
  zamtel: {
    name: 'Zamtel Money',
    apiEndpoint: viteEnv('VITE_ZAMTEL_API_URL') || '',
    clientId: viteEnv('VITE_ZAMTEL_CLIENT_ID'),
    clientSecret: viteEnv('VITE_ZAMTEL_CLIENT_SECRET'),
    merchantId: viteEnv('VITE_ZAMTEL_MERCHANT_ID'),
  },
  zedmobile: {
    name: 'Zedmobile',
    apiEndpoint: viteEnv('VITE_ZEDMOBILE_API_URL') || '',
    clientId: viteEnv('VITE_ZEDMOBILE_CLIENT_ID'),
    clientSecret: viteEnv('VITE_ZEDMOBILE_CLIENT_SECRET'),
    merchantId: viteEnv('VITE_ZEDMOBILE_MERCHANT_ID'),
  },
};

export async function processPayment(request: PaymentRequest): Promise<PaymentResponse> {
  try {
    if (request.gateway === 'pesapal') {
      return processPesapalCheckout(request);
    }
    if (request.gateway === 'bank') {
      return {
        success: false,
        manualConfirm: true,
        message: 'Bank transfer — place order, pay the shop, then staff confirm on POS.',
      };
    }
    return processMobileMoneyPayment(request);
  } catch (error) {
    console.error(`Payment processing error for ${request.gateway}:`, error);
    return {
      success: false,
      message: `Failed to process payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function processPesapalCheckout(request: PaymentRequest): Promise<PaymentResponse> {
  try {
    const [first, ...rest] = String(request.customerName || 'Customer').trim().split(/\s+/);
    const resp = await fetch(pipelineUrl('/api/pesapal/checkout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: request.amount,
        currency: request.currency || 'ZMW',
        description: `Order ${request.orderNumber}`,
        orderId: request.orderId,
        orderNumber: request.orderNumber,
        merchantReference: request.orderNumber,
        billingAddress: {
          phone_number: request.customerPhone,
          first_name: first || 'Customer',
          last_name: rest.join(' ') || 'Guest',
          country_code: 'ZM',
          email_address: request.metadata?.email || 'customer@mthunzi.local',
        },
        callbackUrl: request.metadata?.callbackUrl,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return {
        success: false,
        manualConfirm: true,
        message:
          data.error ||
          'Pesapal not configured — order still sent to shop; pay via MoMo/cash and staff will confirm.',
      };
    }
    return {
      success: true,
      transactionId: data.orderTrackingId,
      redirectUrl: data.checkoutUrl,
      message: 'Redirecting to Pesapal checkout',
    };
  } catch (e) {
    return {
      success: false,
      manualConfirm: true,
      message: 'Payment gateway unreachable — place order and pay; shop confirms on POS.',
    };
  }
}

async function processMobileMoneyPayment(request: PaymentRequest): Promise<PaymentResponse> {
  const config = mobileMoneyConfig[request.gateway as keyof typeof mobileMoneyConfig];
  if (!config) {
    return { success: false, message: `Unknown gateway ${request.gateway}` };
  }

  if (!config.clientId || !config.clientSecret || !config.merchantId || !config.apiEndpoint) {
    // Honest path: do NOT fake success — shop confirms payment on POS
    return {
      success: false,
      manualConfirm: true,
      message: `${config.name} API keys not configured. Order will wait on POS for manual payment confirm.`,
    };
  }

  try {
    const response = await fetch(`${config.apiEndpoint}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Reference-Id': request.orderId,
        'X-Target-Environment': viteEnv('VITE_MTN_TARGET_ENV') || 'sandbox',
        'Ocp-Apim-Subscription-Key': config.clientId,
        Authorization: `Bearer ${config.clientSecret}`,
      },
      body: JSON.stringify({
        amount: String(request.amount),
        currency: request.currency || 'ZMW',
        externalId: request.orderNumber,
        payer: {
          partyIdType: 'MSISDN',
          partyId: String(request.customerPhone || '').replace(/\D/g, ''),
        },
        payerMessage: `Order ${request.orderNumber}`,
        payeeNote: config.merchantId,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        success: false,
        manualConfirm: true,
        message: `${config.name} request failed (${response.status}). ${text.slice(0, 120)}`,
      };
    }

    return {
      success: true,
      transactionId: request.orderId,
      message: `${config.name} payment request sent — confirm PIN on phone`,
    };
  } catch (error) {
    return {
      success: false,
      manualConfirm: true,
      message: error instanceof Error ? error.message : 'Mobile money request failed',
    };
  }
}

export async function verifyPayment(
  _gateway: PaymentGateway,
  transactionId: string
): Promise<{ verified: boolean; status: string }> {
  if (!transactionId) return { verified: false, status: 'missing' };
  // Pesapal / MoMo status checks require merchant credentials — staff confirm remains source of truth for POS.
  return { verified: false, status: 'pending_staff_confirm' };
}
