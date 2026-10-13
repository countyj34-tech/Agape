/**
 * Hook to load product images from cloud with fallback to local
 */

import { useState, useEffect } from 'react';
import { getProductImageUrl } from '@/lib/productImageStorage';

export function useProductImage(productId: string, localImageUrl?: string, storeId?: string) {
  const [imageUrl, setImageUrl] = useState<string | null>(localImageUrl || null);
  const [isLoading, setIsLoading] = useState(!localImageUrl);

  useEffect(() => {
    let isMounted = true;

    const loadImage = async () => {
      // If we have a local image, prefer it
      if (localImageUrl) {
        if (isMounted) {
          setImageUrl(localImageUrl);
          setIsLoading(false);
        }
        return;
      }

      if (isMounted) setIsLoading(true);

      try {
        const cloudUrl = await getProductImageUrl(productId, storeId);
        if (isMounted) {
          setImageUrl(cloudUrl);
          setIsLoading(false);
        }
      } catch (error) {
        console.warn(`Failed to load image for product ${productId}:`, error);
        if (isMounted) {
          setImageUrl(null);
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [productId, localImageUrl]);

  return { imageUrl, isLoading };
}
