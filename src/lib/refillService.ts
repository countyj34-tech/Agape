/**
 * Refill Stock Service
 * Integrates with backend /api/inventory/refill endpoint for auto-extraction
 */

const REFILL_ENDPOINT = import.meta.env.VITE_REFILL_API_URL || '/api/inventory/refill';

export interface RefillResponse {
  item_name: string;
  refill_quantity: number;
}

export interface RefillError {
  error?: string;
  detail?: string | Record<string, any>;
  status?: number;
}

/**
 * Upload a file (image, PDF, spreadsheet) and auto-extract refill quantity
 * Returns: { item_name, refill_quantity }
 */
export async function extractRefillFromFile(file: File): Promise<RefillResponse> {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(REFILL_ENDPOINT, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData: RefillError = await response.json().catch(() => ({}));
      const detail = errorData.detail || errorData.error || `HTTP ${response.status}`;
      const message = typeof detail === 'string' 
        ? detail 
        : detail.error || JSON.stringify(detail);
      throw new Error(`Refill extraction failed: ${message}`);
    }

    const data: RefillResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Refill extraction error:', error);
    throw error;
  }
}

/**
 * Get divisor for a product type (cost per unit reference)
 * Used to reverse-engineer quantity from total amount
 */
export function getDivisorForProduct(productName: string): number {
  const name = productName.toLowerCase().trim();
  
  const divisorMap: Record<string, number> = {
    'amarula': 23,
    'best cream': 23,
    'cream': 23,
    'lagers': 24,
    'beer': 24,
    'water': 12,
    'soft drink': 12,
    'drinks': 12,
    'coca': 12,
    'fanta': 12,
    'sprite': 12,
    'life way': 12,
    'konyagi small': 24,
    'konyagi big': 12,
    'konyagi': 12,
    'whisks': 21,
    'whisk': 21,
  };

  // Match the most specific term first
  for (const [key, divisor] of Object.entries(divisorMap).sort((a, b) => b[0].length - a[0].length)) {
    if (name.includes(key)) {
      return divisor;
    }
  }

  return 24; // Default divisor
}

/**
 * Calculate buying price from total amount and product name
 */
export function calculateBuyingPrice(productName: string, totalAmount: number): number {
  const divisor = getDivisorForProduct(productName);
  return Math.round((totalAmount / divisor) * 100) / 100;
}
