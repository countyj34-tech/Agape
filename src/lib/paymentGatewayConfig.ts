// Payment gateway configuration types
export type PaymentGatewayType = 'mobileMoney' | 'bankTransfer' | 'creditCard' | 'custom';

export interface PaymentGatewayConfig {
  id: string;
  shopId: string;
  type: PaymentGatewayType;
  name: string;
  details: Record<string, string>; // e.g. { accountNumber, provider, apiKey, etc }
}

// Example: Mobile Money
// { id: '1', shopId: '123', type: 'mobileMoney', name: 'MTN Mobile', details: { phone: '260971234567' } }

// Example: Bank Transfer
// { id: '2', shopId: '123', type: 'bankTransfer', name: 'Zanaco', details: { accountNumber: '123456789', branch: 'Lusaka' } }

// Example: Credit Card
// { id: '3', shopId: '123', type: 'creditCard', name: 'Visa', details: { merchantId: 'abc123', apiKey: 'xyz' } }

export const defaultGateways: PaymentGatewayConfig[] = [
  // Add default gateways here if needed
];
