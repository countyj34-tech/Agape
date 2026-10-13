/**
 * Store Code Generation and Management
 * Generates unique codes for joining stores across devices
 */

/**
 * Generate a unique store code
 * Format: SHOP-XXXXX (where XXXXX is random alphanumeric)
 * Examples: SHOP-A7K2M, SHOP-Q9J8F
 */
export function generateStoreCode(storeName?: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars (I, O, 0, 1)
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SHOP-${code}`;
}

/**
 * Validate store code format
 */
export function isValidStoreCode(code: string): boolean {
  return /^SHOP-[A-Z0-9]{5}$/.test(code);
}
