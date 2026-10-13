/**
 * General Data Service - Supabase First Architecture
 *
 * Handles CRUD operations for all data tables with Supabase first, local storage second
 * Supports offline sync for all operations
 */

import { supabase } from './supabase';
import { SupabaseFirstService } from './supabaseFirst';

// Generic types for data operations
export interface BaseEntity {
  id: string;
  created_at?: string;
  updated_at?: string;
}

export interface Product extends BaseEntity {
  store_id: string;
  name: string;
  barcode?: string;
  buying_price: number;
  selling_price: number;
  stock: number;
  low_stock_threshold?: number;
  stock_unit?: string;
  sell_unit?: string;
  units_per_bulk?: number;
  category_ids?: string[];
  image_url?: string;
}

export interface Category extends BaseEntity {
  store_id: string;
  name: string;
  icon?: string;
  color?: string;
  display_order?: number;
}

export interface Sale extends BaseEntity {
  store_id: string;
  receipt_number: string;
  subtotal: number;
  discount?: number;
  total: number;
  profit?: number;
  payment_method: 'cash' | 'card' | 'mobile' | 'credit';
  amount_paid?: number;
  amount_received?: number;
  change_given?: number;
  balance_due?: number;
  customer_name?: string;
  customer_id?: string;
  mobile_provider?: string;
  mobile_reference?: string;
  shift_id?: string;
  cashier_name?: string;
  staff_id?: string;
  synced_from_device?: string;
}

export interface SaleItem extends BaseEntity {
  sale_id: string;
  product_id?: string;
  product_name: string;
  quantity: number;
  price_at_sale: number;
  buying_price_at_sale?: number;
}

export interface Customer extends BaseEntity {
  store_id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  total_purchases?: number;
  total_owed?: number;
}

export interface Store extends BaseEntity {
  company_id: string;
  name: string;
  location_name?: string;
  category?: string;
  address?: string;
  phone?: string;
  currency?: string;
  currency_symbol?: string;
  payment_numbers?: Record<string, string>;
  owner_id?: string;
  store_code?: string;
  is_public?: boolean;
}

// Generic data service class
export class DataService<T extends BaseEntity> {
  constructor(
    private tableName: string,
    private localStorageKey: string
  ) {}

  // Create operation
  async create(data: Omit<T, 'id' | 'created_at' | 'updated_at'>): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
      // 1. Create in Supabase first
      const { data: result, error } = await supabase
        .from(this.tableName)
        .insert(data)
        .select()
        .single();

      if (error) {
        console.error(`Supabase ${this.tableName} insert failed:`, error.message);

        // If offline, queue for later sync
        if (!this.isOnline()) {
          SupabaseFirstService.addToSyncQueue({
            type: 'create',
            table: this.tableName,
            data,
          });
          return { success: false, error: `Offline: ${this.tableName} creation queued for sync` };
        }

        return { success: false, error: error.message };
      }

      const createdData = result as T;

      // 2. Mirror to local storage
      this.saveToLocalStorage(createdData);

      return { success: true, data: createdData };
    } catch (error: any) {
      console.error(`${this.tableName} creation error:`, error);
      return { success: false, error: error.message || `Failed to create ${this.tableName}` };
    }
  }

  // Read operations
  async getById(id: string): Promise<T | null> {
    try {
      // Try Supabase first
      if (this.isOnline()) {
        const { data, error } = await supabase
          .from(this.tableName)
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) {
          // Update local storage
          this.saveToLocalStorage(data);
          return data;
        }
      }

      // Fallback to local storage
      return this.getFromLocalStorageById(id);
    } catch (error) {
      console.error(`Error fetching ${this.tableName}:`, error);
      // Fallback to local storage
      return this.getFromLocalStorageById(id);
    }
  }

  async getAll(storeId?: string): Promise<T[]> {
    try {
      // Try Supabase first
      if (this.isOnline()) {
        let query = supabase.from(this.tableName).select('*');

        if (storeId) {
          query = query.eq('store_id', storeId);
        }

        const { data, error } = await query;

        if (!error && data) {
          // Update local storage
          data.forEach(item => this.saveToLocalStorage(item));
          return data;
        }
      }

      // Fallback to local storage
      return this.getAllFromLocalStorage(storeId);
    } catch (error) {
      console.error(`Error fetching ${this.tableName}:`, error);
      // Fallback to local storage
      return this.getAllFromLocalStorage(storeId);
    }
  }

  // Update operation
  async update(id: string, updates: Partial<T>): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
      // 1. Update in Supabase first
      const { data, error } = await supabase
        .from(this.tableName)
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error(`Supabase ${this.tableName} update failed:`, error.message);

        // If offline, queue for later sync
        if (!this.isOnline()) {
          SupabaseFirstService.addToSyncQueue({
            type: 'update',
            table: this.tableName,
            data: { id, ...updates },
          });
          return { success: false, error: `Offline: ${this.tableName} update queued for sync` };
        }

        return { success: false, error: error.message };
      }

      const updatedData = data as T;

      // 2. Mirror to local storage
      this.saveToLocalStorage(updatedData);

      return { success: true, data: updatedData };
    } catch (error: any) {
      console.error(`${this.tableName} update error:`, error);
      return { success: false, error: error.message || `Failed to update ${this.tableName}` };
    }
  }

  // Delete operation
  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Delete from Supabase first
      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) {
        console.error(`Supabase ${this.tableName} delete failed:`, error.message);

        // If offline, queue for later sync
        if (!this.isOnline()) {
          SupabaseFirstService.addToSyncQueue({
            type: 'delete',
            table: this.tableName,
            data: { id },
          });
          return { success: false, error: `Offline: ${this.tableName} deletion queued for sync` };
        }

        return { success: false, error: error.message };
      }

      // 2. Remove from local storage
      this.removeFromLocalStorage(id);

      return { success: true };
    } catch (error: any) {
      console.error(`${this.tableName} delete error:`, error);
      return { success: false, error: error.message || `Failed to delete ${this.tableName}` };
    }
  }

  // Local storage helpers
  private saveToLocalStorage(data: T): void {
    const allData = this.getAllFromLocalStorage();
    const existingIndex = allData.findIndex(item => item.id === data.id);

    if (existingIndex >= 0) {
      allData[existingIndex] = { ...allData[existingIndex], ...data };
    } else {
      allData.push(data);
    }

    localStorage.setItem(this.localStorageKey, JSON.stringify(allData));
  }

  private getFromLocalStorageById(id: string): T | null {
    const allData = this.getAllFromLocalStorage();
    return allData.find(item => item.id === id) || null;
  }

  private getAllFromLocalStorage(storeId?: string): T[] {
    try {
      const data = localStorage.getItem(this.localStorageKey);
      const parsed = data ? JSON.parse(data) : [];

      if (storeId) {
        return parsed.filter((item: T) => (item as any).store_id === storeId);
      }

      return parsed;
    } catch (error) {
      console.error(`Error reading ${this.tableName} from localStorage:`, error);
      return [];
    }
  }

  private removeFromLocalStorage(id: string): void {
    const allData = this.getAllFromLocalStorage();
    const filtered = allData.filter(item => item.id !== id);
    localStorage.setItem(this.localStorageKey, JSON.stringify(filtered));
  }

  private isOnline(): boolean {
    return navigator.onLine;
  }
}

// Service instances for each table
export const productService = new DataService<Product>('products', 'mthunzi_products');
export const categoryService = new DataService<Category>('categories', 'mthunzi_categories');
export const saleService = new DataService<Sale>('sales', 'mthunzi_sales');
export const saleItemService = new DataService<SaleItem>('sale_items', 'mthunzi_sale_items');
export const customerService = new DataService<Customer>('customers', 'mthunzi_customers');
export const storeService = new DataService<Store>('stores', 'mthunzi_stores');

// Specialized methods for complex operations

// Product operations
export const ProductService = {
  ...productService,

  // Get products by category
  async getByCategory(storeId: string, categoryId: string): Promise<Product[]> {
    try {
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('store_id', storeId)
          .contains('category_ids', [categoryId]);

        if (!error && data) {
          data.forEach(product => productService['saveToLocalStorage'](product));
          return data;
        }
      }

      // Fallback to local storage
      const allProducts = productService['getAllFromLocalStorage'](storeId);
      return allProducts.filter(product => product.category_ids?.includes(categoryId));
    } catch (error) {
      console.error('Error fetching products by category:', error);
      const allProducts = productService['getAllFromLocalStorage'](storeId);
      return allProducts.filter(product => product.category_ids?.includes(categoryId));
    }
  },

  // Update stock
  async updateStock(productId: string, newStock: number): Promise<{ success: boolean; error?: string }> {
    return productService.update(productId, { stock: newStock });
  },

  // Search products
  async search(storeId: string, query: string): Promise<Product[]> {
    try {
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('store_id', storeId)
          .or(`name.ilike.%${query}%,barcode.ilike.%${query}%`);

        if (!error && data) {
          data.forEach(product => productService['saveToLocalStorage'](product));
          return data;
        }
      }

      // Fallback to local storage
      const allProducts = productService['getAllFromLocalStorage'](storeId);
      const lowerQuery = query.toLowerCase();
      return allProducts.filter(product =>
        product.name.toLowerCase().includes(lowerQuery) ||
        product.barcode?.toLowerCase().includes(lowerQuery)
      );
    } catch (error) {
      console.error('Error searching products:', error);
      const allProducts = productService['getAllFromLocalStorage'](storeId);
      const lowerQuery = query.toLowerCase();
      return allProducts.filter(product =>
        product.name.toLowerCase().includes(lowerQuery) ||
        product.barcode?.toLowerCase().includes(lowerQuery)
      );
    }
  },
};

// Sale operations
export const SaleService = {
  ...saleService,

  // Create sale with items
  async createSaleWithItems(
    saleData: Omit<Sale, 'id' | 'created_at' | 'updated_at'>,
    items: Omit<SaleItem, 'id' | 'sale_id' | 'created_at'>[]
  ): Promise<{ success: boolean; sale?: Sale; items?: SaleItem[]; error?: string }> {
    try {
      // Start transaction-like operation
      const saleResult = await saleService.create(saleData);

      if (!saleResult.success || !saleResult.data) {
        return { success: false, error: saleResult.error };
      }

      const sale = saleResult.data;
      const itemsWithSaleId = items.map(item => ({ ...item, sale_id: sale.id }));

      // Create sale items
      const itemResults = await Promise.all(
        itemsWithSaleId.map(item => saleItemService.create(item))
      );

      const failedItems = itemResults.filter(result => !result.success);
      if (failedItems.length > 0) {
        console.error('Some sale items failed to create:', failedItems);
        // Continue anyway - sale is created
      }

      const successfulItems = itemResults
        .filter(result => result.success && result.data)
        .map(result => result.data!);

      return {
        success: true,
        sale,
        items: successfulItems,
      };
    } catch (error: any) {
      console.error('Sale creation error:', error);
      return { success: false, error: error.message || 'Failed to create sale' };
    }
  },

  // Get sales with items
  async getSaleWithItems(saleId: string): Promise<{ sale?: Sale; items?: SaleItem[] }> {
    try {
      const [sale, items] = await Promise.all([
        saleService.getById(saleId),
        saleItemService.getAll().then(allItems => allItems.filter(item => item.sale_id === saleId)),
      ]);

      return { sale: sale || undefined, items };
    } catch (error) {
      console.error('Error fetching sale with items:', error);
      return {};
    }
  },
};

// Customer operations
export const CustomerService = {
  ...customerService,

  // Search customers
  async search(storeId: string, query: string): Promise<Customer[]> {
    try {
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from('customers')
          .select('*')
          .eq('store_id', storeId)
          .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%`);

        if (!error && data) {
          data.forEach(customer => customerService['saveToLocalStorage'](customer));
          return data;
        }
      }

      // Fallback to local storage
      const allCustomers = customerService['getAllFromLocalStorage'](storeId);
      const lowerQuery = query.toLowerCase();
      return allCustomers.filter(customer =>
        customer.name.toLowerCase().includes(lowerQuery) ||
        customer.phone?.toLowerCase().includes(lowerQuery) ||
        customer.email?.toLowerCase().includes(lowerQuery)
      );
    } catch (error) {
      console.error('Error searching customers:', error);
      const allCustomers = customerService['getAllFromLocalStorage'](storeId);
      const lowerQuery = query.toLowerCase();
      return allCustomers.filter(customer =>
        customer.name.toLowerCase().includes(lowerQuery) ||
        customer.phone?.toLowerCase().includes(lowerQuery) ||
        customer.email?.toLowerCase().includes(lowerQuery)
      );
    }
  },
};