import Dexie from 'dexie';
import type { Table } from 'dexie';
import type {
  Product,
  Category,
  Sale,
  DailySummary,
  Settings,
  SaleItem,
  Shift,
  EodClosure,
  Customer,
  CustomerLedgerEntry,
  Expense,
  ShiftReport,
  StockInwardLog,
  AuditLog,
  OnlineOrder,
  OnlineOrderItem,
  Company,
  Staff,
  Department,
  ShiftLog,
  CompanySalesSummary,
  StoreInventoryAlert,
  DailyInventoryAudit,
  StockReconciliationSession,
  StockReconciliationOcrRow,
  CustomerDisplaySettings,
} from '@/types/pos';
import { generateReceiptNumber } from '@/types/pos';
import { getDeviceStoreId, setDeviceStoreId, getDeviceId, isSupabaseConfigured } from './supabase';
import type { SupabaseStore } from '@/lib/supabase';
import { getOrCreateCashierId } from '@/lib/staffIdentity';
import { bluetoothPrinterService } from '@/lib/bluetoothPrinterService';
import { buildEscPosShortageSlip } from '@/lib/escpos';
import { backupSaleSnapshot } from '@/lib/saleBackup';
import { getBackupSnapshots } from '@/lib/saleBackup';
import type { SaleSnapshotPayload } from '@/lib/saleBackup';
import { computeSalesTax, getDefaultSalesTaxRate, getSalesTaxMode } from '@/lib/taxEngine';

type SaleSnapshotRecord = {
  id?: number;
  saleId: string;
  createdAt: Date;
  payloadJson: string;
};

export type SaleItemRecord = {
  id?: number;
  saleId: string;
  productId: string;
  productName: string;
  qty: number;
  priceAtSale: number;
  buyingPriceAtSale: number;
  timestamp: Date;
  // Multi-store helper field; older records may not have this populated.
  storeId?: string;
};

export type SaleDraftItem = {
  productId: string;
  quantity: number;
  unitPrice: number; // price charged to customer
};

const DB_NAME =
  typeof process !== 'undefined' && process.env?.VITEST
    ? `mthunzi-pos-db-${process.env.VITEST_POOL_ID || '0'}`
    : 'mthunzi-pos-db';

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

class MthunziDexieDB extends Dexie {
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  sales!: Table<Sale, string>;
  saleItems!: Table<SaleItemRecord, number>;
  dailySummaries!: Table<DailySummary, string>;
  settings!: Table<Settings, string>;
  shifts!: Table<Shift, string>;
  eodClosures!: Table<EodClosure, string>;
  customers!: Table<Customer, string>;
  customerLedger!: Table<CustomerLedgerEntry, string>;
  expenses!: Table<Expense, string>;
  shiftReports!: Table<ShiftReport, string>;
  stockInwardLogs!: Table<StockInwardLog, string>;
  stores!: Table<SupabaseStore, string>;
  saleSnapshots!: Table<SaleSnapshotRecord, number>;
  auditLogs!: Table<AuditLog, string>;
  onlineOrders!: Table<OnlineOrder, string>;
  onlineOrderItems!: Table<OnlineOrderItem, string>;
  companies!: Table<Company, string>;
  staff!: Table<Staff, string>;
  departments!: Table<Department, string>;
  shiftLogs!: Table<ShiftLog, string>;
  companySalesSummary!: Table<CompanySalesSummary, string>;
  dailyInventoryAudits!: Table<DailyInventoryAudit, string>;
  stockReconciliationSessions!: Table<StockReconciliationSession, string>;
  storeInventoryAlerts!: Table<StoreInventoryAlert, string>;
  customerDisplaySettings!: Table<CustomerDisplaySettings, string>;

  constructor() {
    super(DB_NAME);

    // v1 schema (matches original idb DB_VERSION=1)
    this.version(1).stores({
      products: 'id, barcode, name, *categoryIds',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber',
      dailySummaries: 'id, date',
      settings: 'id',
    });

    // v2 schema adds saleItems (matches idb DB_VERSION=2)
    this.version(2).stores({
      products: 'id, barcode, name, *categoryIds',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber',
      saleItems: '++id, saleId, productId, timestamp',
      dailySummaries: 'id, date',
      settings: 'id',
    });

    // v3 schema adds shifts + indexes sales by shiftId
    this.version(3).stores({
      products: 'id, barcode, name, *categoryIds',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId',
      saleItems: '++id, saleId, productId, timestamp',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
    });

    // v4 schema adds daily EOD closure tracking
    this.version(4).stores({
      products: 'id, barcode, name, *categoryIds',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId',
      saleItems: '++id, saleId, productId, timestamp',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
    });

    // v5 schema adds customer book + expenses
    this.version(5).stores({
      products: 'id, barcode, name, *categoryIds',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod',
      saleItems: '++id, saleId, productId, timestamp',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
    });

    // v6 schema adds multi-store support: storeId on products, sales and saleItems
    this.version(6).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
    });

    // v7 schema adds shiftReports (per-shift reconciliation) and stockInwardLogs (restock ledger)
    this.version(7).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
    });

    // v8 schema adds a local stores table for offline multi-store management
    this.version(8).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
    });

    // v9 schema adds internal sale snapshots for self-healing backups
    this.version(9).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
    });

    // v10 schema adds auditLogs table for immutable audit records
    this.version(10).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt'
    });

    // v11 schema adds online orders tables for Two-in-One system
    this.version(11).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt'
    });

    // v12 schema adds multi-tenant company hierarchy: companies, staff, departments, shift_logs, and company summaries
    this.version(12).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt',
      companies: 'id, name',
      staff: 'id, phone, companyId, storeId, departmentId, email',
      departments: 'id, storeId, name',
      shiftLogs: 'id, companyId, storeId, staffId, staffPhone, clockInAt',
      companySalesSummary: 'id, companyId, dateKey',
      storeInventoryAlerts: 'id, companyId, storeId, productId, acknowledged'
    });

    // v13 schema re-applies the current schema and ensures category storeId is indexed for existing DB upgrades
    this.version(13).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt',
      companies: 'id, name',
      staff: 'id, phone, companyId, storeId, departmentId, email',
      departments: 'id, storeId, name',
      shiftLogs: 'id, companyId, storeId, staffId, staffPhone, clockInAt',
      companySalesSummary: 'id, companyId, dateKey',
      storeInventoryAlerts: 'id, companyId, storeId, productId, acknowledged'
    });

    // v14 schema adds an ownerPhone index to the companies table to support boss login
    this.version(14).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt',
      companies: 'id, name, ownerPhone',
      staff: 'id, phone, companyId, storeId, departmentId, email',
      departments: 'id, storeId, name',
      shiftLogs: 'id, companyId, storeId, staffId, staffPhone, clockInAt',
      companySalesSummary: 'id, companyId, dateKey',
      storeInventoryAlerts: 'id, companyId, storeId, productId, acknowledged'
    });

    // v15 schema adds store/company indexes on expenses for multi-tenant reporting
    this.version(15).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source, storeId, companyId',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt',
      companies: 'id, name, ownerPhone',
      staff: 'id, phone, companyId, storeId, departmentId, email',
      departments: 'id, storeId, name',
      shiftLogs: 'id, companyId, storeId, staffId, staffPhone, clockInAt',
      companySalesSummary: 'id, companyId, dateKey',
      storeInventoryAlerts: 'id, companyId, storeId, productId, acknowledged'
    });
    // v16 schema mirrors v15 to support DBs already upgraded to v16
    this.version(16).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source, storeId, companyId',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt',
      companies: 'id, name, ownerPhone',
      staff: 'id, phone, companyId, storeId, departmentId, email',
      departments: 'id, storeId, name',
      shiftLogs: 'id, companyId, storeId, staffId, staffPhone, clockInAt',
      companySalesSummary: 'id, companyId, dateKey',
      storeInventoryAlerts: 'id, companyId, storeId, productId, acknowledged'
    });

    // v17 schema restores missing companyId index on stores table (regression fix from v15/v16)
    this.version(17).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source, storeId, companyId',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt',
      companies: 'id, name, ownerPhone',
      staff: 'id, phone, companyId, storeId, departmentId, email',
      departments: 'id, storeId, name',
      shiftLogs: 'id, companyId, storeId, staffId, staffPhone, clockInAt',
      companySalesSummary: 'id, companyId, dateKey',
      storeInventoryAlerts: 'id, companyId, storeId, productId, acknowledged'
    });

    // v18 schema adds daily inventory audit tracking
    this.version(18).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source, storeId, companyId',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt',
      companies: 'id, name, ownerPhone',
      staff: 'id, phone, companyId, storeId, departmentId, email',
      departments: 'id, storeId, name',
      shiftLogs: 'id, companyId, storeId, staffId, staffPhone, clockInAt',
      companySalesSummary: 'id, companyId, dateKey',
      dailyInventoryAudits: 'id, companyId, storeId, auditDate, status',
      storeInventoryAlerts: 'id, companyId, storeId, productId, acknowledged'
    });

    // v19 schema adds AI stock reconciliation sessions (super admin only)
    this.version(19).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source, storeId, companyId',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt',
      companies: 'id, name, ownerPhone',
      staff: 'id, phone, companyId, storeId, departmentId, email',
      departments: 'id, storeId, name',
      shiftLogs: 'id, companyId, storeId, staffId, staffPhone, clockInAt',
      companySalesSummary: 'id, companyId, dateKey',
      dailyInventoryAudits: 'id, companyId, storeId, auditDate, status',
      stockReconciliationSessions: 'id, companyId, storeId, reportDate, status',
      storeInventoryAlerts: 'id, companyId, storeId, productId, acknowledged'
    });

    // v20 schema adds device-local serial/USB customer pole display settings
    this.version(20).stores({
      products: 'id, barcode, name, *categoryIds, storeId',
      categories: 'id, storeId, order',
      sales: 'id, createdAt, receiptNumber, shiftId, customerId, paymentMethod, storeId',
      saleItems: '++id, saleId, productId, timestamp, storeId',
      dailySummaries: 'id, date',
      settings: 'id',
      shifts: 'id, status, startedAt, endedAt, cashierName',
      eodClosures: 'id, dateKey, closedAt',
      customers: 'id, nameKey, name, phone',
      customerLedger: 'id, customerId, createdAt, kind, method',
      expenses: 'id, createdAt, category, source, storeId, companyId',
      shiftReports: 'id, shiftId, storeId, createdAt',
      stockInwardLogs: 'id, productId, storeId, receivedAt',
      stores: 'id, name, companyId',
      saleSnapshots: '++id, saleId, createdAt',
      auditLogs: 'id, shiftId, createdAt',
      onlineOrders: 'id, storeId, status, createdAt, orderNumber',
      onlineOrderItems: 'id, onlineOrderId, productId, createdAt',
      companies: 'id, name, ownerPhone',
      staff: 'id, phone, companyId, storeId, departmentId, email',
      departments: 'id, storeId, name',
      shiftLogs: 'id, companyId, storeId, staffId, staffPhone, clockInAt',
      companySalesSummary: 'id, companyId, dateKey',
      dailyInventoryAudits: 'id, companyId, storeId, auditDate, status',
      stockReconciliationSessions: 'id, companyId, storeId, reportDate, status',
      storeInventoryAlerts: 'id, companyId, storeId, productId, acknowledged',
      customerDisplaySettings: 'id, enabled, comPort',
    });
  }
}

export const dexieDb = new MthunziDexieDB();

function hydrateSaleFromSnapshot(raw: unknown): Sale {
  const sale = raw as Partial<Sale>;
  return {
    ...(sale as Sale),
    createdAt: asDate((sale as any)?.createdAt),
    lastSyncedAt:
      (sale as any)?.lastSyncedAt === null || (sale as any)?.lastSyncedAt === undefined
        ? (sale as any)?.lastSyncedAt
        : asDate((sale as any)?.lastSyncedAt),
  };
}

function hydrateSaleItemsFromSnapshot(raw: unknown): Array<Omit<SaleItemRecord, 'id'>> {
  const items = Array.isArray(raw) ? raw : [];
  return items
    .map((it) => it as any)
    .filter((it) => it && typeof it.saleId === 'string' && typeof it.productId === 'string')
    .map((it) => ({
      saleId: String(it.saleId),
      productId: String(it.productId),
      productName: String(it.productName ?? ''),
      qty: Number(it.qty ?? 0),
      priceAtSale: Number(it.priceAtSale ?? 0),
      buyingPriceAtSale: Number(it.buyingPriceAtSale ?? 0),
      timestamp: asDate(it.timestamp),
      storeId: typeof it.storeId === 'string' ? it.storeId : undefined,
    }));
}

async function restoreSalesFromSnapshotPayloads(payloads: SaleSnapshotPayload[]): Promise<number> {
  // Choose the latest snapshot per saleId
  const bySaleId = new Map<string, SaleSnapshotPayload>();
  for (const p of payloads) {
    if (!p?.sale?.id) continue;
    const existing = bySaleId.get(p.sale.id);
    if (!existing) {
      bySaleId.set(p.sale.id, p);
      continue;
    }
    const a = Date.parse(existing.createdAt);
    const b = Date.parse(p.createdAt);
    if (Number.isFinite(b) && (!Number.isFinite(a) || b > a)) bySaleId.set(p.sale.id, p);
  }

  const sales: Sale[] = [];
  const saleItems: Array<Omit<SaleItemRecord, 'id'>> = [];

  for (const p of bySaleId.values()) {
    sales.push(hydrateSaleFromSnapshot(p.sale));
    saleItems.push(...hydrateSaleItemsFromSnapshot(p.saleItems));
  }

  await dexieDb.transaction('rw', dexieDb.sales, dexieDb.saleItems, async () => {
    await dexieDb.sales.clear();
    await dexieDb.saleItems.clear();
    if (sales.length) await dexieDb.sales.bulkPut(sales);
    if (saleItems.length) await dexieDb.saleItems.bulkAdd(saleItems);
  });

  return sales.length;
}

async function trySelfHealFromSnapshots(): Promise<
  | { ok: true; restoredSales: number; source: 'backup-db' }
  | { ok: false; error: string }
> {
  const throttleKey = 'pos:selfHealLastAttemptTs';
  const last = Number(localStorage.getItem(throttleKey) || '0');
  const now = Date.now();
  if (Number.isFinite(last) && now - last < 5 * 60_000) {
    return { ok: false, error: 'Self-heal throttled (recent attempt).' };
  }
  localStorage.setItem(throttleKey, String(now));

  const snapshots = await getBackupSnapshots(2500);
  if (!snapshots.length) return { ok: false, error: 'No self-heal snapshots found.' };

  // Reset main DB and restore sales history.
  try {
    dexieDb.close();
  } catch {
    // ignore
  }

  try {
    await dexieDb.delete();
  } catch (e) {
    console.warn('DB delete failed during self-heal', e);
  }

  await dexieDb.open();
  const restoredSales = await restoreSalesFromSnapshotPayloads(snapshots);
  await initializeSettings();

  return { ok: true, restoredSales, source: 'backup-db' };
}

// Lightweight IndexedDB/Dexie health check used on app startup.
// Verifies that the database can be opened and that a few core tables are readable.
export async function runDatabaseHealthCheck(): Promise<{
  ok: boolean;
  error?: string;
  healed?: boolean;
  restoredSales?: number;
  source?: 'backup-db';
}> {
  try {
    await dexieDb.open();

    // Touch a few tables to ensure basic integrity.
    await Promise.all([
      dexieDb.products.limit(1).toArray(),
      dexieDb.sales.limit(1).toArray(),
      dexieDb.settings.limit(1).toArray(),
    ]);

    return { ok: true };
  } catch (e) {
    console.error('Dexie health check failed', e);

    // Self-heal: try restoring core sales history from the separate backup snapshot DB.
    try {
      const healed = await trySelfHealFromSnapshots();
      if (healed.ok) {
        console.info('Self-heal restored sales:', healed.restoredSales);
        return {
          ok: true,
          healed: true,
          restoredSales: healed.restoredSales,
          source: healed.source,
        };
      } else {
        return {
          ok: false,
          error: `${(e as Error)?.message || 'Unknown IndexedDB error'} (self-heal failed: ${(healed as { ok: false; error: string }).error})`,
        };
      }
    } catch (healError) {
      console.error('Self-heal threw', healError);
    }

    return {
      ok: false,
      error: (e as Error)?.message || 'Unknown IndexedDB error',
    };
  }
}

const STORE_ID_BACKFILL_KEY = 'mthunzi:storeIdBackfillDone';

// One-time helper: attach legacy records (created before multi-store support)
// to the current device store so that existing data belongs to the first store.
export async function backfillLegacyStoreIds(): Promise<void> {
  try {
    if (localStorage.getItem(STORE_ID_BACKFILL_KEY) === '1') return;
  } catch {
    /* ignore */
  }

  const storeId = getDeviceStoreId();

  try {
    await dexieDb.transaction(
      'rw',
      [
        dexieDb.products,
        dexieDb.sales,
        dexieDb.saleItems,
        dexieDb.stockInwardLogs,
        dexieDb.categories,
        dexieDb.expenses,
      ],
      async () => {
        const productsWithoutStore = await dexieDb.products
          .filter((p) => !('storeId' in p) || !p.storeId)
          .toArray();
        for (const p of productsWithoutStore) {
          await dexieDb.products.put({ ...p, storeId });
        }

        const salesWithoutStore = await dexieDb.sales
          .filter((s) => !('storeId' in s) || !s.storeId)
          .toArray();
        for (const s of salesWithoutStore) {
          await dexieDb.sales.put({ ...s, storeId });
        }

        const saleItemsWithoutStore = await dexieDb.saleItems
          .filter((i) => !('storeId' in i) || !i.storeId)
          .toArray();
        for (const i of saleItemsWithoutStore) {
          await dexieDb.saleItems.put({ ...i, storeId });
        }

        const logsWithoutStore = await dexieDb.stockInwardLogs
          .filter((l) => !('storeId' in l) || !l.storeId)
          .toArray();
        for (const l of logsWithoutStore) {
          await dexieDb.stockInwardLogs.put({ ...l, storeId });
        }

        const categoriesWithoutStore = await dexieDb.categories
          .filter((c) => !('storeId' in c) || !c.storeId)
          .toArray();
        for (const c of categoriesWithoutStore) {
          await dexieDb.categories.put({ ...c, storeId });
        }

        const expensesWithoutStore = await dexieDb.expenses
          .filter((e) => !('storeId' in e) || !e.storeId)
          .toArray();
        for (const e of expensesWithoutStore) {
          await dexieDb.expenses.put({ ...e, storeId });
        }
      }
    );
    try {
      localStorage.setItem(STORE_ID_BACKFILL_KEY, '1');
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.error('Failed to backfill legacy storeIds', e);
  }
}

function productAdoptKey(storeId: string) {
  return `mthunzi:productAdopt:${storeId}`;
}

function scheduleProductStoreIdAdopt(storeId: string, products: Product[]): void {
  try {
    if (localStorage.getItem(productAdoptKey(storeId)) === '1') return;
  } catch {
    /* ignore */
  }

  const run = async () => {
    try {
      const toUpdate = products.filter((p) => p.storeId !== storeId);
      if (toUpdate.length === 0) {
        localStorage.setItem(productAdoptKey(storeId), '1');
        return;
      }
      await dexieDb.transaction('rw', dexieDb.products, async () => {
        await dexieDb.products.bulkPut(toUpdate.map((p) => ({ ...p, storeId })));
      });
      localStorage.setItem(productAdoptKey(storeId), '1');
    } catch (e) {
      console.warn('Product storeId adopt skipped:', e);
    }
  };

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(() => void run(), { timeout: 10000 });
  } else {
    window.setTimeout(() => void run(), 2000);
  }
}

export function filterProductsForStore(products: Product[], storeId?: string): Product[] {
  if (!storeId || storeId === '__all__') {
    return products;
  }

  return products.filter((product) => product.storeId === storeId);
}

// Products CRUD
export async function getAllProducts(storeId?: string): Promise<Product[]> {
  if (!storeId || storeId === '__all__') {
    return dexieDb.products.toArray();
  }

  const scoped = await dexieDb.products.where('storeId').equals(storeId).toArray();
  return filterProductsForStore(scoped, storeId);
}

export async function getProductById(id: string): Promise<Product | undefined> {
  return dexieDb.products.get(id);
}

export async function getProductByBarcode(barcode: string, storeId?: string): Promise<Product | undefined> {
  const results = await dexieDb.products.where('barcode').equals(barcode).toArray();
  if (storeId === '__all__') {
    return results[0];
  }

  const targetStoreId = storeId || getDeviceStoreId();
  return filterProductsForStore(results, targetStoreId)[0];
}

export async function addProduct(product: Product): Promise<void> {
  const storeId = product.storeId || getDeviceStoreId();
  
  // Auto-generate DiceBear image if no manual image provided
  let productWithStore: Product = {
    ...product,
    id: String(product.id || crypto.randomUUID()),
    name: String(product.name || '').trim(),
    barcode: String(product.barcode || crypto.randomUUID()),
    storeId: String(storeId),
    categoryIds: (product.categoryIds || []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    ),
    buyingPrice: Number(product.buyingPrice) || 0,
    sellingPrice: Number(product.sellingPrice) || 0,
    stock: Number(product.stock) || 0,
    lowStockThreshold: Number(product.lowStockThreshold) || 5,
    createdAt: product.createdAt instanceof Date ? product.createdAt : new Date(),
    updatedAt: new Date(),
  };
  if (!productWithStore.name) {
    throw new Error('Product name is required');
  }
  if (!productWithStore.imageUrl) {
    const { generateProductImageUrl } = await import('./dicebearImageGenerator');
    const categoryName = productWithStore.categoryIds?.[0] || 'product';
    productWithStore.imageUrl = generateProductImageUrl(productWithStore.name, categoryName);
  }
  
  // Persist locally first so UI is not blocked
  try {
    await dexieDb.products.put(productWithStore);
  } catch (error) {
    if (error instanceof DOMException && /dataerror|quotaexceeded|dataclone/i.test(error.name)) {
      throw new Error(
        `Could not save "${productWithStore.name}" to browser storage (${error.name}). Try fewer products at once or clear site data.`
      );
    }
    throw error;
  }

  // Attempt background sync; on failure, queue for retry
  (async () => {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'product_create', data: productWithStore });
      return;
    }

    try {
      const { syncProductToSupabase, addToSyncQueue } = await import('./sync');
      const ok = await syncProductToSupabase(productWithStore, true);
      if (!ok) {
        addToSyncQueue({ type: 'product_create', data: productWithStore });
      } else {
        // mark lastSyncedAt
        try {
          await dexieDb.products.put({ ...productWithStore, lastSyncedAt: new Date() } as any);
        } catch {}
      }
    } catch (e) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'product_create', data: productWithStore });
    }
  })();
}

export async function updateProduct(product: Product): Promise<void> {
  const storeId = product.storeId || getDeviceStoreId();
  const productWithUpdate = { ...product, storeId, updatedAt: new Date() };
  // Persist locally first
  await dexieDb.products.put(productWithUpdate);

  // Background sync attempt; queue on failure
  (async () => {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'product_update', data: productWithUpdate });
      return;
    }

    try {
      const { syncProductToSupabase, addToSyncQueue } = await import('./sync');
      const ok = await syncProductToSupabase(productWithUpdate, false);
      if (!ok) {
        addToSyncQueue({ type: 'product_update', data: productWithUpdate });
      } else {
        try { await dexieDb.products.put({ ...productWithUpdate, lastSyncedAt: new Date() } as any); } catch {}
      }
    } catch (e) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'product_update', data: productWithUpdate });
    }
  })();
}

export async function deleteProduct(id: string): Promise<void> {
  await dexieDb.products.delete(id);
}

export async function searchProducts(query: string, storeId?: string): Promise<Product[]> {
  const allProducts = storeId && storeId !== '__all__'
    ? filterProductsForStore(await dexieDb.products.where('storeId').equals(storeId).toArray(), storeId)
    : await dexieDb.products.toArray();

  const lowerQuery = query.toLowerCase();
  return allProducts.filter(
    (p) => p.name.toLowerCase().includes(lowerQuery) || p.barcode.includes(query)
  );
}

// Categories CRUD
export async function getAllCategories(storeId?: string): Promise<Category[]> {
  if (storeId && storeId !== '__all__') {
    return dexieDb.categories
      .orderBy('order')
      .filter((c) => !c.storeId || c.storeId === storeId)
      .toArray();
  }
  return dexieDb.categories.orderBy('order').toArray();
}

export async function addCategory(category: Category): Promise<void> {
  // Auto-generate category color based on name if not provided
  let categoryWithTimestamps = {
    ...category,
    createdAt: category.createdAt || new Date(),
    updatedAt: category.updatedAt || new Date(),
  };
  
  if (!categoryWithTimestamps.color) {
    const { getCategoryColor } = await import('./dicebearImageGenerator');
    categoryWithTimestamps.color = getCategoryColor(categoryWithTimestamps.name);
  }
  
  // Persist locally first
  await dexieDb.categories.put(categoryWithTimestamps);

  // Background sync attempt; queue on failure
  (async () => {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'category_create', data: categoryWithTimestamps });
      return;
    }

    try {
      const { syncCategoryToSupabase, addToSyncQueue } = await import('./sync');
      const ok = await syncCategoryToSupabase(categoryWithTimestamps);
      if (!ok) addToSyncQueue({ type: 'category_create', data: categoryWithTimestamps });
    } catch (e) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'category_create', data: categoryWithTimestamps });
    }
  })();
}

export async function updateCategory(category: Category): Promise<void> {
  await dexieDb.categories.put(category);
}

export async function deleteCategory(id: string): Promise<void> {
  await dexieDb.categories.delete(id);
}

// Sales CRUD
export async function getAllSales(storeId?: string): Promise<Sale[]> {
  if (!storeId || storeId === '__all__') {
    return dexieDb.sales.toArray();
  }
  const all = await dexieDb.sales.toArray();
  return all.filter((s) => !s.storeId || s.storeId === storeId);
}

export async function getSaleItemsByDate(date: Date): Promise<SaleItemRecord[]> {
  const all = await dexieDb.saleItems.toArray();
  const targetDate = date.toISOString().slice(0, 10);
  return all.filter((i) => asDate(i.timestamp).toISOString().slice(0, 10) === targetDate);
}

export async function addSale(sale: Sale): Promise<void> {
  const storeId = sale.storeId || getDeviceStoreId();
  const saleWithStore = { ...sale, storeId };
  // Persist locally first
  await dexieDb.sales.put(saleWithStore);

  // Background sync attempt; queue on failure
  (async () => {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'sale', data: saleWithStore });
      return;
    }

    try {
      const { syncSaleToSupabase, addToSyncQueue } = await import('./sync');
      const ok = await syncSaleToSupabase(saleWithStore);
      if (!ok) addToSyncQueue({ type: 'sale', data: saleWithStore });
      else try { await dexieDb.sales.put({ ...saleWithStore, lastSyncedAt: new Date() } as any); } catch {}
    } catch (e) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'sale', data: saleWithStore });
    }
  })();
}

export async function completeSaleAtomic(args: {
  items: SaleDraftItem[];
  discount?: number;
  paymentMethod: Sale['paymentMethod'];
  amountReceived?: number;
  amountPaid?: number;
  balanceDue?: number;
  customerName?: string;
  customerId?: string;
  mobileProvider?: Sale['mobileProvider'];
  mobileReference?: string;
  receiptNumber?: string;
  createdAt?: Date;
}): Promise<Sale> {
  const createdAt = args.createdAt ?? new Date();
  const receiptNumber = args.receiptNumber ?? generateReceiptNumber();
  const saleId = crypto.randomUUID();

  // Group by product+unitPrice to keep pricing accurate, while still decrementing stock per product.
  const lineGroups = new Map<string, { productId: string; unitPrice: number; quantity: number }>();
  const qtyByProductId = new Map<string, number>();
  for (const item of args.items) {
    if (item.quantity <= 0) continue;
    const unitPrice = Number(item.unitPrice);
    const lineKey = `${item.productId}::${unitPrice.toFixed(2)}`;

    const existingLine = lineGroups.get(lineKey);
    if (existingLine) {
      existingLine.quantity += item.quantity;
    } else {
      lineGroups.set(lineKey, { productId: item.productId, unitPrice, quantity: item.quantity });
    }

    qtyByProductId.set(item.productId, (qtyByProductId.get(item.productId) ?? 0) + item.quantity);
  }

  if (lineGroups.size === 0) {
    throw new Error('Cart is empty');
  }

  const settings = await dexieDb.settings.get('main');

  const result = await dexieDb.transaction(
    'rw',
    dexieDb.products,
    dexieDb.sales,
    dexieDb.saleItems,
    dexieDb.shifts,
    async () => {
      const activeShift = await dexieDb.shifts.where('status').equals('open').first();
      // Hard-audit: prevent creating sales while the active shift is locked for audit
      if (activeShift && (activeShift as any).auditLocked) {
        throw new Error('Shift is locked for audit/reconciliation. Cannot create new sales.');
      }
      const storeId = getDeviceStoreId();
      const cashierId = activeShift?.cashierName
        ? getOrCreateCashierId(activeShift.cashierName)
        : undefined;

    const saleItems: SaleItem[] = [];
    let subtotal = 0;
    let profitBeforeDiscount = 0;

    // Pre-load all products for this transaction.
    const productsById = new Map<string, Product>();
    for (const productId of qtyByProductId.keys()) {
      const product = await dexieDb.products.get(productId);
      if (!product) {
        throw new Error(`Product not found (${productId})`);
      }
      productsById.set(productId, product);
    }

    // Decrement stock once per product (sum of quantities), and record sale lines per unit price.
    for (const [productId, totalQuantity] of qtyByProductId.entries()) {
      const product = productsById.get(productId);
      if (!product) {
        throw new Error(`Product not found (${productId})`);
      }
      const sellUnit = product.sellUnit ?? 'individual';
      const stockUnit = product.stockUnit ?? 'individual';
      const unitsPerBulk = Math.max(1, product.unitsPerBulk ?? 1);

      let stockDecrement = totalQuantity;
      if (sellUnit === 'bulk' && stockUnit === 'individual') {
        stockDecrement = totalQuantity * unitsPerBulk;
      } else if (sellUnit === 'individual' && stockUnit === 'bulk' && unitsPerBulk > 1) {
        throw new Error(
          `Cannot sell individual units for ${product.name}. Configure stockUnit='individual' for this item.`
        );
      }

      if (product.stock < stockDecrement) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      let buyingPriceAtSale = product.buyingPrice;
      if ((product.unitsPerBulk ?? 1) > 1 && (product.stockUnit ?? 'individual') === 'individual') {
        buyingPriceAtSale = product.buyingPrice / Math.max(1, product.unitsPerBulk ?? 1);
      }
      const linesForProduct = Array.from(lineGroups.values()).filter((l) => l.productId === productId);
      for (const line of linesForProduct) {
        const lineTotal = line.unitPrice * line.quantity;

        saleItems.push({
          productId,
          productName: product.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          buyingPrice: buyingPriceAtSale,
          total: lineTotal,
        });

        await dexieDb.saleItems.add({
          saleId,
          productId,
          productName: product.name,
          qty: line.quantity,
          priceAtSale: line.unitPrice,
          buyingPriceAtSale,
          timestamp: createdAt,
          // Multi-store: duplicate storeId here for fast per-store analytics
          // (older records without storeId will still be readable).
          storeId,
        });

        subtotal += lineTotal;
        profitBeforeDiscount += (line.unitPrice - buyingPriceAtSale) * line.quantity;
      }

      await dexieDb.products.put({
        ...product,
        stock: product.stock - stockDecrement,
        updatedAt: new Date(),
      });
    }

    const discount = Math.max(0, Math.min(args.discount ?? 0, subtotal));
    const baseTotal = subtotal - discount;

    const salesTax = computeSalesTax({ settings, subtotal, discount });
    const salesTaxAmount = Math.max(0, salesTax.taxAmount);
    const total = Math.max(0, baseTotal + salesTaxAmount);
    const profit = profitBeforeDiscount - discount;

    const amountReceivedRaw = args.amountReceived;
    const amountReceived =
      typeof amountReceivedRaw === 'number' && Number.isFinite(amountReceivedRaw)
        ? amountReceivedRaw
        : args.paymentMethod === 'credit'
          ? 0
          : total;

    const amountPaid =
      typeof args.amountPaid === 'number' && Number.isFinite(args.amountPaid)
        ? Math.max(0, args.amountPaid)
        : args.paymentMethod === 'cash'
          ? Math.min(total, Math.max(0, amountReceived))
          : Math.max(0, amountReceived);

    const balanceDue =
      typeof args.balanceDue === 'number' && Number.isFinite(args.balanceDue)
        ? Math.max(0, args.balanceDue)
        : Math.max(0, total - amountPaid);

    if (balanceDue <= 0 && amountPaid + 1e-9 < total) {
      throw new Error('Amount received is less than total');
    }

    const changeGiven = args.paymentMethod === 'cash' && balanceDue <= 0 ? Math.max(0, amountReceived - total) : 0;

    let customerId = args.customerId;
    let customerName = args.customerName?.trim() || undefined;
    if (balanceDue > 0) {
      if (!customerId && !customerName) {
        throw new Error('Customer name is required for Pay Later / outstanding balance');
      }

      if (!customerId && customerName) {
        const nameKey = customerName.toLowerCase().trim();
        const existing = await dexieDb.customers.where('nameKey').equals(nameKey).first();
        if (existing) {
          customerId = existing.id;
          customerName = existing.name;
        } else {
          const now = new Date();
          const created: Customer = {
            id: crypto.randomUUID(),
            name: customerName,
            nameKey,
            createdAt: now,
            updatedAt: now,
          };
          await dexieDb.customers.put(created);
          customerId = created.id;
        }
      }
    }

    const sale = {
      id: saleId,
      items: saleItems,
      subtotal,
      discount,
      total,
      salesTaxMode: salesTax.mode,
      salesTaxRate: salesTax.rate,
      salesTaxAmount,
      profit,
      storeId,
      paymentMethod: args.paymentMethod,
      shiftId: activeShift?.id,
      cashierName: activeShift?.cashierName,
      cashierId: activeShift?.cashierId ?? cashierId,
      amountPaid,
      amountReceived,
      changeGiven,
      balanceDue,
      customerId,
      customerName,
      mobileProvider: args.paymentMethod === 'mobile' ? args.mobileProvider : undefined,
      mobileReference: args.paymentMethod === 'mobile' ? args.mobileReference?.trim() || undefined : undefined,
      createdAt,
      lastSyncedAt: createdAt,
      receiptNumber,
    } as Sale;

    await dexieDb.sales.put(sale);

    return { sale, balanceDue, customerId };
    }
  );

  const { sale, balanceDue, customerId } = result;

  if (balanceDue > 0 && customerId) {
    const entry: CustomerLedgerEntry = {
      id: crypto.randomUUID(),
      customerId,
      kind: 'debt',
      amount: balanceDue,
      relatedSaleId: sale.id,
      note: `Sale ${sale.receiptNumber}`,
      createdAt: sale.createdAt,
    };
    await dexieDb.customerLedger.put(entry);
  }

  // Internal self-healing snapshot (hidden table inside the main DB).
  // Best-effort: this table may be missing in older DB installs or during failed upgrades.
  try {
    const snapshotItems = sale.items.map((it) => ({
      saleId: sale.id,
      productId: it.productId,
      productName: it.productName,
      qty: it.quantity,
      priceAtSale: it.unitPrice,
      buyingPriceAtSale: it.buyingPrice,
      timestamp: sale.createdAt,
      storeId: sale.storeId,
    }));
    await dexieDb.saleSnapshots.add({
      saleId: sale.id,
      createdAt: sale.createdAt,
      payloadJson: JSON.stringify({ sale, saleItems: snapshotItems, createdAt: sale.createdAt.toISOString() }),
    });
  } catch (e) {
    console.warn('Internal sale snapshot failed:', e);
  }

  // External self-healing snapshot (separate DB). Best-effort.
  try {
    const snapshotItems = sale.items.map((it) => ({
      saleId: sale.id,
      productId: it.productId,
      productName: it.productName,
      qty: it.quantity,
      priceAtSale: it.unitPrice,
      buyingPriceAtSale: it.buyingPrice,
      timestamp: sale.createdAt,
      storeId: sale.storeId,
    }));
    await backupSaleSnapshot({
      sale,
      saleItems: snapshotItems,
      createdAt: sale.createdAt.toISOString(),
    });
  } catch (e) {
    console.warn('Backup snapshot failed:', e);
  }

  return sale;
}

// Customers (Customer Book)
export async function addCustomer(args: { name: string; phone?: string }): Promise<Customer> {
  const name = String(args.name ?? '').trim();
  if (!name) throw new Error('Customer name is required');
  const nameKey = name.toLowerCase().trim();

  const existing = await dexieDb.customers.where('nameKey').equals(nameKey).first();
  if (existing) return existing;

  const now = new Date();
  const customer: Customer = {
    id: crypto.randomUUID(),
    name,
    nameKey,
    phone: args.phone?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  // Persist locally first
  await dexieDb.customers.put(customer);

  // Background sync attempt; queue on failure
  (async () => {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'customer_create', data: customer });
      return;
    }

    try {
      const { syncCustomerToSupabase, addToSyncQueue } = await import('./sync');
      const ok = await syncCustomerToSupabase(customer);
      if (!ok) addToSyncQueue({ type: 'customer_create', data: customer });
      else try { await dexieDb.customers.put({ ...customer, lastSyncedAt: new Date() } as any); } catch {}
    } catch (e) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'customer_create', data: customer });
    }
  })();

  return customer;
}

export async function recordCustomerPayment(args: {
  customerId: string;
  amount: number;
  method: 'cash' | 'mobile';
  mobileProvider?: Sale['mobileProvider'];
  mobileReference?: string;
  note?: string;
  createdAt?: Date;
}): Promise<CustomerLedgerEntry> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than 0');
  const createdAt = args.createdAt ?? new Date();

  const entry: CustomerLedgerEntry = {
    id: crypto.randomUUID(),
    customerId: args.customerId,
    kind: 'payment',
    amount,
    method: args.method,
    mobileProvider: args.method === 'mobile' ? args.mobileProvider : undefined,
    mobileReference: args.method === 'mobile' ? args.mobileReference?.trim() || undefined : undefined,
    note: args.note?.trim() || undefined,
    createdAt,
  };

  // Persist locally first
  await dexieDb.customerLedger.put(entry);

  // Background sync attempt; queue on failure
  (async () => {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'customer_payment', data: entry });
      return;
    }

    try {
      const { syncCustomerPaymentToSupabase, addToSyncQueue } = await import('./sync');
      const ok = await syncCustomerPaymentToSupabase(entry);
      if (!ok) addToSyncQueue({ type: 'customer_payment', data: entry });
    } catch (e) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'customer_payment', data: entry });
    }
  })();

  return entry;
}

export async function getCustomerBalance(customerId: string): Promise<number> {
  const [sales, ledger] = await Promise.all([
    dexieDb.sales.where('customerId').equals(customerId).toArray(),
    dexieDb.customerLedger.where('customerId').equals(customerId).toArray(),
  ]);
  const debt = sales.reduce((sum, s) => sum + (s.balanceDue ?? 0), 0);
  const paid = ledger
    .filter((l) => l.kind === 'payment')
    .reduce((sum, l) => sum + (l.amount ?? 0), 0);
  return Math.max(0, debt - paid);
}

// Expenses
export async function addExpense(args: {
  amount: number;
  category: string;
  note?: string;
  source: Expense['source'];
  mobileReference?: string;
  storeId?: string;
  companyId?: string;
  createdAt?: Date;
}): Promise<Expense> {
  const amount = Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Expense amount must be greater than zero');
  const category = String(args.category ?? '').trim();
  if (!category) throw new Error('Expense category is required');

  const expense: Expense = {
    id: crypto.randomUUID(),
    amount,
    category,
    note: args.note?.trim() || undefined,
    source: args.source,
    mobileReference: args.mobileReference?.trim() || undefined,
    storeId: args.storeId || getDeviceStoreId(),
    companyId: args.companyId,
    createdAt: args.createdAt ?? new Date(),
  };

  // Persist locally first
  await dexieDb.expenses.put(expense);

  // Background sync attempt; queue on failure
  (async () => {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'expense', data: expense });
      return;
    }

    try {
      const { syncExpenseToSupabase, addToSyncQueue } = await import('./sync');
      const ok = await syncExpenseToSupabase(expense);
      if (!ok) addToSyncQueue({ type: 'expense', data: expense });
      else try { await dexieDb.expenses.put({ ...expense, lastSyncedAt: new Date() } as any); } catch {}
    } catch (e) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'expense', data: expense });
    }
  })();

  return expense;
}

export async function deleteExpense(id: string): Promise<void> {
  await dexieDb.expenses.delete(id);
}

// Shifts
export async function getActiveShift(): Promise<Shift | undefined> {
  return dexieDb.shifts.where('status').equals('open').first();
}

export async function startShift(args: {
  cashierName: string;
  openingCash?: number;
  staffId?: string;
  staffPhone?: string;
  companyId?: string;
  storeId?: string;
  role?: 'owner' | 'manager' | 'salesperson' | 'cashier' | 'delivery' | 'other' | 'staff';
}): Promise<Shift> {
  const cashierName = String(args.cashierName ?? '').trim();
  if (!cashierName) throw new Error('Cashier name is required');

  const cashierId = getOrCreateCashierId(cashierName);
  const storeId = args.storeId || getDeviceStoreId();

  const existing = await getActiveShift();
  if (existing) throw new Error(`A shift is already open (${existing.cashierName})`);

  const now = new Date();
  const shift: Shift = {
    id: crypto.randomUUID(),
    status: 'open',
    cashierName,
    cashierId,
    staffId: args.staffId,
    staffPhone: args.staffPhone,
    companyId: args.companyId,
    storeId: storeId,
    role: args.role,
    openingCash:
      typeof args.openingCash === 'number' && Number.isFinite(args.openingCash)
        ? args.openingCash
        : undefined,
    startedAt: now,
    endedAt: undefined,
    createdAt: now,
    updatedAt: now,
  };

  // Persist locally first
  await dexieDb.shifts.put(shift);

  // Background sync attempt; queue on failure
  (async () => {
    if (!navigator.onLine || !isSupabaseConfigured()) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'shift_create', data: shift });
      return;
    }

    try {
      const { syncShiftToSupabase, addToSyncQueue } = await import('./sync');
      const ok = await syncShiftToSupabase(shift);
      if (!ok) addToSyncQueue({ type: 'shift_create', data: shift });
      else try { await dexieDb.shifts.put({ ...shift, lastSyncedAt: new Date() } as any); } catch {}
    } catch (e) {
      const { addToSyncQueue } = await import('./sync');
      addToSyncQueue({ type: 'shift_create', data: shift });
    }
  })();

  return shift;
}

export async function endShift(args: { shiftId: string; closingCash?: number }): Promise<Shift> {
  const shift = await dexieDb.shifts.get(args.shiftId);
  if (!shift) throw new Error('Shift not found');
  if (shift.status !== 'open') return shift;

  const now = new Date();
  const updated: Shift = {
    ...shift,
    status: 'closed',
    endedAt: now,
    closingCash:
      typeof args.closingCash === 'number' && Number.isFinite(args.closingCash)
        ? args.closingCash
        : shift.closingCash,
    updatedAt: now,
  };
  await dexieDb.shifts.put(updated);
  return updated;
}

// Lock a shift for audit/reconciliation. While locked, sales cannot be created.
export async function lockShiftForAudit(shiftId: string): Promise<void> {
  const shift = await dexieDb.shifts.get(shiftId);
  if (!shift) throw new Error('Shift not found');
  await dexieDb.shifts.put({ ...shift, auditLocked: true, updatedAt: new Date() });
}

// Clear the audit lock (manager-only). Requires correct admin PIN from settings.
export async function clearShiftAuditLock(shiftId: string, adminPin: string): Promise<void> {
  const settings = await dexieDb.settings.get('main');
  if (!settings) throw new Error('Settings missing');
  if (!settings.adminPin || settings.adminPin !== adminPin) throw new Error('Invalid manager PIN');
  const shift = await dexieDb.shifts.get(shiftId);
  if (!shift) throw new Error('Shift not found');
  await dexieDb.shifts.put({ ...shift, auditLocked: false, alertStatus: 'none', updatedAt: new Date() });
}

// Build a simple reconciliation snapshot for a shift: expected cash from sales vs physical cash.
export async function createShiftReconciliationReport(args: {
  shiftId: string;
  actualCash: number;
}): Promise<ShiftReport> {
  const shift = await dexieDb.shifts.get(args.shiftId);
  if (!shift) throw new Error('Shift not found');

  const sales = await dexieDb.sales.where('shiftId').equals(shift.id).toArray();

  const paidNowForSale = (s: Sale) => {
    if (typeof s.amountPaid === 'number' && Number.isFinite(s.amountPaid)) return Math.max(0, s.amountPaid);
    if (s.paymentMethod === 'credit') return 0;
    if (s.paymentMethod === 'cash') {
      const received = typeof s.amountReceived === 'number' ? s.amountReceived : s.total;
      return Math.max(0, Math.min(s.total, received));
    }
    return Math.max(0, s.total ?? 0);
  };

  // Sum of cash sales for the shift
  const cashSales = sales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + paidNowForSale(s), 0);

  // Opening float (openingCash) on the shift
  const openingFloat = typeof shift.openingCash === 'number' && Number.isFinite(shift.openingCash) ? shift.openingCash : 0;

  // Cash expenses during the shift timeframe
  const shiftStart = shift.startedAt ? new Date(shift.startedAt) : new Date(0);
  const shiftEnd = shift.endedAt ? new Date(shift.endedAt) : new Date();
  const allExpenses = await dexieDb.expenses.where('createdAt').between(shiftStart, shiftEnd, true, true).toArray();
  const cashExpenses = allExpenses.filter((e) => e.source === 'cash').reduce((sum, e) => sum + (e.amount ?? 0), 0);

  // Expected cash according to the audit formula: (Total Cash Sales + Opening Float) - Cash Expenses
  const expectedCash = cashSales + openingFloat - cashExpenses;

  const actualAmount = Number((args.actualCash ?? 0).toFixed(2));
  const expectedAmount = Number(expectedCash.toFixed(2));
  const difference = Number((actualAmount - expectedAmount).toFixed(2));

  const alertStatus: 'none' | 'theft' = difference < -0.0001 ? 'theft' : 'none';
  let status: ShiftReport['status'] = 'balanced';
  if (difference > 0.0001) status = 'overage';
  else if (difference < -0.0001) status = 'shortage';

  const storeId = getDeviceStoreId();
  const report: ShiftReport = {
    id: crypto.randomUUID(),
    shiftId: shift.id,
    storeId,
    cashierName: shift.cashierName,
    expectedAmount,
    actualAmount,
    difference,
    status,
    userId: null,
    // lock report to prevent staff edits once submitted
    locked: true,
    createdAt: new Date(),
  };

  await dexieDb.shiftReports.put(report);

  // Mark the shift as audit-locked and flag theft if shortage detected
  try {
    const updatedShift = {
      ...shift,
      auditLocked: true,
      alertStatus,
      updatedAt: new Date(),
    };
    await dexieDb.shifts.put(updatedShift);
  } catch (e) {
    console.warn('Failed to update shift audit lock/alert status', e);
  }

  // Save an AuditLog record (immutable) for future audits
  try {
    await dexieDb.auditLogs.put({
      id: crypto.randomUUID(),
      shiftId: shift.id,
      shiftReportId: report.id,
      staffName: shift.cashierName,
      expectedCash: expectedAmount,
      actualCash: actualAmount,
      variance: difference,
      createdAt: new Date(),
    });
  } catch (e) {
    console.warn('Failed to write audit log', e);
  }

  // If shortage, attempt to print a shortage slip (best-effort)
  if (difference < -0.0001) {
    try {
      // Try to fetch settings for receipt header/width
      const settings = (await dexieDb.settings.get('main')) as any;
      const shortageAmount = Math.abs(difference);
      const slip = buildEscPosShortageSlip({ staffName: shift.cashierName, shortageAmount, settings });
      // Fire-and-forget print; errors shouldn't block reconciliation
      bluetoothPrinterService.printBytes(slip).catch((err) => {
        console.warn('Shortage slip print failed', err);
      });
    } catch (e) {
      console.warn('Build/print shortage slip failed', e);
    }
  }

  return report;
}

// Update the free-form reconciliation note on a stored ShiftReport.
export async function updateShiftReportNote(id: string, note: string): Promise<void> {
  const existing = await dexieDb.shiftReports.get(id);
  if (!existing) throw new Error('Shift report not found');
  if (existing.locked) throw new Error('Cannot edit reconciliation once submitted');
  await dexieDb.shiftReports.update(id, { note });
}

// Save audit log entry (immutable). No update/delete helpers provided intentionally.
export async function saveAuditLogEntry(args: {
  shiftId: string;
  shiftReportId?: string;
  staffName: string;
  expectedCash: number;
  actualCash: number;
  variance: number;
}): Promise<void> {
  const rec = {
    id: crypto.randomUUID(),
    shiftId: args.shiftId,
    shiftReportId: args.shiftReportId,
    staffName: args.staffName,
    expectedCash: Number(args.expectedCash.toFixed(2)),
    actualCash: Number(args.actualCash.toFixed(2)),
    variance: Number(args.variance.toFixed(2)),
    createdAt: new Date(),
  };
  await dexieDb.auditLogs.put(rec);
}

// Delete a shift report and any audit log entries that reference it.
// Returns the deleted report and the deleted audit log records so callers
// can optionally restore them (Undo) or keep a snapshot for external backup.
export async function deleteShiftReportAndRelatedAuditLogs(shiftReportId: string): Promise<{
  report?: ShiftReport | null;
  auditLogs: AuditLog[];
}> {
  const report = await dexieDb.shiftReports.get(shiftReportId);
  // `shiftReportId` is not indexed in the auditLogs schema; use filter to avoid SchemaError
  const allLogs = await dexieDb.auditLogs.toArray();
  const logs = allLogs.filter((l) => l.shiftReportId === shiftReportId);

  await dexieDb.transaction('rw', dexieDb.shiftReports, dexieDb.auditLogs, async () => {
    await dexieDb.shiftReports.delete(shiftReportId);
    for (const l of logs) {
      try {
        await dexieDb.auditLogs.delete(l.id);
      } catch (e) {
        // best-effort; continue
      }
    }
  });

  return { report: report ?? null, auditLogs: logs };
}

// Restore a previously deleted shift report and its audit logs. Used by Undo.
export async function restoreShiftReportAndAuditLogs(
  report: ShiftReport,
  logs: AuditLog[]
): Promise<void> {
  await dexieDb.transaction('rw', dexieDb.shiftReports, dexieDb.auditLogs, async () => {
    await dexieDb.shiftReports.put(report);
    for (const l of logs) {
      // reinstate the audit log (best-effort)
      try {
        await dexieDb.auditLogs.put(l as any);
      } catch (e) {
        // ignore individual failures
      }
    }
  });
}

// Record a stock inward batch and increment product stock.
export async function recordStockInward(args: {
  productId: string;
  quantityAdded: number;
  unitCost: number;
  receivedAt?: Date;
  addedBy?: string;
}): Promise<StockInwardLog> {
  const quantity = Number(args.quantityAdded ?? 0);
  const unitCost = Number(args.unitCost ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity added must be greater than zero');
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error('Unit cost must be zero or positive');
  }

  return dexieDb.transaction('rw', dexieDb.products, dexieDb.stockInwardLogs, async () => {
    const product = await dexieDb.products.get(args.productId);
    if (!product) throw new Error('Product not found');

    const storeId = product.storeId || getDeviceStoreId();
    const receivedAt = args.receivedAt ?? new Date();
    const totalCost = quantity * unitCost;

    // Increment stock on the product.
    const updatedProduct: Product = {
      ...product,
      stock: (product.stock ?? 0) + quantity,
      updatedAt: new Date(),
    };
    await dexieDb.products.put(updatedProduct);

    const log: StockInwardLog = {
      id: crypto.randomUUID(),
      productId: product.id,
      productName: product.name,
      quantityAdded: quantity,
      unitCost,
      totalCost,
      receivedAt,
      addedBy: args.addedBy,
      storeId,
      createdAt: new Date(),
    };

    await dexieDb.stockInwardLogs.put(log);
    return log;
  });
}

export async function getSalesByDate(date: Date, storeId?: string): Promise<Sale[]> {
  const targetStoreId = storeId && storeId !== '__all__' ? storeId : undefined;
  const allSales = await dexieDb.sales.toArray();
  const targetDate = date.toISOString().slice(0, 10);
  return allSales.filter((s) =>
    asDate(s.createdAt).toISOString().slice(0, 10) === targetDate &&
    (targetStoreId ? !s.storeId || s.storeId === targetStoreId : true)
  );
}

export async function getTodaysSales(storeId?: string): Promise<Sale[]> {
  return getSalesByDate(new Date(), storeId);
}

// Daily Summaries
function localDayBounds(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map((v) => parseInt(v, 10));
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return { start, end };
}

export async function buildDailySummaryForDate(dateKey: string): Promise<DailySummary> {
  const { start, end } = localDayBounds(dateKey);

  // Read all raw data for the day.
  const [sales, saleItems, products, expenses, customerLedger] = await Promise.all([
    dexieDb.sales.where('createdAt').between(start, end, true, true).toArray(),
    dexieDb.saleItems.where('timestamp').between(start, end, true, true).toArray(),
    dexieDb.products.toArray(),
    dexieDb.expenses.where('createdAt').between(start, end, true, true).toArray(),
    dexieDb.customerLedger.where('createdAt').between(start, end, true, true).toArray(),
  ]);

  const totalRevenue = sales.reduce((sum, s) => sum + (s.total ?? 0), 0);
  // Profit is best taken from stored sale snapshots (already accounts for discounts).
  const totalProfit = sales.reduce((sum, s) => sum + (s.profit ?? 0), 0);
  const transactionCount = sales.length;

  const paidNowForSale = (s: Sale) => {
    if (typeof s.amountPaid === 'number' && Number.isFinite(s.amountPaid)) return Math.max(0, s.amountPaid);
    if (s.paymentMethod === 'credit') return 0;
    if (s.paymentMethod === 'cash') {
      const received = typeof s.amountReceived === 'number' ? s.amountReceived : s.total;
      return Math.max(0, Math.min(s.total, received));
    }
    return Math.max(0, s.total ?? 0);
  };

  const cashIn = sales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + paidNowForSale(s), 0);
  const cardIn = sales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + paidNowForSale(s), 0);
  const transferIn = sales.filter((s) => s.paymentMethod === 'transfer').reduce((sum, s) => sum + paidNowForSale(s), 0);
  const mobileInByProvider: Partial<Record<'mtn' | 'airtel' | 'zamtel' | 'other', number>> = {};
  let mobileInTotal = 0;
  for (const s of sales) {
    if (s.paymentMethod !== 'mobile') continue;
    const amt = paidNowForSale(s);
    mobileInTotal += amt;
    const key = (s.mobileProvider ?? 'other') as 'mtn' | 'airtel' | 'zamtel' | 'other';
    mobileInByProvider[key] = (mobileInByProvider[key] ?? 0) + amt;
  }

  const creditIssued = sales.reduce((sum, s) => sum + (s.balanceDue ?? 0), 0);
  const creditPayments = customerLedger
    .filter((l) => l.kind === 'payment')
    .reduce((sum, l) => sum + (l.amount ?? 0), 0);

  const expensesCash = expenses.filter((e) => e.source === 'cash').reduce((sum, e) => sum + (e.amount ?? 0), 0);
  const expensesMobileBySource: Partial<Record<'mtn' | 'airtel' | 'zamtel' | 'other', number>> = {};
  let expensesMobileTotal = 0;
  for (const e of expenses) {
    if (e.source === 'cash') continue;
    const amt = e.amount ?? 0;
    expensesMobileTotal += amt;
    const key = (e.source ?? 'other') as 'mtn' | 'airtel' | 'zamtel' | 'other';
    expensesMobileBySource[key] = (expensesMobileBySource[key] ?? 0) + amt;
  }
  const expensesTotal = expenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  const netProfitAfterExpenses = totalProfit - expensesTotal;

  // Top sellers from saleItems (more accurate than relying on sale.items shape changes).
  const byProduct = new Map<string, { productId: string; productName: string; quantitySold: number; revenue: number }>();
  for (const i of saleItems) {
    const existing = byProduct.get(i.productId);
    const revenue = (i.qty ?? 0) * (i.priceAtSale ?? 0);
    if (existing) {
      existing.quantitySold += i.qty ?? 0;
      existing.revenue += revenue;
    } else {
      byProduct.set(i.productId, {
        productId: i.productId,
        productName: i.productName,
        quantitySold: i.qty ?? 0,
        revenue,
      });
    }
  }

  const topSellers = Array.from(byProduct.values())
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, 10)
    .map((s) => ({
      productId: s.productId,
      productName: s.productName,
      quantitySold: s.quantitySold,
      revenue: s.revenue,
    }));

  const lowStockItems = products
    .filter((p) => (p.stock ?? 0) <= (p.lowStockThreshold ?? 0))
    .map((p) => ({
      productId: p.id,
      productName: p.name,
      currentStock: p.stock,
      threshold: p.lowStockThreshold,
    }))
    .slice(0, 20);

  return {
    id: `eod-${dateKey}`,
    date: dateKey,
    totalRevenue,
    totalProfit,
    cashIn,
    cardIn,
    transferIn,
    mobileInTotal,
    mobileInByProvider,
    creditIssued,
    creditPayments,
    expensesTotal,
    expensesCash,
    expensesMobileTotal,
    expensesMobileBySource,
    netProfitAfterExpenses,
    transactionCount,
    topSellers,
    lowStockItems,
    createdAt: new Date(),
  };
}

export async function upsertDailySummaryForDate(dateKey: string): Promise<DailySummary> {
  const summary = await buildDailySummaryForDate(dateKey);
  await dexieDb.dailySummaries.put(summary);
  return summary;
}

export async function getDailySummary(date: string): Promise<DailySummary | undefined> {
  return dexieDb.dailySummaries.where('date').equals(date).first();
}

export async function saveDailySummary(summary: DailySummary): Promise<void> {
  await dexieDb.dailySummaries.put(summary);
}

const SETTINGS_STORAGE_KEY = 'mtz:settings:main';

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { name?: string; message?: string };
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'DatabaseClosedError' ||
    typeof err.message === 'string' && /quota|full disk|backing store/i.test(err.message)
  );
}

function saveSettingsToLocalStorage(settings: Settings): void {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...settings, id: 'main', updatedAt: new Date() }));
  } catch {
    // ignore localStorage failures
  }
}

function loadSettingsFromLocalStorage(): Settings | undefined {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return undefined;
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as Settings;
  } catch {
    return undefined;
  }
}

// Settings
export async function getSettings(): Promise<Settings | undefined> {
  try {
    return await dexieDb.settings.get('main');
  } catch (error) {
    if (isQuotaError(error)) {
      console.warn('IndexedDB getSettings failed, falling back to localStorage:', error);
      return loadSettingsFromLocalStorage();
    }
    throw error;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await dexieDb.settings.put({ ...settings, id: 'main', updatedAt: new Date() });
  } catch (error) {
    if (isQuotaError(error)) {
      console.warn('IndexedDB saveSettings failed, falling back to localStorage:', error);
      saveSettingsToLocalStorage(settings);
      return;
    }
    throw error;
  }
}

export function defaultCustomerDisplaySettings(): CustomerDisplaySettings {
  return {
    id: 'main',
    enabled: false,
    connectionType: 'usb_virtual_com',
    comPort: '',
    portVendorId: null,
    portProductId: null,
    baudRate: 9600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    encoding: 'ascii',
    autoReconnect: true,
    brightness: 80,
    lineWidth: 20,
    shopName: 'MTHUNZI POS',
    testMessage: 'Customer Display\nWorking Successfully',
    lastConnected: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getCustomerDisplaySettings(): Promise<CustomerDisplaySettings> {
  const existing = await dexieDb.customerDisplaySettings.get('main');
  if (!existing) return defaultCustomerDisplaySettings();
  return {
    ...defaultCustomerDisplaySettings(),
    ...existing,
    lastConnected: existing.lastConnected ? asDate(existing.lastConnected) : null,
    createdAt: asDate(existing.createdAt),
    updatedAt: asDate(existing.updatedAt),
  };
}

export async function saveCustomerDisplaySettings(
  patch: Partial<CustomerDisplaySettings>
): Promise<CustomerDisplaySettings> {
  const current = await getCustomerDisplaySettings();
  const next: CustomerDisplaySettings = {
    ...current,
    ...patch,
    id: 'main',
    updatedAt: new Date(),
    createdAt: current.createdAt || new Date(),
  };
  await dexieDb.customerDisplaySettings.put(next);
  return next;
}

export async function initializeSettings(): Promise<Settings> {
  const existing = await getSettings();
  const defaultSettings: Settings = {
    companyId: '',
    id: 'main',
    shopName: 'Mthunzi Store',
    shopAddress: '',
    shopPhone: '',
    currency: 'ZMW',
    currencySymbol: 'K',
    baseCurrency: 'ZMW',
    plan: 'free',
    userRole: 'staff',
    assignedStoreId: null,
    taxRate: 0,
    salesTaxMode: 'none',
    salesTaxRate: 0,
    singleItemMarginPercent: 0,
    receiptFooter: 'Thank you for shopping with us!',
    thermalPrinterWidth: '80mm',
    adminPin: null,
    pinSetupComplete: false,
    eodAutoPromptEnabled: true,
    eodClosingTime: '18:00',
    auditSyncEnabled: false,
    auditOpeningTime: '08:00',
    auditClosingTime: '18:00',
    // Commercial licensing: hard-lock by default for new installs.
    activationLockEnabled: true,
    isActivated: false,
    activationKey: '',
    autoWhatsAppEnabled: false,
    autoWhatsAppNumber: '',
    autoWhatsAppMethod: 'web',
    autoWhatsAppWebhookUrl: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  if (existing) {
    const normalized: Settings = {
      ...defaultSettings,
      ...existing,
      id: 'main',
      createdAt: existing.createdAt ?? defaultSettings.createdAt,
      updatedAt: existing.updatedAt ?? defaultSettings.updatedAt,
    };

    // If a mode is configured but the rate is missing, use the official defaults.
    const mode = getSalesTaxMode(normalized);
    const rate = Number((normalized as any).salesTaxRate);
    if (mode !== 'none' && (!Number.isFinite(rate) || rate <= 0)) {
      normalized.salesTaxRate = getDefaultSalesTaxRate(mode);
    }

    const needsWriteback =
      typeof existing.eodAutoPromptEnabled !== 'boolean' ||
      typeof existing.eodClosingTime !== 'string' ||
      typeof existing.auditSyncEnabled !== 'boolean' ||
      typeof existing.auditOpeningTime !== 'string' ||
      typeof existing.auditClosingTime !== 'string' ||
      !existing.baseCurrency ||
      !existing.plan ||
      !existing.userRole ||
      typeof (existing as any).salesTaxMode !== 'string' ||
      typeof (existing as any).salesTaxRate !== 'number' ||
      typeof existing.activationLockEnabled !== 'boolean' ||
      typeof existing.isActivated !== 'boolean' ||
      typeof (existing as any).activationKey !== 'string' ||
      typeof existing.autoWhatsAppEnabled !== 'boolean' ||
      typeof existing.autoWhatsAppMethod !== 'string';

    if (needsWriteback) {
      await saveSettings({ ...normalized, updatedAt: new Date() });
    }

    return normalized;
  }

  await saveSettings(defaultSettings);
  return defaultSettings;
}

// EOD Closures
export async function getEodClosure(dateKey: string): Promise<EodClosure | undefined> {
  return dexieDb.eodClosures.get(dateKey);
}

export async function isEodClosed(dateKey: string): Promise<boolean> {
  return Boolean(await dexieDb.eodClosures.get(dateKey));
}

export async function markEodClosed(dateKey: string): Promise<EodClosure> {
  const record: EodClosure = { id: dateKey, dateKey, closedAt: new Date() };
  await dexieDb.eodClosures.put(record);
  return record;
}

export async function clearEodClosed(dateKey: string): Promise<void> {
  await dexieDb.eodClosures.delete(dateKey);
}

// Seed demo data
export async function seedDemoData(): Promise<void> {
  // Demo seeding disabled permanently.
  // This function used to populate sample/demo products and stores.
  // Keeping a no-op here to avoid accidental demo data insertion.
  console.log('seedDemoData: demo seeding disabled');
  return;

  const existingProductsCount = await dexieDb.products.count();
  const existingCategoriesCount = await dexieDb.categories.count();

  function createDemoImageDataUrl(label: string, color: string) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="100%" height="100%" rx="32" fill="${color}"/><text x="50%" y="54%" fill="#ffffff" font-family="Arial, sans-serif" font-size="56" font-weight="700" dominant-baseline="middle" text-anchor="middle">${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  const categories: Category[] = [
    { id: 'cat-1', name: 'Beverages', icon: 'Coffee', color: '#3B82F6', order: 1, createdAt: new Date(), storeId: demoStoreId },
    { id: 'cat-2', name: 'Snacks', icon: 'Cookie', color: '#F59E0B', order: 2, createdAt: new Date(), storeId: demoStoreId },
    { id: 'cat-3', name: 'Household', icon: 'Home', color: '#10B981', order: 3, createdAt: new Date(), storeId: demoStoreId },
    { id: 'cat-4', name: 'Personal Care', icon: 'Heart', color: '#EC4899', order: 4, createdAt: new Date(), storeId: demoStoreId },
    { id: 'cat-5', name: 'Dairy', icon: 'Milk', color: '#8B5CF6', order: 5, createdAt: new Date(), storeId: demoStoreId },
  ];

  if (existingCategoriesCount === 0) {
    await dexieDb.categories.bulkPut(categories);
  }

  const now = new Date();
  const products: Product[] = [
    { id: 'p1', name: 'Coca-Cola 500ml', barcode: '5449000000996', buyingPrice: 12, sellingPrice: 18, stock: 50, lowStockThreshold: 10, categoryIds: ['cat-1'], storeId: demoStoreId, imageUrl: createDemoImageDataUrl('Coke', '#ef4444'), createdAt: now, updatedAt: now },
    { id: 'p2', name: 'Fanta Orange 500ml', barcode: '5449000000997', buyingPrice: 12, sellingPrice: 18, stock: 45, lowStockThreshold: 10, categoryIds: ['cat-1'], storeId: demoStoreId, imageUrl: createDemoImageDataUrl('Fanta', '#f97316'), createdAt: now, updatedAt: now },
    { id: 'p3', name: 'Simba Chips Salt & Vinegar', barcode: '6001240000001', buyingPrice: 8, sellingPrice: 15, stock: 5, lowStockThreshold: 10, categoryIds: ['cat-2'], storeId: demoStoreId, imageUrl: createDemoImageDataUrl('Simba', '#f59e0b'), createdAt: now, updatedAt: now },
    { id: 'p4', name: "Lay's Classic", barcode: '6001240000002', buyingPrice: 10, sellingPrice: 18, stock: 30, lowStockThreshold: 10, categoryIds: ['cat-2'], storeId: demoStoreId, imageUrl: createDemoImageDataUrl('Lay\'s', '#f97316'), createdAt: now, updatedAt: now },
    { id: 'p5', name: 'Sunlight Dishwashing Liquid', barcode: '6001087000001', buyingPrice: 25, sellingPrice: 40, stock: 20, lowStockThreshold: 5, categoryIds: ['cat-3'], storeId: demoStoreId, imageUrl: createDemoImageDataUrl('Sunlight', '#10b981'), createdAt: now, updatedAt: now },
    { id: 'p6', name: 'Dove Soap Bar', barcode: '8712561000001', buyingPrice: 18, sellingPrice: 30, stock: 25, lowStockThreshold: 8, categoryIds: ['cat-4'], storeId: demoStoreId, imageUrl: createDemoImageDataUrl('Dove', '#ec4899'), createdAt: now, updatedAt: now },
    { id: 'p7', name: 'Full Cream Milk 1L', barcode: '6001240100001', buyingPrice: 20, sellingPrice: 28, stock: 15, lowStockThreshold: 10, categoryIds: ['cat-5'], storeId: demoStoreId, imageUrl: createDemoImageDataUrl('Milk', '#8b5cf6'), createdAt: now, updatedAt: now },
    { id: 'p8', name: 'Yoghurt Strawberry 175g', barcode: '6001240100002', buyingPrice: 8, sellingPrice: 14, stock: 0, lowStockThreshold: 5, categoryIds: ['cat-5'], storeId: demoStoreId, imageUrl: createDemoImageDataUrl('Yoghurt', '#6366f1'), createdAt: now, updatedAt: now },
  ];

  if (existingProductsCount === 0) {
    await dexieDb.products.bulkPut(products);
  }

  // Force Sync the demo products to Supabase so that GuestShopPage can load them online!
  // This will securely insert OR update them if they don't exist online.
  try {
    const { supabase, isSupabaseConfigured } = await import('@/lib/supabase');
    if (isSupabaseConfigured()) {
      // Products
      const sbProducts = products.map(p => ({
        id: p.id,
        store_id: p.storeId,
        name: p.name,
        barcode: p.barcode,
        buying_price: p.buyingPrice,
        selling_price: p.sellingPrice,
        stock: p.stock,
        low_stock_threshold: p.lowStockThreshold,
        stock_unit: p.stockUnit,
        sell_unit: p.sellUnit,
        units_per_bulk: p.unitsPerBulk,
        category_ids: p.categoryIds,
        image_url: p.imageUrl,
        created_at: p.createdAt.toISOString(),
        updated_at: p.updatedAt.toISOString(),
      }));
      await supabase.from('products').upsert(sbProducts, { onConflict: 'id' });
      
      // Categories
      const sbCategories = categories.map(c => ({
        id: c.id,
        store_id: c.storeId,
        name: c.name,
        icon: c.icon,
        color: c.color,
        display_order: c.order,
        created_at: c.createdAt.toISOString()
      }));
      await supabase.from('categories').upsert(sbCategories, { onConflict: 'id' });
    }
  } catch (e) {
    console.error("Failed to seed demo data to Supabase:", e);
  }
}

// Export all data as JSON
export async function exportAllData(): Promise<string> {
  const data = {
    products: await dexieDb.products.toArray(),
    categories: await dexieDb.categories.toArray(),
    sales: await dexieDb.sales.toArray(),
    saleItems: await dexieDb.saleItems.toArray(),
    dailySummaries: await dexieDb.dailySummaries.toArray(),
    shifts: await dexieDb.shifts.toArray(),
    eodClosures: await dexieDb.eodClosures.toArray(),
    customers: await dexieDb.customers.toArray(),
    customerLedger: await dexieDb.customerLedger.toArray(),
    expenses: await dexieDb.expenses.toArray(),
    shiftReports: await dexieDb.shiftReports.toArray(),
    stockInwardLogs: await dexieDb.stockInwardLogs.toArray(),
    stores: await dexieDb.stores.toArray(),
    companies: await dexieDb.companies.toArray(),
    staff: await dexieDb.staff.toArray(),
    departments: await dexieDb.departments.toArray(),
    shiftLogs: await dexieDb.shiftLogs.toArray(),
    companySalesSummary: await dexieDb.companySalesSummary.toArray(),
    auditLogs: await dexieDb.auditLogs.toArray(),
    onlineOrders: await dexieDb.onlineOrders.toArray(),
    onlineOrderItems: await dexieDb.onlineOrderItems.toArray(),
    storeInventoryAlerts: await dexieDb.storeInventoryAlerts.toArray(),
    settings: await getSettings(),
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(data, null, 2);
}

// Import data from JSON
export async function importData(jsonString: string): Promise<string | null> {
  const data = JSON.parse(jsonString);
  const currentStoreId = getDeviceStoreId();
  const storeIdMap = new Map<string, string>();
  const generateStoreId = () => crypto.randomUUID?.() || `store_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const importedStores = Array.isArray(data.stores)
    ? data.stores
    : data.stores && typeof data.stores === 'object'
    ? [data.stores]
    : data.store && typeof data.store === 'object'
    ? [data.store]
    : [];

  const normalizedStores = importedStores.map((store: any) => {
    const originalId = typeof store?.id === 'string' && store.id.trim() !== '' ? store.id : undefined;
    const storeId = originalId || generateStoreId();
    if (originalId && originalId !== storeId) {
      storeIdMap.set(originalId, storeId);
    }
    return {
      ...store,
      id: storeId,
    };
  });

  const normalizeStoreId = (value: string | undefined | null) => {
    if (typeof value === 'string' && value.trim() !== '') {
      return storeIdMap.get(value) ?? value;
    }

    return normalizedStores.length > 0 ? normalizedStores[0].id : currentStoreId;
  };

  const restoreStoreId = normalizedStores.length > 0 ? normalizedStores[0].id : null;

  await dexieDb.transaction(
    'rw',
    dexieDb.products,
    dexieDb.categories,
    dexieDb.sales,
    dexieDb.saleItems,
    async () => {
      if (data.products?.length) {
        await dexieDb.products.bulkPut(
          data.products.map((item: any) => ({ ...item, storeId: normalizeStoreId(item.storeId) }))
        );
      }
      if (data.categories?.length) {
        await dexieDb.categories.bulkPut(
          data.categories.map((item: any) => ({ ...item, storeId: normalizeStoreId(item.storeId) }))
        );
      }
      if (data.sales?.length) {
        await dexieDb.sales.bulkPut(
          data.sales.map((item: any) => ({ ...item, storeId: normalizeStoreId(item.storeId) }))
        );
      }
      if (data.saleItems?.length) {
        await dexieDb.saleItems.bulkPut(
          data.saleItems.map((item: any) => ({ ...item, storeId: normalizeStoreId(item.storeId) }))
        );
      }
    }
  );

  await dexieDb.transaction(
    'rw',
    dexieDb.shifts,
    dexieDb.eodClosures,
    dexieDb.customers,
    dexieDb.customerLedger,
    async () => {
      if (data.shifts?.length) {
        await dexieDb.shifts.bulkPut(data.shifts);
      }
      if (data.eodClosures?.length) {
        await dexieDb.eodClosures.bulkPut(data.eodClosures);
      }
      if (data.customers?.length) {
        await dexieDb.customers.bulkPut(data.customers);
      }
      if (data.customerLedger?.length) {
        await dexieDb.customerLedger.bulkPut(data.customerLedger);
      }
    }
  );

  if (data.expenses?.length) {
    await dexieDb.expenses.bulkPut(data.expenses);
  }

  if (data.dailySummaries?.length) {
    await dexieDb.dailySummaries.bulkPut(data.dailySummaries);
  }

  if (normalizedStores.length > 0) {
    await dexieDb.stores.bulkPut(normalizedStores);
  }

  if (data.companies?.length) {
    const normalizedCompanies = data.companies.map((company: any) => ({
      ...company,
      id:
        typeof company?.id === 'string' && company.id.trim() !== ''
          ? company.id
          : crypto.randomUUID(),
      ownerPhone:
        company.ownerPhone != null
          ? String(company.ownerPhone).replace(/\D/g, '')
          : company.ownerPhone,
      ownerPin: company.ownerPin != null ? String(company.ownerPin) : company.ownerPin,
      createdAt: company.createdAt ? new Date(company.createdAt) : new Date(),
      updatedAt: company.updatedAt ? new Date(company.updatedAt) : new Date(),
    }));
    await dexieDb.companies.bulkPut(normalizedCompanies);
  }

  if (data.staff?.length) {
    await dexieDb.staff.bulkPut(data.staff);
  }

  if (data.departments?.length) {
    await dexieDb.departments.bulkPut(data.departments);
  }

  if (data.shiftLogs?.length) {
    await dexieDb.shiftLogs.bulkPut(data.shiftLogs);
  }

  if (data.companySalesSummary?.length) {
    await dexieDb.companySalesSummary.bulkPut(data.companySalesSummary);
  }

  if (data.storeInventoryAlerts?.length) {
    await dexieDb.storeInventoryAlerts.bulkPut(data.storeInventoryAlerts);
  }

  if (data.auditLogs?.length) {
    await dexieDb.auditLogs.bulkPut(data.auditLogs);
  }

  if (data.onlineOrders?.length) {
    await dexieDb.onlineOrders.bulkPut(
      data.onlineOrders.map((item: any) => ({
        ...item,
        storeId: normalizeStoreId(item.storeId),
      }))
    );
  }

  if (data.onlineOrderItems?.length) {
    await dexieDb.onlineOrderItems.bulkPut(data.onlineOrderItems);
  }

  if (data.settings) {
    const existingSettings = await getSettings();
    const importedSettings = {
      ...existingSettings,
      ...data.settings,
      id: 'main',
      createdAt: existingSettings?.createdAt ?? new Date(),
      updatedAt: new Date(),
    } as Settings;

    if (existingSettings) {
      const importedPin = data.settings.adminPin != null
        ? String(data.settings.adminPin).trim() || existingSettings.adminPin
        : existingSettings.adminPin;
      importedSettings.adminPin = importedPin;

      let importedPinSetupComplete = existingSettings.pinSetupComplete;
      if (typeof data.settings.pinSetupComplete === 'boolean') {
        importedPinSetupComplete = data.settings.pinSetupComplete;
      } else if (typeof data.settings.pinSetupComplete === 'string') {
        importedPinSetupComplete = data.settings.pinSetupComplete.toLowerCase() === 'true';
      }
      importedSettings.pinSetupComplete = importedPinSetupComplete;
    }

    await dexieDb.settings.put(importedSettings);
  }

  if (data.shiftReports?.length) {
    await dexieDb.shiftReports.bulkPut(data.shiftReports);
  }
  if (data.stockInwardLogs?.length) {
    await dexieDb.stockInwardLogs.bulkPut(data.stockInwardLogs);
  }

  return restoreStoreId;
}

// ========== DAILY INVENTORY AUDIT FUNCTIONS ==========

/**
 * Create a new daily inventory audit record
 */
export async function createDailyInventoryAudit(
  audit: DailyInventoryAudit
): Promise<DailyInventoryAudit> {
  await dexieDb.dailyInventoryAudits.put(audit);
  return audit;
}

/**
 * Get audit by ID
 */
export async function getDailyInventoryAudit(id: string): Promise<DailyInventoryAudit | undefined> {
  return dexieDb.dailyInventoryAudits.get(id);
}

/**
 * Get all audits for a store on a specific date
 */
export async function getAuditsByStoreAndDate(
  storeId: string,
  auditDate: string
): Promise<DailyInventoryAudit[]> {
  return dexieDb.dailyInventoryAudits
    .where('storeId')
    .equals(storeId)
    .filter((a) => a.auditDate === auditDate)
    .toArray();
}

/**
 * Get all audits for a store within a date range
 */
export async function getAuditsByStoreAndDateRange(
  storeId: string,
  startDate: string,
  endDate: string
): Promise<DailyInventoryAudit[]> {
  return dexieDb.dailyInventoryAudits
    .where('storeId')
    .equals(storeId)
    .filter((a) => a.auditDate >= startDate && a.auditDate <= endDate)
    .toArray();
}

/**
 * Get all completed audits for a store
 */
export async function getCompletedAuditsByStore(storeId: string): Promise<DailyInventoryAudit[]> {
  return dexieDb.dailyInventoryAudits
    .where('storeId')
    .equals(storeId)
    .filter((a) => a.status === 'completed')
    .toArray();
}

/**
 * Update an existing audit
 */
export async function updateDailyInventoryAudit(
  audit: DailyInventoryAudit
): Promise<DailyInventoryAudit> {
  audit.updatedAt = new Date();
  await dexieDb.dailyInventoryAudits.put(audit);
  return audit;
}

/**
 * Delete an audit
 */
export async function deleteDailyInventoryAudit(id: string): Promise<void> {
  await dexieDb.dailyInventoryAudits.delete(id);
}

/**
 * Calculate inventory accuracy based on matching items
 */
export function calculateInventoryAccuracy(
  openingItems: Array<{ productId: string }>,
  closingItems: Array<{ productId: string }>
): number {
  const openingIds = new Set(openingItems.map((i) => i.productId));
  const closingIds = new Set(closingItems.map((i) => i.productId));
  
  const matchingItems = Array.from(openingIds).filter((id) => closingIds.has(id)).length;
  const totalItems = new Set([...openingIds, ...closingIds]).size;
  
  return totalItems > 0 ? (matchingItems / totalItems) * 100 : 0;
}

/**
 * Calculate metrics for the audit report
 */
export function calculateAuditMetrics(
  openingItems: DailyInventoryAuditItem[],
  closingItems: DailyInventoryAuditItem[],
  openingStockValue: number,
  closingStockValue: number
) {
  const openingIds = new Set(openingItems.map((i) => i.productId));
  const closingIds = new Set(closingItems.map((i) => i.productId));
  
  // Find missing and extra products
  const missingProducts = Array.from(openingIds).filter((id) => !closingIds.has(id));
  const extraProducts = Array.from(closingIds).filter((id) => !openingIds.has(id));
  
  // Calculate products sold
  let productsSold = 0;
  openingItems.forEach((openingItem) => {
    const closingItem = closingItems.find((i) => i.productId === openingItem.productId);
    if (!closingItem || closingItem.quantity < openingItem.quantity) {
      productsSold++;
    }
  });
  
  // Stock difference
  const stockDifference = openingItems.reduce((sum, item) => sum + item.quantity, 0) - 
                         closingItems.reduce((sum, item) => sum + item.quantity, 0);
  
  // Sales value
  const salesValue = openingStockValue - closingStockValue;
  
  // Gross profit (based on the difference in stock values)
  // Approximate: assume average margin of 35-40%
  const grossProfit = Math.max(0, salesValue * 0.35);
  
  // Inventory accuracy
  const matchingItems = openingItems.filter((openingItem) => {
    const closingItem = closingItems.find((i) => i.productId === openingItem.productId);
    return closingItem !== undefined;
  }).length;
  
  const totalItems = new Set([...openingIds, ...closingIds]).size;
  const inventoryAccuracy = totalItems > 0 ? (matchingItems / totalItems) * 100 : 0;
  
  // Low and out-of-stock products
  const outOfStockProducts: string[] = [];
  closingItems.forEach((item) => {
    if (item.quantity === 0) {
      outOfStockProducts.push(item.productId);
    }
  });
  
  return {
    productsSold,
    stockDifference,
    salesValue,
    grossProfit,
    inventoryAccuracy,
    missingProducts,
    extraProducts,
    outOfStockProducts,
  };
}

/**
 * Check if an audit can be marked as completed
 */
export function canCompleteAudit(audit: Omit<DailyInventoryAudit, 'id' | 'createdAt' | 'updatedAt'>): boolean {
  return (
    audit.openingStockItems.length > 0 &&
    audit.closingStockItems.length > 0 &&
    audit.openingStockValue > 0 &&
    audit.closingStockValue >= 0
  );
}

// ========== AI STOCK RECONCILIATION FUNCTIONS ==========

function sanitizeStockReconciliationSessionForDb(
  session: StockReconciliationSession
): StockReconciliationSession {
  const asString = (value: unknown, fallback = ''): string => {
    if (typeof value === 'string' && value.trim()) return value;
    if (value === null || value === undefined) return fallback;
    return String(value);
  };

  const cleanRow = (row: StockReconciliationOcrRow): StockReconciliationOcrRow => ({
    rawName: asString(row?.rawName),
    quantity: Number(row?.quantity) || 0,
    unitPrice: row?.unitPrice !== undefined ? Number(row.unitPrice) || 0 : undefined,
    amount: row?.amount !== undefined ? Number(row.amount) || 0 : undefined,
    opening: row?.opening !== undefined ? Number(row.opening) || 0 : undefined,
    closing: row?.closing !== undefined ? Number(row.closing) || 0 : undefined,
    refill: row?.refill !== undefined ? Number(row.refill) || 0 : undefined,
  });

  const images = (session.images || []).map((image) => ({
    id: asString(image.id, crypto.randomUUID()),
    type: image.type,
    fileName: asString(image.fileName, 'file'),
    mimeType: asString(image.mimeType, 'application/octet-stream'),
    fileSize: Number(image.fileSize) || 0,
    // Drop huge payloads — IndexedDB DataError / QuotaExceeded on fat Excel base64
    dataUrl:
      typeof image.dataUrl === 'string' && image.dataUrl.length <= 1_500_000 ? image.dataUrl : '',
    uploadedAt: image.uploadedAt instanceof Date ? image.uploadedAt : new Date(image.uploadedAt || Date.now()),
    ocrRawText: typeof image.ocrRawText === 'string' ? image.ocrRawText.slice(0, 5000) : undefined,
  }));

  return {
    ...session,
    id: asString(session.id, crypto.randomUUID()),
    companyId: asString(session.companyId, 'unknown'),
    companyName: asString(session.companyName, 'Company'),
    storeId: asString(session.storeId, 'unknown'),
    storeName: asString(session.storeName, 'Store'),
    reportDate: asString(session.reportDate, new Date().toISOString().slice(0, 10)),
    status: session.status || 'draft',
    images,
    ocrResults: session.ocrResults
      ? {
          opening: (session.ocrResults.opening || []).map(cleanRow),
          closing: (session.ocrResults.closing || []).map(cleanRow),
          refill: (session.ocrResults.refill || []).map(cleanRow),
        }
      : undefined,
    extractionPreview: (session.extractionPreview || []).map(cleanRow),
    lineItems: Array.isArray(session.lineItems) ? session.lineItems : [],
    lowStockItems: Array.isArray(session.lowStockItems) ? session.lowStockItems : [],
    unmatchedItems: Array.isArray(session.unmatchedItems) ? session.unmatchedItems : [],
    dataErrors: Array.isArray(session.dataErrors) ? session.dataErrors : [],
  };
}

function formatStorageError(error: unknown): string {
  if (error instanceof DOMException) {
    if (
      error.name === 'DataError' ||
      error.name === 'DataCloneError' ||
      error.name === 'QuotaExceededError'
    ) {
      return `Browser storage failed (${error.name}). Your extracted rows are still on screen — you can continue Match without re-uploading.`;
    }
    return `${error.name}: ${error.message}`;
  }
  if (error instanceof Error) {
    if (/dataerror|dataclone|quotaexceeded/i.test(error.name + error.message)) {
      return `Browser storage failed (${error.name || 'DataError'}). Your extracted rows are still on screen — continue with Match.`;
    }
    return error.message;
  }
  return String(error);
}

export async function createStockReconciliationSession(
  session: StockReconciliationSession
): Promise<StockReconciliationSession> {
  const safe = sanitizeStockReconciliationSessionForDb(session);
  try {
    await dexieDb.stockReconciliationSessions.put(safe);
  } catch (error) {
    console.error('createStockReconciliationSession failed', error);
    throw new Error(formatStorageError(error));
  }
  return safe;
}

export async function getStockReconciliationSession(
  id: string
): Promise<StockReconciliationSession | undefined> {
  return dexieDb.stockReconciliationSessions.get(id);
}

export async function updateStockReconciliationSession(
  session: StockReconciliationSession
): Promise<StockReconciliationSession> {
  const safe = sanitizeStockReconciliationSessionForDb({
    ...session,
    updatedAt: new Date(),
  });
  try {
    await dexieDb.stockReconciliationSessions.put(safe);
  } catch (error) {
    console.error('updateStockReconciliationSession failed', error);
    throw new Error(formatStorageError(error));
  }
  return safe;
}

export async function getStockReconciliationSessionsByCompany(
  companyId: string
): Promise<StockReconciliationSession[]> {
  return dexieDb.stockReconciliationSessions
    .where('companyId')
    .equals(companyId)
    .reverse()
    .sortBy('createdAt');
}

export async function getStockReconciliationSessionsByStoreAndDate(
  storeId: string,
  reportDate: string
): Promise<StockReconciliationSession[]> {
  return dexieDb.stockReconciliationSessions
    .where('storeId')
    .equals(storeId)
    .filter((s) => s.reportDate === reportDate)
    .toArray();
}
