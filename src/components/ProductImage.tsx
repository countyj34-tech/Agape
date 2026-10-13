/**
 * Product Image Component
 * Displays product images from cloud storage with fallback
 */

import React from 'react';
import { useProductImage } from '@/hooks/useProductImage';

interface ProductImageProps {
  productId: string;
  localImageUrl?: string;
  storeId?: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  showPlaceholder?: boolean;
  placeholderText?: string;
}

export function ProductImage({
  productId,
  localImageUrl,
  storeId,
  alt = 'Product image',
  className = '',
  style = {},
  showPlaceholder = true,
  placeholderText = 'No Image'
}: ProductImageProps) {
  const { imageUrl, isLoading } = useProductImage(productId, localImageUrl, storeId);
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    setHasError(false);
  }, [productId, localImageUrl, imageUrl]);

  if (isLoading) {
    return (
      <div
        className={`bg-gray-200 animate-pulse rounded ${className}`}
        style={style}
      />
    );
  }

  if (imageUrl && !hasError) {
    return (
      <img
        src={imageUrl}
        alt={alt}
        className={className}
        style={style}
        loading="lazy"
        onError={() => setHasError(true)}
      />
    );
  }

  if (showPlaceholder) {
    return (
      <div
        className={`bg-gray-100 rounded flex items-center justify-center text-gray-400 text-sm ${className}`}
        style={style}
      >
        {placeholderText}
      </div>
    );
  }

  return null;
}

/**
 * Product Image Background Component
 * For use as CSS background-image with proper loading
 */
interface ProductImageBackgroundProps {
  productId: string;
  localImageUrl?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

function ProductImageBackgroundRemote({
  productId,
  className = '',
  style = {},
  children,
}: ProductImageBackgroundProps) {
  const { imageUrl, isLoading } = useProductImage(productId, undefined);
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    setHasError(false);
  }, [productId, imageUrl]);

  if (isLoading) {
    return <div className={`bg-gray-200 animate-pulse ${className}`} style={style} />;
  }

  return (
    <div className={`relative overflow-hidden bg-gray-200 ${className}`} style={style}>
      {imageUrl && !hasError ? (
        <img
          src={imageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setHasError(true)}
        />
      ) : null}
      {children}
    </div>
  );
}

export function ProductImageBackground({
  productId,
  localImageUrl,
  className = '',
  style = {},
  children,
}: ProductImageBackgroundProps) {
  // Prefer local URL immediately — no async hook on the POS hot path.
  if (localImageUrl) {
    return (
      <div className={`relative overflow-hidden bg-slate-100 ${className}`} style={style}>
        <img
          src={localImageUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
        {children}
      </div>
    );
  }

  return (
    <ProductImageBackgroundRemote productId={productId} className={className} style={style}>
      {children}
    </ProductImageBackgroundRemote>
  );
}
