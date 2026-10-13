/**
 * Script to sync all product images from a store to Supabase
 * Run with: node sync-store-images.js <store_id>
 */

const storeId = 'bfdb2155-6b52-455c-b2a1-0b2daa67ce0c';

console.log(`Syncing images for store: ${storeId}`);

// This script needs to be run in a browser console or integrated into the app
// For now, you can run this function in the browser console:
// 
// 1. Open the browser console (F12)
// 2. Navigate to the app
// 3. Paste and run:
//
// (async () => {
//   const { syncStoreImagesToSupabase } = await import('./src/lib/productImageStorage.ts');
//   const count = await syncStoreImagesToSupabase('bfdb2155-6b52-455c-b2a1-0b2daa67ce0c');
//   console.log(`Synced ${count} images`);
// })();

console.log('Please run the function in the browser console as shown above.');
