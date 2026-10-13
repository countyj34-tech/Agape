/**
 * WhatsApp Integration Module
 * Handles order notifications and customer communication via WhatsApp
 */

/**
 * Format a phone number to E.164 format (international standard)
 * Examples: +260971234567, +265999123456
 */
export function formatPhoneToE164(phone: string, countryCode: string = '+260'): string {
  const ccDigits = countryCode.replace(/\D/g, '') || '260';
  let digitsOnly = phone.replace(/\D/g, '');

  // Already international: 26097… → +26097…
  if (digitsOnly.length >= 11 && digitsOnly.startsWith(ccDigits)) {
    return `+${digitsOnly}`;
  }

  // Local ZM-style: 0977… / 977… → +260977…
  if (digitsOnly.startsWith('0')) {
    digitsOnly = digitsOnly.slice(1);
  }
  if (digitsOnly.length >= 9 && digitsOnly.length <= 10) {
    return `+${ccDigits}${digitsOnly}`;
  }

  if (phone.trim().startsWith('+') && digitsOnly.length >= 10) {
    return `+${digitsOnly}`;
  }

  return `+${digitsOnly}`;
}

/** Digits only for wa.me (no +). Normalizes local 0-prefix numbers. */
export function toWhatsAppDigits(phone: string, countryCode: string = '+260'): string {
  return formatPhoneToE164(phone, countryCode).replace(/\D/g, '');
}

/** Build a wa.me deep link with a prefilled message. */
export function buildWhatsAppLink(phone: string, message: string, countryCode: string = '+260'): string {
  const digits = toWhatsAppDigits(phone, countryCode);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * Generate WhatsApp deep link for a pending online order
 * The user will click this link to message the shop about their order
 */
export function generateWhatsAppOrderLink(
  shopPhone: string,
  orderNumber: string,
  customerName: string,
  total: number,
  currencySymbol: string = 'K'
): string {
  const message =
    `Hi! I've placed an order #${orderNumber} for ${currencySymbol}${Number(total).toFixed(2)}. ` +
    `My name is ${customerName}. Can you confirm this order?\n\n` +
    `Order Details:\n` +
    `Order ID: ${orderNumber}\n` +
    `Amount: ${currencySymbol}${Number(total).toFixed(2)}`;

  return buildWhatsAppLink(shopPhone, message);
}

/**
 * Generate WhatsApp order summary for display
 * Used in notifications and status updates
 */
export function generateOrderSummary(
  orderNumber: string,
  customerName: string,
  items: Array<{ productName: string; quantity: number; priceAtOrder: number }>,
  total: number,
  currencySymbol: string = 'K'
): string {
  let summary = `📦 Order #${orderNumber}\n`;
  summary += `👤 Customer: ${customerName}\n`;
  summary += `━━━━━━━━━━━━━━━━━━\n`;

  items.forEach((item) => {
    const subtotal = item.quantity * item.priceAtOrder;
    summary += `${item.productName}\n  Qty: ${item.quantity} × ${currencySymbol}${Number(item.priceAtOrder).toFixed(2)} = ${currencySymbol}${Number(subtotal).toFixed(2)}\n`;
  });

  summary += `━━━━━━━━━━━━━━━━━━\n`;
  summary += `💰 Total: ${currencySymbol}${Number(total).toFixed(2)}`;

  return summary;
}

/**
 * Generate WhatsApp notification for staff when a new order arrives
 */
export function generateStaffNotification(
  orderNumber: string,
  customerName: string,
  customerPhone: string,
  itemCount: number,
  total: number,
  currencySymbol: string = 'K'
): string {
  return (
    `🔔 NEW ONLINE ORDER\n\n` +
    `Order #: ${orderNumber}\n` +
    `Customer: ${customerName}\n` +
    `Phone: ${customerPhone}\n` +
    `Items: ${itemCount}\n` +
    `Total: ${currencySymbol}${Number(total).toFixed(2)}\n\n` +
    `⏰ Action needed: Verify & Complete in Staff Dashboard`
  );
}

/**
 * Generate WhatsApp confirmation message for customer
 */
export function generateCustomerConfirmation(
  orderNumber: string,
  total: number,
  estimatedWaitTime: number = 30, // minutes
  currencySymbol: string = 'K'
): string {
  return (
    `✅ Order Received!\n\n` +
    `Your order #${orderNumber} has been received.\n` +
    `Total: ${currencySymbol}${Number(total).toFixed(2)}\n\n` +
    `⏳ Estimated wait time: ${estimatedWaitTime} minutes\n` +
    `We'll send you a message when your order is ready to pickup.\n\n` +
    `Thank you for your business!`
  );
}

/**
 * Generate WhatsApp "ready for pickup" message
 */
export function generateReadyForPickupMessage(
  orderNumber: string,
  location: string = 'Main Counter'
): string {
  return (
    `🎉 Your order is ready!\n\n` +
    `Order #${orderNumber} is ready for pickup at ${location}.\n\n` +
    `Thank you for shopping with us!`
  );
}

/**
 * Opens WhatsApp in a new tab/window using the generated link
 * Useful for directing users to WhatsApp after checkout
 */
export function openWhatsAppLink(link: string, target: '_blank' | '_self' = '_blank'): void {
  // Prefer same-tab navigation inside WhatsApp in-app browsers (popup blockers).
  const inApp =
    typeof navigator !== 'undefined' &&
    (/WhatsApp/i.test(navigator.userAgent) || /FBAN|FBAV|Instagram/i.test(navigator.userAgent));
  if (inApp || target === '_self') {
    window.location.href = link;
    return;
  }
  const win = window.open(link, target);
  if (!win) {
    window.location.href = link;
  }
}

/** Try WhatsApp Cloud API via pipeline; returns true if server sent the message. */
export async function sendWhatsAppCloudMessage(phone: string, text: string): Promise<boolean> {
  try {
    const viteEnv =
      typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined'
        ? (import.meta.env as Record<string, string>)
        : {};
    const base = String(viteEnv.VITE_PIPELINE_URL || '').replace(/\/$/, '');
    const resp = await fetch(`${base}/api/whatsapp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, text }),
    });
    if (!resp.ok) return false;
    const data = await resp.json().catch(() => ({}));
    return Boolean(data.success);
  } catch {
    return false;
  }
}

/** Cloud API first, then wa.me deep link fallback. */
export async function notifyViaWhatsApp(
  phone: string,
  text: string,
  opts?: { deepLinkFallback?: boolean }
): Promise<'cloud' | 'deeplink' | 'failed'> {
  const cloud = await sendWhatsAppCloudMessage(phone, text);
  if (cloud) return 'cloud';
  if (opts?.deepLinkFallback !== false && phone) {
    openWhatsAppLink(buildWhatsAppLink(phone, text));
    return 'deeplink';
  }
  return 'failed';
}

/**
 * Copy text to clipboard (for manual copying if WhatsApp link doesn't work)
 */
export function copyToClipboard(text: string): Promise<boolean> {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}

/**
 * Generate a shareable link for social media or QR codes
 * Can be used to share the order to WhatsApp group or status
 */
export function generateShareableOrderLink(
  orderNumber: string,
  deepLink: string
): { text: string; url: string } {
  return {
    text: `Check out my online order #${orderNumber}! Click the link to place your order too!`,
    url: deepLink,
  };
}

/**
 * Validate phone number format (basic check)
 */
export function isValidPhoneNumber(phone: string): boolean {
  const digitsOnly = phone.replace(/\D/g, '');
  // Accept 10-12 digit phone numbers
  return digitsOnly.length >= 10 && digitsOnly.length <= 12;
}

/**
 * Parse incoming WhatsApp webhook message (for future webhook integration)
 * Stub for future implementation using WhatsApp Cloud API
 */
export interface WhatsAppWebhookMessage {
  from: string;
  body: string;
  timestamp: string;
  messageId: string;
}

export function parseWhatsAppWebhookMessage(payload: any): WhatsAppWebhookMessage | null {
  try {
    const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return null;

    return {
      from: message.from,
      body: message.text?.body || '',
      timestamp: message.timestamp,
      messageId: message.id,
    };
  } catch {
    return null;
  }
}

/**
 * Send WhatsApp message via webhook (requires WhatsApp Cloud API setup)
 * This is a stub for future server-side implementation
 */
export async function sendWhatsAppViaWebhook(
  phoneNumber: string,
  message: string,
  webhookUrl: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber,
        message,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, messageId: data.messageId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
