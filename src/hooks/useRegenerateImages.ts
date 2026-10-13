import { useCallback, useState } from 'react';
import { generateProductImageUrl, generateCategoryImageUrl } from '../lib/dicebearImageGenerator';
import { updateProduct, updateCategory } from '../lib/db';
import { Product } from '../types/pos';

interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  order: number;
  storeId?: string;
  createdAt: Date;
}

/**
 * Hook to regenerate product images
 * Useful if user wants a different auto-generated image without manual upload
 */
export function useRegenerateProductImage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerate = useCallback(async (product: Product) => {
    setIsLoading(true);
    setError(null);
    try {
      const categoryName = product.categoryIds?.[0] || 'product';
      const newImageUrl = generateProductImageUrl(product.name, categoryName);
      await updateProduct({ ...product, imageUrl: newImageUrl });
      return newImageUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate image';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { regenerate, isLoading, error };
}

/**
 * Hook to regenerate category images
 * Useful if user wants a different color without manual setup
 */
export function useRegenerateCategoryColor() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerate = useCallback(async (category: Category) => {
    setIsLoading(true);
    setError(null);
    try {
      const newImageUrl = generateCategoryImageUrl(category.name);
      // Note: Categories use color field, not imageUrl
      // If you want to add image URLs to categories, update the Category interface
      await updateCategory({ ...category, icon: newImageUrl });
      return newImageUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate color';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { regenerate, isLoading, error };
}
