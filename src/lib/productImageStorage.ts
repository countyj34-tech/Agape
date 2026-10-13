/**
 * Product Image Storage
 * Manages uploading and retrieving product images from Firebase Storage
 * Falls back to local base64 if images unavailable
 */

import { supabase, isSupabaseConfigured, getDeviceStoreId, hasActiveSession } from './supabase';
import { toast } from 'sonner';

const BUCKET_NAME = 'product-images';
const COMPANY_BUCKET_NAME = 'company-images';
const CACHE_KEY = 'product_image_urls'; // Cache for image URLs to avoid repeated lookups
const COMPANY_CACHE_KEY = 'company_image_urls'; // Cache for company image URLs

/**
 * Initialize the product images bucket (admin only, call once during setup)
 */
export async function initializeProductImagesBucket(): Promise<void> {
  if (!isSupabaseConfigured()) return;

  // Intentionally no-op. Probing bucket metadata from the browser can surface
  // misleading permission/bucket-existence errors even when the bucket is valid.
  // Real upload/list operations will surface the actual storage failure, if any.
}

/**
 * Upload product image to Supabase Storage
 * Returns the public URL if successful, otherwise returns the base64 for local storage
 */
export async function uploadProductImage(
  productId: string,
  imageData: string, // base64 data URL or URL
  storeId?: string
): Promise<{ url: string; isCloud: boolean }> {
  const store = storeId || getDeviceStoreId();

  // If not a base64 data URL or already a URL, return as-is
  if (!imageData.startsWith('data:')) {
    return { url: imageData, isCloud: false };
  }

  if (!isSupabaseConfigured()) {
    console.log('Supabase not configured, keeping image as local base64');
    return { url: imageData, isCloud: false };
  }

  try {
    // Convert base64 data URL to blob
    const response = await fetch(imageData);
    const blob = await response.blob();

    // Determine file extension from mime type
    const mimeType = blob.type || 'image/jpeg';
    const extension = mimeType.split('/')[1] || 'jpg';

    // Create unique file path
    const filename = `${store}/${productId}-${Date.now()}.${extension}`;

    console.log(`Uploading product image: ${filename}`);

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, blob, {
        upsert: true,
        cacheControl: '3600',
        contentType: mimeType,
      });

    if (uploadError) {
      throw uploadError;
    }

    const {
      data: { publicUrl: downloadUrl },
    } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filename);

    if (downloadUrl) {
      console.log(`✓ Product image uploaded: ${downloadUrl}`);

      // Cache URL
      cacheImageUrl(productId, downloadUrl, store);

      return { url: downloadUrl, isCloud: true };
    }

    return { url: imageData, isCloud: false };
  } catch (error) {
    console.error('Error uploading product image:', error);
    // Fall back to local base64
    return { url: imageData, isCloud: false };
  }
}

/**
 * Get product image URL from cache or remote storage
 * Checks cache first, then fetches from Supabase if needed
 */
export async function getProductImageUrl(productId: string, storeId?: string): Promise<string | null> {
  const resolvedStoreId = storeId || getDeviceStoreId();

  // Check cache first
  const cached = getCachedImageUrl(productId, resolvedStoreId);
  if (cached) {
    return cached;
  }

  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(resolvedStoreId, {
        limit: 100,
        sortBy: { column: 'name', order: 'desc' },
      });

    if (error) {
      throw error;
    }

    const match = (data || []).find((file) => file.name.startsWith(`${productId}-`));
    if (match?.name) {
      const fullPath = `${resolvedStoreId}/${match.name}`;
      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET_NAME).getPublicUrl(fullPath);

      if (publicUrl) {
        cacheImageUrl(productId, publicUrl, resolvedStoreId);
        return publicUrl;
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching product image URL:', error);
    return null;
  }
}

/**
 * Cache image URL in localStorage to avoid repeated lookups
 */
function cacheImageUrl(productId: string, url: string, storeId: string): void {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const key = `${storeId}_${productId}`;
    cache[key] = {
      url,
      timestamp: Date.now(),
      expiry: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Failed to cache image URL:', error);
  }
}

/**
 * Get cached image URL if not expired
 */
function getCachedImageUrl(productId: string, storeId: string): string | null {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const key = `${storeId}_${productId}`;
    const cached = cache[key];

    if (cached && cached.expiry > Date.now()) {
      return cached.url;
    }

    // Remove expired entry
    if (cached) {
      delete cache[key];
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    }
  } catch (error) {
    console.warn('Failed to read image URL cache:', error);
  }

  return null;
}

/**
 * Delete product image from Supabase Storage
 */
export async function deleteProductImage(productId: string, storeId?: string): Promise<boolean> {
  const store = storeId || getDeviceStoreId();

  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(store, { limit: 100 });

    if (error) {
      throw error;
    }

    const targets = (data || [])
      .filter((file) => file.name.startsWith(`${productId}-`))
      .map((file) => `${store}/${file.name}`);

    if (targets.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove(targets);

      if (removeError) {
        throw removeError;
      }

      console.log(`✓ Deleted product image for ${productId}`);
    }

    // Clear from cache
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      delete cache[productId];
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {}

    return true;
  } catch (error) {
    console.error('Error deleting product image:', error);
    return false;
  }
}

/**
 * Clear entire image cache
 */
export function clearImageCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
    console.log('Cleared product image cache');
  } catch (error) {
    console.warn('Failed to clear image cache:', error);
  }
}

/**
 * Sync local product images to Supabase Storage
 * Call this periodically to upload any local base64 images
 */
export async function syncLocalProductImages(products: any[]): Promise<number> {
  if (!isSupabaseConfigured()) {
    return 0;
  }

  let syncedCount = 0;

  for (const product of products) {
    // Only process local base64 images
    if (product.imageUrl && product.imageUrl.startsWith('data:')) {
      try {
        const result = await uploadProductImage(product.id, product.imageUrl, product.storeId);
        
        if (result.isCloud) {
          syncedCount++;
          
          // Update product's imageUrl to point to cloud (optional, for next sync)
          // This would be done in the product update function
        }
      } catch (error) {
        console.warn(`Failed to sync image for product ${product.id}:`, error);
      }
    }
  }

  if (syncedCount > 0) {
    console.log(`✓ Synced ${syncedCount} product images to cloud`);
  }

  return syncedCount;
}

/**
 * Get a signed URL for temporary image access
 * Useful for sharing or temporary download links
 */
export async function getTemporaryProductImageUrl(
  productId: string,
  storeId?: string,
  expirySeconds = 3600
): Promise<string | null> {
  const store = storeId || getDeviceStoreId();

  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    // Find the image file
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(store, {
        limit: 100,
        search: productId,
      });

    if (error || !data || data.length === 0) {
      return null;
    }

    const latestFile = data
      .filter(f => !(f as any).metadata?.isdir && f.name.includes(productId))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];

    if (!latestFile) {
      return null;
    }

    // Create signed URL
    const { data: signedData, error: signedError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(`${store}/${latestFile.name}`, expirySeconds);

    if (signedError || !signedData?.signedUrl) {
      return null;
    }

    return signedData.signedUrl;
  } catch (error) {
    console.error('Error generating temporary image URL:', error);
    return null;
  }
}

/**
 * Check and update product images in database
 * Ensures all products have proper image URLs stored
 */
export async function checkAndUpdateProductImages(products: any[]): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.log('Supabase not configured, skipping image check');
    return;
  }

  console.log(`Checking images for ${products.length} products...`);

  for (const product of products) {
    try {
      // Check if product has an image URL that needs updating
      if (product.imageUrl && product.imageUrl.startsWith('data:')) {
        // This is a base64 image that should be uploaded to cloud
        console.log(`Uploading base64 image for product: ${product.name}`);
        const result = await uploadProductImage(product.id, product.imageUrl, product.storeId);

        if (result.isCloud) {
          // Update the product in database with cloud URL
          await updateProductImageUrl(product.id, result.url);
          console.log(`✓ Updated ${product.name} with cloud image URL`);
        }
      } else if (product.imageUrl && !product.imageUrl.startsWith('http')) {
        // Check if this is a relative URL that needs to be resolved
        const cloudUrl = await getProductImageUrl(product.id);
        if (cloudUrl && cloudUrl !== product.imageUrl) {
          await updateProductImageUrl(product.id, cloudUrl);
          console.log(`✓ Updated ${product.name} with resolved cloud URL`);
        }
      }
    } catch (error) {
      console.warn(`Failed to check/update image for product ${product.name}:`, error);
    }
  }

  console.log('Product image check complete');
}

/**
 * Update product image URL in database
 */
async function updateProductImageUrl(productId: string, imageUrl: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const { error } = await supabase
      .from('products')
      .update({ image_url: imageUrl })
      .eq('id', productId);

    if (error) throw error;
  } catch (error) {
    console.error(`Failed to update image URL for product ${productId}:`, error);
  }
}

/**
 * Get all products and check their images
 * Call this periodically to ensure images are up to date
 */
export async function syncAllProductImages(): Promise<void> {
  if (!isSupabaseConfigured()) return;

  if (!(await hasActiveSession())) {
    return;
  }

  try {
    const storeId = getDeviceStoreId();

    // Get all products for this store
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .eq('store_id', storeId);

    if (error) throw error;
    if (!products || products.length === 0) return;

    await checkAndUpdateProductImages(products);
  } catch (error) {
    console.error('Failed to sync product images:', error);
  }
}

/**
 * Download product image from Supabase and store as base64 locally
 * Used when joining a store to mirror all images for offline access
 */
export async function downloadAndStoreProductImage(
  productId: string,
  storeId: string
): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    // Get the image URL from Supabase
    const imageUrl = await getProductImageUrl(productId, storeId);
    if (!imageUrl) {
      return null;
    }

    // Download the image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.warn(`Failed to download image for product ${productId}`);
      return null;
    }

    const blob = await response.blob();

    // Convert to base64 for local storage
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(`Failed to download image for product ${productId}:`, error);
    return null;
  }
}

/**
 * Download and store all product images for a store
 * Call this when joining a store to mirror all images locally
 */
export async function downloadAllStoreImages(storeId: string, products: any[]): Promise<number> {
  if (!isSupabaseConfigured()) {
    return 0;
  }

  let downloadedCount = 0;

  for (const product of products) {
    if (product.image_url && product.image_url.startsWith('http')) {
      try {
        const base64 = await downloadAndStoreProductImage(product.id, storeId);
        if (base64) {
          // Update product with local base64 image
          product.imageUrl = base64;
          downloadedCount++;
          console.log(`✓ Downloaded image for ${product.name}`);
        }
      } catch (error) {
        console.warn(`Failed to download image for ${product.name}:`, error);
      }
    }
  }

  if (downloadedCount > 0) {
    console.log(`✓ Downloaded ${downloadedCount} product images for offline access`);
  }

  return downloadedCount;
}

/**
 * Upload company image to Supabase Storage
 */
export async function uploadCompanyImage(
  companyId: string,
  imageData: string
): Promise<{ url: string; isCloud: boolean }> {
  const COMPANY_BUCKET_NAME = 'company-images';

  // If not a base64 data URL or already a URL, return as-is
  if (!imageData.startsWith('data:')) {
    return { url: imageData, isCloud: false };
  }

  if (!isSupabaseConfigured()) {
    console.log('Supabase not configured, keeping company image as local base64');
    return { url: imageData, isCloud: false };
  }

  try {
    // Convert base64 data URL to blob
    const response = await fetch(imageData);
    const blob = await response.blob();

    // Determine file extension from mime type
    const mimeType = blob.type || 'image/jpeg';
    const extension = mimeType.split('/')[1] || 'jpg';

    // Create unique file path
    const filename = `${companyId}.${extension}`;

    console.log(`Uploading company image: ${filename}`);

    // Upload to Supabase Storage
    const { error, data } = await supabase.storage
      .from(COMPANY_BUCKET_NAME)
      .upload(filename, blob, {
        cacheControl: '3600',
        upsert: true, // Overwrite if exists
      });

    if (error) {
      console.warn('Failed to upload company image:', error);
      // Fall back to local base64
      return { url: imageData, isCloud: false };
    }

    // Get public URL
    const { data: publicData } = supabase.storage
      .from(COMPANY_BUCKET_NAME)
      .getPublicUrl(filename);

    if (publicData?.publicUrl) {
      console.log(`✓ Company image uploaded: ${publicData.publicUrl}`);
      return { url: publicData.publicUrl, isCloud: true };
    }

    return { url: imageData, isCloud: false };
  } catch (error) {
    console.error('Error uploading company image:', error);
    // Fall back to local base64
    return { url: imageData, isCloud: false };
  }
}

/**
 * Get company image URL from Supabase Storage
 */
export async function getCompanyImageUrl(companyId: string): Promise<string | null> {
  const COMPANY_BUCKET_NAME = 'company-images';

  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    // List files for this company
    const { data, error } = await supabase.storage
      .from(COMPANY_BUCKET_NAME)
      .list('', {
        limit: 10,
        search: companyId,
      });

    if (error || !data || data.length === 0) {
      return null;
    }

    // Get the most recent image
    const latestFile = data
      .filter(f => !(f as any).metadata?.isdir)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];

    if (!latestFile) {
      return null;
    }

    // Get public URL
    const { data: publicData } = supabase.storage
      .from(COMPANY_BUCKET_NAME)
      .getPublicUrl(latestFile.name);

    if (publicData?.publicUrl) {
      return publicData.publicUrl;
    }

    return null;
  } catch (error) {
    console.error('Error fetching company image URL:', error);
    return null;
  }
}

/**
 * Sync all local product images to Supabase for a specific store
 * Call this to upload all base64 images to cloud storage
 */
export async function syncStoreImagesToSupabase(storeId: string): Promise<number> {
  if (!isSupabaseConfigured()) {
    console.log('Supabase not configured, skipping image sync');
    return 0;
  }

  // Import Dexie to get products from local database
  const { dexieDb } = await import('./db');

  try {
    const products = await dexieDb.products.where('storeId').equals(storeId).toArray();

    if (products.length === 0) {
      console.log('No products found in local database for store:', storeId);
      return 0;
    }

    let syncedCount = 0;

    for (const product of products) {
      // Only process products with local base64 images
      if (product.imageUrl && product.imageUrl.startsWith('data:')) {
        try {
          const result = await uploadProductImage(product.id, product.imageUrl, storeId);

          if (result.isCloud) {
            // Update product in local database with cloud URL
            await dexieDb.products.update(product.id, { imageUrl: result.url });

            // Also update in Supabase if configured
            try {
              await supabase
                .from('products')
                .update({ image_url: result.url })
                .eq('id', product.id);
            } catch (supabaseError) {
              console.warn('Failed to update product image URL in Supabase:', supabaseError);
            }

            syncedCount++;
            console.log(`✓ Synced image for ${product.name}`);
          }
        } catch (error) {
          console.warn(`Failed to sync image for ${product.name}:`, error);
        }
      }
    }

    if (syncedCount > 0) {
      console.log(`✓ Synced ${syncedCount} product images to Supabase for store ${storeId}`);
    }

    return syncedCount;
  } catch (error) {
    console.error('Failed to sync store images to Supabase:', error);
    return 0;
  }
}
