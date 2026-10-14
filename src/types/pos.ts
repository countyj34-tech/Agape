// Core POS Data Types

export interface Product {
  id: string;
  name: string;
  barcode: string;
  buyingPrice: number;
  sellingPrice: number;
  stock: number;
  lowStockThreshold: number;
  categoryIds: string[];
  // Optional unit management (for bulk packs vs individual items)
  stockUnit?: 'individual' | 'bulk';
  sellUnit?: 'individual' | 'bulk';
  unitsPerBulk?: number; // how many individual units are in 1 bulk pack
  // Multi-store: which store/branch this product belongs to
  storeId: string;
  // Optional product image (base64 data URL or remote URL)
  imageUrl?: string;
  image?: string; // Additional field used in GuestShopPage
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  order: number;
  storeId?: string;
  createdAt: Date;
}

export interface CartItem {
  lineId: string;
  product: Product;
  quantity: number;
  unitPrice?: number; // optional per-line price override
}

export interface Sale {
  id: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  // Sales tax collected on this transaction (e.g., TOT/VAT). Optional for legacy records.
  salesTaxMode?: 'none' | 'tot' | 'vat';
  salesTaxRate?: number; // percent, e.g. 5 or 16
  salesTaxAmount?: number;
  profit: number;
  // Multi-store: which store/branch this sale belongs to
  storeId: string;
  paymentMethod: 'cash' | 'card' | 'mobile' | 'credit' | 'transfer';
  shiftId?: string;
  cashierName?: string;
  // Offline-friendly staff identifier (acts as local user_id)
  cashierId?: string;
  // Amount actually collected at the time of sale (for reconciliation).
  amountPaid?: number;
  amountReceived?: number;
  changeGiven?: number;
  // Credit / Pay Later
  balanceDue?: number;
  customerId?: string;
  customerName?: string;
  // Mobile Money
  mobileProvider?: 'mtn' | 'airtel' | 'zamtel' | 'other';
  mobileReference?: string;
  createdAt: Date;
  // Local metadata to help reason about what is safely on-device vs synced
  lastSyncedAt?: Date | null;
  receiptNumber: string;
  // Optional ZRA Smart Invoice metadata attached after a successful sale.
  zraSmartInvoiceEnabled?: boolean;
  zraTpin?: string;
  zraInvoiceNumber?: string;
  zraVerificationCode?: string;
  zraQrCode?: string;
}

export interface Customer {
  id: string;
  name: string;
  nameKey: string; // normalized lowercase name for lookup
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ExpenseSource = 'cash' | 'mtn' | 'airtel' | 'other';

export interface Expense {
  id: string;
  amount: number;
  category: string; // e.g. Rent, Talk time, Transport
  note?: string;
  source: ExpenseSource;
  mobileReference?: string;
  storeId?: string;
  companyId?: string;
  createdAt: Date;
}

export type CustomerLedgerKind = 'debt' | 'payment';
export type CustomerPaymentMethod = 'cash' | 'mobile';

export interface CustomerLedgerEntry {
  id: string;
  customerId: string;
  kind: CustomerLedgerKind;
  amount: number;
  method?: CustomerPaymentMethod; // for payments
  mobileProvider?: 'mtn' | 'airtel' | 'zamtel' | 'other';
  mobileReference?: string;
  relatedSaleId?: string;
  note?: string;
  createdAt: Date;
}

export type ShiftStatus = 'open' | 'closed';

export interface Shift {
  id: string;
  status: ShiftStatus;
  cashierName: string;
  // Offline-friendly staff identifier (acts as local user_id)
  cashierId?: string;
  // Staff information for accountability
  staffId?: string;
  staffPhone?: string;
  companyId?: string;
  storeId?: string;
  role?: 'owner' | 'manager' | 'salesperson' | 'cashier' | 'delivery' | 'other' | 'staff';
  openingCash?: number;
  closingCash?: number;
  // When true the shift is currently locked for an audit/reconciliation process
  auditLocked?: boolean;
  // Alert status set when discrepancy detected
  alertStatus?: 'none' | 'theft';
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Per-shift reconciliation / audit trail
export type ShiftReconciliationStatus = 'balanced' | 'overage' | 'shortage';

export interface ShiftReport {
  id: string;
  shiftId: string;
  storeId: string;
  cashierName: string;
  expectedAmount: number; // system-calculated expected cash for the shift
  actualAmount: number; // physical cash counted in drawer
  difference: number; // actual - expected
  status: ShiftReconciliationStatus;
  userId?: string | null; // reserved for future Supabase auth wiring
   note?: string; // optional explanation for overage/shortage
  // When true the record is immutable from the UI (audit lock)
  locked?: boolean;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  shiftId: string;
  shiftReportId?: string;
  staffName: string;
  expectedCash: number;
  actualCash: number;
  variance: number; // actual - expected (negative = shortage)
  createdAt: Date;
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  buyingPrice: number;
  total: number;
}

export interface DailySummary {
  id: string;
  date: string; // YYYY-MM-DD
  totalRevenue: number;
  totalProfit: number;
  // Optional store metadata for multi-store EOD reports
  storeId?: string;
  storeName?: string;
  // Optional reconciliation fields (may be absent on older saved summaries)
  cashIn?: number;
  cardIn?: number;
  transferIn?: number;
  mobileInTotal?: number;
  mobileInByProvider?: Partial<Record<'mtn' | 'airtel' | 'zamtel' | 'other', number>>;
  creditIssued?: number;
  creditPayments?: number;
  expensesTotal?: number;
  expensesCash?: number;
  expensesMobileTotal?: number;
  expensesMobileBySource?: Partial<Record<'mtn' | 'airtel' | 'zamtel' | 'other', number>>;
  netProfitAfterExpenses?: number;
  transactionCount: number;
  topSellers: TopSeller[];
  lowStockItems: LowStockItem[];
  stockValue?: number;
  // Optional snapshot of current stock for all products in the store
  inventorySnapshot?: InventorySnapshotItem[];
  createdAt: Date;
}

export interface EodClosure {
  id: string; // YYYY-MM-DD (local)
  dateKey: string; // YYYY-MM-DD (local)
  closedAt: Date;
 }

export interface TopSeller {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
  // Optional current remaining stock for this product at time of report
  remainingStock?: number;
}

export interface LowStockItem {
  productId: string;
  productName: string;
  currentStock: number;
  threshold: number;
}

export interface InventorySnapshotItem {
  productId: string;
  productName: string;
  currentStock: number;
}

// Stock inward ledger (restock history)
export interface StockInwardLog {
  id: string;
  productId: string;
  productName: string;
  quantityAdded: number;
  unitCost: number;
  totalCost: number;
  receivedAt: Date;
  addedBy?: string;
  storeId: string;
  createdAt: Date;
}

export interface Settings {
  companyId: string;
  id: string;
  shopName: string;
  shopAddress: string;
  shopPhone: string;
  receiptStoreName?: string;
  receiptStoreAddress?: string;
  receiptStorePhone?: string;
  receiptLogoUrl?: string;
  currency: string;
  currencySymbol: string;
  // Base currency in which historical amounts are stored. Defaults to first currency used (e.g. ZMW).
  baseCurrency?: string;
  // Simple local plan flag for now: free tier first, premium later.
  plan?: 'free' | 'premium';
  // Simple local role + assignment for store access before full Supabase auth wiring.
  userRole?: 'owner' | 'manager' | 'salesperson' | 'cashier' | 'delivery' | 'other' | 'staff' | 'super_admin';
  assignedStoreId?: string | null;
  // Profit/income tax used for owner analytics (Financial Hub, reports). Percent.
  taxRate: number;
  // Sales tax mode for receipts (ZRA-style TOT/VAT). Separate from profit tax.
  salesTaxMode?: 'none' | 'tot' | 'vat';
  salesTaxRate?: number; // percent, defaults based on mode
  singleItemMarginPercent?: number;
  receiptFooter: string;
  thermalPrinterWidth: '58mm' | '80mm';
  adminPin: string | null;
  pinSetupComplete: boolean;
  eodAutoPromptEnabled?: boolean;
  eodClosingTime?: string; // HH:MM (24h)
  auditSyncEnabled?: boolean;
  auditOpeningTime?: string; // HH:MM (24h)
  auditClosingTime?: string; // HH:MM (24h)

  // Device activation lock (commercial licensing)
  activationLockEnabled?: boolean;
  isActivated?: boolean;
  // Stored activation key (hash) used for re-verification on each app start.
  // This prevents users from simply flipping booleans to bypass licensing.
  activationKey?: string;

  // Automated WhatsApp reporting (requires user action in browsers, or a webhook for full automation)
  autoWhatsAppEnabled?: boolean;
  autoWhatsAppNumber?: string; // E.164 digits only preferred, e.g. 26097...
  autoWhatsAppMethod?: 'web' | 'webhook';
  autoWhatsAppWebhookUrl?: string; // POST endpoint that relays to WhatsApp Cloud/API
  createdAt: Date;
  updatedAt: Date;
}

/** Device-local serial/USB pole (VFD) customer display settings. */
export type CustomerDisplayConnectionType = 'serial' | 'usb_virtual_com';
export type CustomerDisplayParity = 'none' | 'even' | 'odd';
export type CustomerDisplayEncoding = 'ascii' | 'utf8';

export interface CustomerDisplaySettings {
  id: string; // singleton: 'main'
  enabled: boolean;
  connectionType: CustomerDisplayConnectionType;
  /** Human label such as COM3 or USB Serial (xxxx:yyyy). */
  comPort: string;
  /** Stable Web Serial matcher when available. */
  portVendorId?: number | null;
  portProductId?: number | null;
  baudRate: number;
  dataBits: 7 | 8;
  parity: CustomerDisplayParity;
  stopBits: 1 | 2;
  encoding: CustomerDisplayEncoding;
  autoReconnect: boolean;
  brightness: number; // 0–100
  lineWidth: number; // typically 16 or 20
  shopName?: string;
  testMessage: string;
  lastConnected?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Stock status helpers
export type StockStatus = 'in-stock' | 'low-stock' | 'out-of-stock';

export function getStockStatus(product: Product): StockStatus {
  if (product.stock <= 0) return 'out-of-stock';
  if (product.stock <= product.lowStockThreshold) return 'low-stock';
  return 'in-stock';
}

// Margin calculation
export function calculateMargin(buyingPrice: number, sellingPrice: number): number {
  if (buyingPrice === 0) return 100;
  return ((sellingPrice - buyingPrice) / buyingPrice) * 100;
}

// Receipt number generator
export function generateReceiptNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = date.getTime().toString().slice(-6);
  return `R${dateStr}-${timeStr}`;
}

// ========== ONLINE ORDERS / TWO-IN-ONE SYSTEM ==========

export type OnlineOrderStatus = 'PENDING' | 'AWAITING_APPROVAL' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type OnlineOrderSource = 'ONLINE' | 'WHATSAPP_LINK' | 'IN_STORE';
export type OnlineOrderPaymentStatus = 'UNPAID' | 'PENDING_APPROVAL' | 'PAID' | 'PARTIAL';
export type DeliveryType = 'collect' | 'delivery';

export interface OnlineOrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  priceAtOrder: number;
  buyingPriceAtOrder: number;
  createdAt: Date;
}

export interface OnlineOrder {
  id: string;
  storeId: string;
  orderNumber: string; // Format: ORD-20240305-001
  customerName: string;
  customerPhone: string;
  status: OnlineOrderStatus;
  source: OnlineOrderSource;
  items: OnlineOrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  // Delivery
  deliveryType: DeliveryType; // 'collect' or 'delivery'
  deliveryFee: number;
  deliveryAddress?: string;
  // Payment
  paymentStatus: OnlineOrderPaymentStatus;
  paymentProofUrl?: string; // Base64 image or URL of payment proof
  paymentTransactionId?: string; // Transaction ID from payment gateway
  // Payment details for online orders
  paymentCategory?: 'mobile' | 'bank';
  mobileProvider?: 'mtn' | 'airtel' | 'zamtel' | 'zedmobile';
  selectedBank?: string;

  paymentProofMethod?: 'manual' | 'screenshot'; // How payment was proved
  // Approval workflow
  needsPaymentApproval: boolean; // Whether salesperson needs to approve payment
  approvalNotes?: string;
  // Completion
  verifiedByStaffId?: string;
  verifiedAt?: Date;
  completedSaleId?: string; // Reference to the sale created when verified
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnlineOrderNotification {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  itemCount: number;
  total: number;
  createdAt: Date;
}

// Generate online order number (ORD-YYYYMMDD-###)
export function generateOnlineOrderNumber(storeId: string): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = date.getTime().toString().slice(-3);
  return `ORD-${dateStr}-${timeStr}`;
}

// ========== MULTI-TENANT COMPANY HIERARCHY ==========

/**
 * Store: Individual store/branch within a company
 * Example: "Chacha Main Store" in Ndola, "Chacha Branch" in Lusaka
 */
export interface Store {
  id: string;
  companyId?: string;
  name: string;
  location_name?: string;
  category?: string;
  address?: string;
  phone?: string;
  currency: string;
  currency_symbol: string;
  payment_numbers?: Record<string, string> | null;
  owner_id?: string;
  store_code?: string;
  is_public?: boolean;
  created_at: string;
  updated_at: string;
  
  // ===== PARALLEL SETTINGS (Hidden Super Admin Only) =====
  parallel_enabled?: boolean; // Enable Parallel module for this store
  parallel_pos_type?: 'mthunzi' | 'external'; // 'mthunzi' = use POS data, 'external' = manual upload
  parallel_settings?: ParallelStoreSettings; // Additional settings (JSONB in DB)
}

/**
 * Company: The top-level container for a multi-store business
 * Example: "Company Chacha" with 6 stores, or "Company Laga" with 2 stores
 */
export interface Company {
  id: string;
  name: string;
  ownerId?: string;
  ownerPhone?: string; // For phone + pin login (e.g., "0971112222")
  ownerPin?: string; // Boss/admin PIN for company owner
  phone?: string;
  email?: string;
  address?: string;
  logoUrl?: string;
  currency: string;
  currencySymbol: string;
  // Base currency in which historical amounts are stored. Defaults to first currency used (e.g. ZMW).
  baseCurrency?: string;
  // Simple local plan flag for now: free tier first, premium later.
  plan?: 'free' | 'premium';
  /** SaaS monthly billing */
  subscriptionStatus?: 'active' | 'past_due' | 'cancelled' | 'trial';
  subscriptionExpiresAt?: string | Date | null;
  subscriptionPlan?: 'starter' | 'business' | 'zra' | string;
  monthlyPriceUsd?: number | null;
  /** Super-admin host kill switch */
  hostStatus?: 'active' | 'paused' | 'suspended' | 'removed';
  hostStatusReason?: string | null;
  // Simple local role + assignment for store access before full Supabase auth wiring.
  userRole?: 'owner' | 'manager' | 'salesperson' | 'cashier' | 'delivery' | 'other' | 'staff' | 'super_admin';
  assignedStoreId?: string | null;
  // Profit/income tax used for owner analytics (Financial Hub, reports). Percent.
  taxRate: number;
  // Sales tax mode for receipts (ZRA-style TOT/VAT). Separate from profit tax.
  salesTaxMode?: 'none' | 'tot' | 'vat';
  salesTaxRate?: number; // percent, defaults based on mode
  singleItemMarginPercent?: number;
  receiptFooter: string;
  thermalPrinterWidth: '58mm' | '80mm';
  adminPin: string | null;
  pinSetupComplete: boolean;
  eodAutoPromptEnabled?: boolean;
  eodClosingTime?: string; // HH:MM (24h)
  auditSyncEnabled?: boolean;
  auditOpeningTime?: string; // HH:MM (24h)
  auditClosingTime?: string; // HH:MM (24h)

  // Device activation lock (commercial licensing)
  activationLockEnabled?: boolean;
  isActivated?: boolean;
  // Stored activation key (hash) used for re-verification on each app start.
  // This prevents users from simply flipping booleans to bypass licensing.
  activationKey?: string;

  // Automated WhatsApp reporting (requires user action in browsers, or a webhook for full automation)
  autoWhatsAppEnabled?: boolean;
  autoWhatsAppNumber?: string; // E.164 digits only preferred, e.g. 26097...
  autoWhatsAppMethod?: 'web' | 'webhook';
  autoWhatsAppWebhookUrl?: string; // POST endpoint that relays to WhatsApp Cloud/API
  settings?: Record<string, any>; // Flexible config: theme, auto_refresh, etc
  // Parallel / inventory intelligence flags (optional; used by company management)
  parallel_enabled?: boolean;
  parallel_source?: 'mthunzi_pos' | 'external_pos';
  parallel_status?: string;
  dashboard_user_limit?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Department: Sub-units within a store (e.g., Bar, Kitchen, Spare Parts Dept)
 * Allows boss to see staff per department
 */
export interface Department {
  id: string;
  storeId: string;
  name: string; // e.g., "Kitchen", "Bar", "Spare Parts Dept"
  description?: string;
  managerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Staff: Team members linked to company (boss) or store/department (workers)
 */
export interface Staff {
  id: string;
  storeId?: string; // For regular staff (workers at a specific store)
  companyId?: string; // For boss/owner (linked to company level)
  departmentId?: string; // Which department they work in
  name: string;
  phone?: string; // E.164 format preferred: +260971112222 or 0971112222
  email?: string;
  employeePin?: string;
  role: 'owner' | 'manager' | 'salesperson' | 'cashier' | 'delivery' | 'other';
  employeeId?: string; // Unique ID like "EMP001"
  authUserId?: string;
  isPinVerified?: boolean;
  isManager: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ShiftLog: Clock in/out tracking for workforce management
 * Shows the boss who is currently working across all stores
 */
export interface ShiftLog {
  id: string;
  companyId: string;
  storeId: string;
  departmentId?: string;
  staffId: string;
  staffPhone: string;
  staffName: string;
  status: 'active' | 'on_break' | 'completed';
  clockInAt: Date;
  clockOutAt?: Date;
  breakDurationMinutes: number;
  hoursWorked?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CompanySalesSummary: Aggregated daily totals for company dashboard
 * Real-time view of money made across all stores
 */
export interface CompanySalesSummary {
  id: string;
  companyId: string;
  dateKey: string; // YYYY-MM-DD
  totalSales: number;
  totalProfit: number;
  totalTransactions: number;
  numStoresActive: number;
  numStaffActive: number;
  cashSales: number;
  cardSales: number;
  mobileSales: number;
  creditSales: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * StoreInventoryAlert: Cross-store low-stock notifications
 * Boss sees which stores need restocking
 */
export interface StoreInventoryAlert {
  id: string;
  companyId: string;
  storeId: string;
  productId: string;
  productName: string;
  currentStock: number;
  lowThreshold: number;
  alertType: 'low_stock' | 'out_of_stock' | 'excess_stock';
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DailyInventoryAudit: Physical inventory audit with opening and closing stock
 * Used by field staff to audit stores and generate professional reports
 */
export interface DailyInventoryAuditItem {
  productId: string;
  productName: string;
  quantity: number; // Opening or closing stock quantity
  unitPrice: number;
  totalValue: number; // quantity * unitPrice
}

export interface DailyInventoryAudit {
  id: string;
  companyId: string;
  storeId: string;
  storeName: string;
  auditDate: string; // YYYY-MM-DD
  auditedBy: string; // Staff name who performed the audit
  auditedByPhone?: string;
  
  // Opening stock
  openingStockItems: DailyInventoryAuditItem[];
  openingStockValue: number; // Total value of opening stock
  
  // Closing stock
  closingStockItems: DailyInventoryAuditItem[];
  closingStockValue: number; // Total value of closing stock
  
  // Calculated metrics
  productsSold: number; // Count of products sold (opening - closing > 0)
  stockDifference: number; // Quantity difference (opening - closing)
  salesValue: number; // Value of products sold (openingStockValue - closingStockValue)
  grossProfit: number; // Calculated based on product margins
  inventoryAccuracy: number; // Percentage: (matching items / total items) * 100
  
  // Discrepancies
  missingProducts: string[]; // Product IDs in opening but not in closing
  extraProducts: string[]; // Product IDs in closing but not in opening
  lowStockProducts: string[]; // Product IDs below threshold
  outOfStockProducts: string[]; // Product IDs with 0 quantity in closing
  
  // Report status
  status: 'draft' | 'completed';
  reportUrl?: string; // URL to generated PDF
  sharedViaWhatsApp?: boolean;
  sharedAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

// ========== AI STOCK RECONCILIATION (Super Admin Only) ==========

export type StockReconciliationImageType = 'opening' | 'closing' | 'refill' | 'combined';

export interface StockReconciliationImage {
  id: string;
  type: StockReconciliationImageType;
  fileName: string;
  mimeType: string;
  fileSize: number;
  dataUrl: string;
  uploadedAt: Date;
  ocrRawText?: string;
}

export interface StockReconciliationOcrRow {
  rawName: string;
  quantity: number;
  unitPrice?: number;
  /** Buying / cost price when present on Excel/CSV/PDF imports */
  buyingPrice?: number;
  amount?: number;
  /** When OCR reads a combined sheet with Opening / Refill / Closing columns */
  opening?: number;
  closing?: number;
  refill?: number;
}

export type StockReconciliationLineStatus = 'matched' | 'unmatched' | 'error';

export interface StockReconciliationLineItem {
  id: string;
  productId?: string;
  productName: string;
  rawName: string;
  openingStock: number;
  closingStock: number;
  refillStock: number;
  quantitySold: number;
  unitPrice: number;
  ocrUnitPrice?: number;
  revenue: number;
  estimatedProfit: number;
  status: StockReconciliationLineStatus;
  issues?: string[];
}

export type StockReconciliationStatus =
  | 'draft'
  | 'processing'
  | 'extracted'
  | 'review'
  | 'approved'
  | 'rejected';

export interface StockReconciliationSession {
  id: string;
  companyId: string;
  companyName: string;
  storeId: string;
  storeName: string;
  reportDate: string;
  images: StockReconciliationImage[];
  ocrResults?: {
    opening: StockReconciliationOcrRow[];
    closing: StockReconciliationOcrRow[];
    refill: StockReconciliationOcrRow[];
  };
  /** Cleaned OCR rows for human review before product matching */
  extractionPreview?: StockReconciliationOcrRow[];
  lineItems: StockReconciliationLineItem[];
  openingStockSummary: { itemCount: number; totalValue: number };
  closingStockSummary: { itemCount: number; totalValue: number };
  refillSummary: { itemCount: number; totalQuantity: number };
  productsSold: number;
  quantitySold: number;
  revenue: number;
  estimatedProfit: number;
  lowStockItems: Array<{ productId: string; productName: string; quantity: number }>;
  unmatchedItems: string[];
  dataErrors: string[];
  status: StockReconciliationStatus;
  uploadStartedAt?: Date;
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  processingDurationMs?: number;
  approvedAt?: Date;
  approvedBy?: string;
  preparedBy?: string;
  rejectionReason?: string;
  saleId?: string;
  /** GPT-generated daily narrative (emojis allowed in UI; PDF uses plain text) */
  narrativeReport?: string;
  narrativeReportGeneratedAt?: Date;
  deliveredAt?: Date;
  deliveredVia?: { email?: boolean; whatsapp?: boolean };
  createdAt: Date;
  updatedAt: Date;
}

// ========== MTHUNZI PARALLEL - INVENTORY INTELLIGENCE SYSTEM ==========

/**
 * ParallelStoreSettings: Settings for Parallel module within a Store
 * Stored in Store.parallel_settings as JSONB
 */
export interface ParallelStoreSettings {
  // POS configuration
  posType: 'mthunzi' | 'external'; // 'mthunzi' auto-uses POS data, 'external' requires manual upload
  
  // Report settings
  reportFrequency?: 'daily' | 'weekly' | 'custom'; // Default: daily
  autoGenerateReports?: boolean; // Auto-generate from POS data daily
  reportApprovalRequired?: boolean; // Require approval before visibility
  
  // Client access
  clientAccessEnabled?: boolean; // Allow dashboard users to view reports
  maxDashboardUsers?: number; // Max read-only users (default: 5)
  
  // Notifications
  emailOnReportGenerated?: boolean;
  emailOnApproval?: boolean;
  whatsAppShareEnabled?: boolean;
  
  // Data settings
  profitMarginEstimate?: number; // Percentage, default 35
  lowStockThreshold?: number; // For alerts
  
  // Metadata
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * ParallelDashboardUser: Read-only access to Parallel reports
 * Linked to a Store (not separate business)
 * Max 5 per store
 */
export interface ParallelDashboardUser {
  id: string;
  storeId: string; // Which store/location
  name: string;
  email: string;
  phone?: string;
  role: 'viewer' | 'manager';
  password?: string; // Simple password (or integrate Supabase auth)
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ParallelUploadedFile: Track uploaded inventory files for processing
 * Linked to a Store
 */
export type FileFormat = 'xlsx' | 'csv' | 'pdf' | 'image' | 'unknown';
export type ProcessingStatus = 'uploaded' | 'processing' | 'completed' | 'failed';

export interface ParallelUploadedFile {
  id: string;
  storeId: string; // Which store this file is for
  fileName: string;
  fileFormat: FileFormat;
  fileSize: number; // in bytes
  fileUrl: string; // Supabase storage URL
  uploadedBy: string; // Admin user ID or email
  processStatus: ProcessingStatus;
  errorMessage?: string;
  processedData?: Record<string, any>; // Extracted data
  uploadedAt: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ParallelReportItem: Line item in a report (product with quantities/values)
 */
export interface ParallelReportItem {
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  buyingPrice?: number;
  margin?: number;
  status?: 'matched' | 'new' | 'missing'; // For inventory matching
}

/**
 * ParallelReport: The main report with all calculations
 * This is what gets approved and shared with clients
 */
export type ReportStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

export interface ParallelReport {
  id: string;
  businessId: string;
  branchId: string;
  reportDate: string; // YYYY-MM-DD
  reportType: 'daily' | 'weekly' | 'custom';
  
  // Source data
  uploadedFileIds: string[];
  extractedFrom: FileFormat[];
  
  // Stock information
  openingStockItems: ParallelReportItem[];
  openingStockValue: number;
  closingStockItems: ParallelReportItem[];
  closingStockValue: number;
  
  // Calculated metrics
  productsSold: number;
  quantitySold: number;
  salesValue: number;
  grossProfit: number;
  grossProfitMargin?: number; // Percentage
  
  // Inventory analysis
  inventoryAccuracy: number; // Percentage
  missingProducts: string[]; // Product IDs
  extraProducts: string[]; // Product IDs
  lowStockProducts: ParallelReportItem[];
  outOfStockProducts: ParallelReportItem[];
  stockVariance: number; // Quantity difference
  
  // Top performers
  topSellingProducts: ParallelReportItem[];
  recommendations: string[];
  
  // Approval workflow
  status: ReportStatus;
  preparedBy: string; // System or user
  approvedBy?: string; // Admin user ID
  approvedAt?: Date;
  rejectionReason?: string;
  
  // Distribution
  reportUrl?: string; // Supabase storage URL
  sharedViaWhatsApp: boolean;
  sharedAt?: Date;
  sharedWith?: string[]; // Email addresses
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ProcessingLog: Track file processing operations
 */
export type LogLevel = 'info' | 'warning' | 'error' | 'success';

export interface ProcessingLog {
  id: string;
  uploadedFileId: string;
  reportId?: string;
  level: LogLevel;
  message: string;
  details?: Record<string, any>;
  processedAt: Date;
  createdAt: Date;
}

