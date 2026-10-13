/**
 * Auto-generate product and category images using DiceBear API
 * Free, instant, no authentication required
 */

/**
 * Generate a DiceBear product image URL based on its name and category
 * Uses the shapes style so products do not look like human avatars
 */
export function generateProductImageUrl(
  productName: string,
  categoryName?: string
): string {
  const seed = `${productName}${categoryName ? `-${categoryName}` : ''}`.toLowerCase().trim();
  
  // DiceBear API endpoint with shapes style
  // Parameters:
  // - seed: deterministic generation from product name
  // - scale: 80 for more detail
  // - radius: 0 for square product thumbnails
  // - backgroundColor: auto generated from seed
  // - format: svg for scalability
  
  return `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(seed)}&scale=80&radius=0`;
}

/**
 * Generate a DiceBear category cover image URL
 */
export function generateCategoryImageUrl(
  categoryName: string
): string {
  const seed = categoryName.toLowerCase().trim();
  return `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(seed)}&scale=80&radius=0`;
}

/**
 * Alternative styles if you want variety:
 * - avataaars: cartoon avatars (current)
 * - shapes: geometric shapes
 * - initials: large initials
 * - icons: icon-based
 * 
 * Example for categories (more geometric):
 * https://api.dicebear.com/7.x/shapes/svg?seed={categoryName}&scale=80
 */

/**
 * Get a deterministic color based on product/category name
 * Useful for complementary UI elements
 */
export function getCategoryColor(categoryName: string): string {
  const colors = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#FFA07A', // Light Salmon
    '#98D8C8', // Mint
    '#F7DC6F', // Yellow
    '#BB8FCE', // Purple
    '#85C1E2', // Light Blue
    '#F8B88B', // Peach
    '#76D7C4', // Green
  ];

  let hash = 0;
  for (let i = 0; i < categoryName.length; i++) {
    const char = categoryName.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  const index = Math.abs(hash) % colors.length;
  return colors[index];
}
