/**
 * Store Data Export/Import Functions
 * Allows manual transfer of store data between devices without Supabase RLS issues
 */

import { dexieDb } from './db';
import type { Store, Product, Category } from '@/types/pos';

export interface StoreExportData {
  store?: Store;
  stores?: Store[];
  products: Product[];
  categories: Category[];
  exportDate: string;
  version: string;
}

/**
 * Export store data to JSON file
 */
export async function exportStoreData(storeId: string): Promise<string> {
  const store = await dexieDb.stores.get(storeId);
  if (!store) {
    throw new Error('Store not found');
  }

  const products = await dexieDb.products.where('storeId').equals(storeId).toArray();
  const categories = await dexieDb.categories.where('storeId').equals(storeId).toArray();

  const exportData: StoreExportData = {
    store,
    products,
    categories,
    exportDate: new Date().toISOString(),
    version: '1.0'
  };

  const jsonString = JSON.stringify(exportData, null, 2);
  return jsonString;
}

/**
 * Import store data from JSON string
 */
export async function importStoreData(jsonString: string): Promise<string> {
  const rawData: Record<string, any> = JSON.parse(jsonString);

  const store: Store | undefined = rawData.store
    ? rawData.store
    : Array.isArray(rawData.stores) && rawData.stores.length > 0
    ? rawData.stores[0]
    : undefined;

  const products: Product[] = Array.isArray(rawData.products) ? rawData.products : [];
  const categories: Category[] = Array.isArray(rawData.categories) ? rawData.categories : [];

  if (!store) {
    throw new Error('Import failed: store object not found in JSON. Use a valid store export file.');
  }

  if (products.length === 0 && categories.length === 0) {
    throw new Error('Import failed: no products or categories found in JSON. Use a valid store export file.');
  }

  const storeId = store.id;
  const filteredProducts = storeId
    ? products.filter((item: any) => item.storeId === storeId || item.store_id === storeId)
    : products;
  const filteredCategories = storeId
    ? categories.filter((item: any) => item.storeId === storeId || item.store_id === storeId)
    : categories;

  await dexieDb.stores.put({ ...store, store_code: store.store_code, is_public: store.is_public });

  if (filteredProducts.length > 0) {
    await dexieDb.products.bulkPut(
      filteredProducts.map((item: any) => ({
        ...item,
        storeId: item.storeId || item.store_id || storeId,
      }))
    );
  }

  if (filteredCategories.length > 0) {
    await dexieDb.categories.bulkPut(
      filteredCategories.map((item: any) => ({
        ...item,
        storeId: item.storeId || item.store_id || storeId,
      }))
    );
  }

  console.log(`Imported store: ${store.name}`);
  console.log(`Imported ${filteredProducts.length} products`);
  console.log(`Imported ${filteredCategories.length} categories`);

  return storeId;
}

/**
 * Download store data as JSON file
 */
export async function downloadStoreData(storeId: string, storeName: string): Promise<void> {
  const jsonString = await exportStoreData(storeId);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${storeName.replace(/[^a-z0-9]/gi, '_')}_export.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read and parse JSON file for import
 */
export function readImportFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        resolve(e.target.result as string);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsText(file);
  });
}
