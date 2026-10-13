/**
 * Supabase Schema Healer
 * 
 * Automatically validates and repairs Supabase schema to ensure
 * all data can be synced for remote login and multi-device access.
 */

import { supabase, isSupabaseConfigured } from './supabase';

interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
}

interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  foreignKeys?: {
    column: string;
    refTable: string;
    refColumn: string;
  }[];
}

// Required schema for Supabase sync
const REQUIRED_SCHEMA: TableDefinition[] = [
  {
    name: 'companies',
    columns: [
      { name: 'id', type: 'text', nullable: false },
      { name: 'name', type: 'text', nullable: false },
      { name: 'owner_phone', type: 'text', nullable: true },
      { name: 'owner_email', type: 'text', nullable: true },
      { name: 'owner_pin', type: 'text', nullable: true },
      { name: 'phone', type: 'text', nullable: true },
      { name: 'address', type: 'text', nullable: true },
      { name: 'logo_url', type: 'text', nullable: true },
      { name: 'currency', type: 'text', nullable: true, default: "'ZMW'" },
      { name: 'currency_symbol', type: 'text', nullable: true, default: "'K'" },
      { name: 'base_currency', type: 'text', nullable: true, default: "'ZMW'" },
      { name: 'plan', type: 'text', nullable: true, default: "'free'" },
      { name: 'assigned_store_id', type: 'text', nullable: true },
      { name: 'tax_rate', type: 'numeric', nullable: true, default: '0' },
      { name: 'sales_tax_mode', type: 'text', nullable: true, default: "'none'" },
      { name: 'sales_tax_rate', type: 'numeric', nullable: true, default: '0' },
      { name: 'single_item_margin_percent', type: 'numeric', nullable: true, default: '0' },
      { name: 'receipt_footer', type: 'text', nullable: true },
      { name: 'thermal_printer_width', type: 'text', nullable: true, default: "'58mm'" },
      { name: 'admin_pin', type: 'text', nullable: true },
      { name: 'pin_setup_complete', type: 'boolean', nullable: true, default: 'false' },
      { name: 'is_active', type: 'boolean', nullable: true, default: 'true' },
      { name: 'created_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
      { name: 'updated_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
    ],
  },
  {
    name: 'stores',
    columns: [
      { name: 'id', type: 'text', nullable: false },
      { name: 'company_id', type: 'text', nullable: false },
      { name: 'name', type: 'text', nullable: false },
      { name: 'location_name', type: 'text', nullable: true },
      { name: 'category', type: 'text', nullable: true },
      { name: 'address', type: 'text', nullable: true },
      { name: 'phone', type: 'text', nullable: true },
      { name: 'currency', type: 'text', nullable: true, default: "'ZMW'" },
      { name: 'currency_symbol', type: 'text', nullable: true, default: "'K'" },
      { name: 'payment_numbers', type: 'jsonb', nullable: true },
      { name: 'owner_id', type: 'text', nullable: true },
      { name: 'store_code', type: 'text', nullable: true },
      { name: 'is_public', type: 'boolean', nullable: true, default: 'true' },
      { name: 'created_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
      { name: 'updated_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
    ],
    foreignKeys: [
      { column: 'company_id', refTable: 'companies', refColumn: 'id' },
    ],
  },
  {
    name: 'staff',
    columns: [
      { name: 'id', type: 'text', nullable: false },
      { name: 'company_id', type: 'text', nullable: true },
      { name: 'store_id', type: 'text', nullable: true },
      { name: 'department_id', type: 'text', nullable: true },
      { name: 'name', type: 'text', nullable: false },
      { name: 'phone', type: 'text', nullable: false },
      { name: 'email', type: 'text', nullable: true },
      { name: 'role', type: 'text', nullable: false },
      { name: 'employee_pin', type: 'text', nullable: true },
      { name: 'employee_id', type: 'text', nullable: true },
      { name: 'is_pin_verified', type: 'boolean', nullable: true, default: 'false' },
      { name: 'is_manager', type: 'boolean', nullable: true, default: 'false' },
      { name: 'is_active', type: 'boolean', nullable: true, default: 'true' },
      { name: 'auth_user_id', type: 'text', nullable: true },
      { name: 'pin_hash', type: 'text', nullable: true },
      { name: 'created_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
      { name: 'updated_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
    ],
    foreignKeys: [
      { column: 'company_id', refTable: 'companies', refColumn: 'id' },
      { column: 'store_id', refTable: 'stores', refColumn: 'id' },
    ],
  },
  {
    name: 'products',
    columns: [
      { name: 'id', type: 'text', nullable: false },
      { name: 'company_id', type: 'text', nullable: true },
      { name: 'store_id', type: 'text', nullable: false },
      { name: 'name', type: 'text', nullable: false },
      { name: 'description', type: 'text', nullable: true },
      { name: 'sku', type: 'text', nullable: true },
      { name: 'barcode', type: 'text', nullable: true },
      { name: 'category_id', type: 'text', nullable: true },
      { name: 'price', type: 'numeric', nullable: false },
      { name: 'cost_price', type: 'numeric', nullable: true },
      { name: 'stock_quantity', type: 'integer', nullable: true, default: '0' },
      { name: 'min_stock_level', type: 'integer', nullable: true, default: '0' },
      { name: 'unit', type: 'text', nullable: true },
      { name: 'image_url', type: 'text', nullable: true },
      { name: 'is_active', type: 'boolean', nullable: true, default: 'true' },
      { name: 'created_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
      { name: 'updated_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
    ],
    foreignKeys: [
      { column: 'company_id', refTable: 'companies', refColumn: 'id' },
      { column: 'store_id', refTable: 'stores', refColumn: 'id' },
    ],
  },
  {
    name: 'categories',
    columns: [
      { name: 'id', type: 'text', nullable: false },
      { name: 'company_id', type: 'text', nullable: true },
      { name: 'store_id', type: 'text', nullable: false },
      { name: 'name', type: 'text', nullable: false },
      { name: 'description', type: 'text', nullable: true },
      { name: 'parent_id', type: 'text', nullable: true },
      { name: 'is_active', type: 'boolean', nullable: true, default: 'true' },
      { name: 'created_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
      { name: 'updated_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
    ],
    foreignKeys: [
      { column: 'company_id', refTable: 'companies', refColumn: 'id' },
      { column: 'store_id', refTable: 'stores', refColumn: 'id' },
    ],
  },
  {
    name: 'sales',
    columns: [
      { name: 'id', type: 'text', nullable: false },
      { name: 'company_id', type: 'text', nullable: true },
      { name: 'store_id', type: 'text', nullable: false },
      { name: 'shift_id', type: 'text', nullable: true },
      { name: 'staff_id', type: 'text', nullable: true },
      { name: 'total_amount', type: 'numeric', nullable: false },
      { name: 'payment_method', type: 'text', nullable: true },
      { name: 'payment_status', type: 'text', nullable: true, default: "'completed'" },
      { name: 'notes', type: 'text', nullable: true },
      { name: 'created_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
      { name: 'updated_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
    ],
    foreignKeys: [
      { column: 'company_id', refTable: 'companies', refColumn: 'id' },
      { column: 'store_id', refTable: 'stores', refColumn: 'id' },
    ],
  },
  {
    name: 'shifts',
    columns: [
      { name: 'id', type: 'text', nullable: false },
      { name: 'status', type: 'text', nullable: false },
      { name: 'cashier_name', type: 'text', nullable: false },
      { name: 'cashier_id', type: 'text', nullable: true },
      { name: 'staff_id', type: 'text', nullable: true },
      { name: 'staff_phone', type: 'text', nullable: true },
      { name: 'company_id', type: 'text', nullable: true },
      { name: 'store_id', type: 'text', nullable: true },
      { name: 'role', type: 'text', nullable: true },
      { name: 'opening_cash', type: 'numeric', nullable: true },
      { name: 'closing_cash', type: 'numeric', nullable: true },
      { name: 'audit_locked', type: 'boolean', nullable: true, default: 'false' },
      { name: 'alert_status', type: 'text', nullable: true },
      { name: 'started_at', type: 'timestamptz', nullable: true },
      { name: 'ended_at', type: 'timestamptz', nullable: true },
      { name: 'created_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
      { name: 'updated_at', type: 'timestamptz', nullable: true, default: 'NOW()' },
    ],
    foreignKeys: [
      { column: 'company_id', refTable: 'companies', refColumn: 'id' },
      { column: 'store_id', refTable: 'stores', refColumn: 'id' },
    ],
  },
];

interface SchemaValidationResult {
  isValid: boolean;
  errors: string[];
  fixes: string[];
}

/**
 * Validate Supabase schema against required definition
 * Uses direct queries to check for missing tables and columns
 */
export async function validateSchema(): Promise<SchemaValidationResult> {
  if (!isSupabaseConfigured()) {
    return {
      isValid: false,
      errors: ['Supabase is not configured'],
      fixes: [],
    };
  }

  const errors: string[] = [];
  const fixes: string[] = [];

  for (const tableDef of REQUIRED_SCHEMA) {
    // Check if table exists by attempting a query
    const { error: tableError } = await supabase
      .from(tableDef.name)
      .select('*')
      .limit(1);

    if (tableError && (tableError.code === '42P01' || tableError.message?.includes('does not exist'))) {
      errors.push(`Table '${tableDef.name}' does not exist`);
      fixes.push(`CREATE TABLE ${tableDef.name}`);
      continue;
    }

    // Check columns by attempting to select each column
    for (const colDef of tableDef.columns) {
      const { error: colError } = await supabase
        .from(tableDef.name)
        .select(colDef.name)
        .limit(1);

      if (colError && (colError.code === '42703' || colError.message?.includes('column') || colError.message?.includes('does not exist'))) {
        errors.push(`Column '${colDef.name}' missing from table '${tableDef.name}'`);
        fixes.push(`ALTER TABLE ${tableDef.name} ADD COLUMN ${colDef.name} ${colDef.type.toUpperCase()}${colDef.default ? ` DEFAULT ${colDef.default}` : ''}${colDef.nullable ? '' : ' NOT NULL'}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    fixes,
  };
}

/**
 * Generate SQL to repair the schema
 * Returns SQL statements that need to be executed manually in Supabase SQL Editor
 */
export function generateRepairSQL(): string {
  const sqlStatements: string[] = [];

  for (const tableDef of REQUIRED_SCHEMA) {
    const columns = tableDef.columns
      .map(c => `${c.name} ${c.type.toUpperCase()}${c.nullable ? '' : ' NOT NULL'}${c.default ? ` DEFAULT ${c.default}` : ''}`)
      .join(', ');
    
    const fkConstraints = tableDef.foreignKeys
      ?.map(fk => `, FOREIGN KEY (${fk.column}) REFERENCES ${fk.refTable}(${fk.refColumn}) ON DELETE CASCADE`)
      .join('') || '';

    sqlStatements.push(`
-- Create table ${tableDef.name} if it doesn't exist
CREATE TABLE IF NOT EXISTS ${tableDef.name} (
  ${columns}${fkConstraints}
);

-- Add missing columns for ${tableDef.name}
${tableDef.columns.map(c => `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = '${tableDef.name}' AND column_name = '${c.name}'
  ) THEN
    ALTER TABLE ${tableDef.name} ADD COLUMN IF NOT EXISTS ${c.name} ${c.type.toUpperCase()}${c.default ? ` DEFAULT ${c.default}` : ''}${c.nullable ? '' : ' NOT NULL'};
  END IF;
END $$;
`).join('')}

-- Disable RLS for ${tableDef.name}
ALTER TABLE ${tableDef.name} DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "all" ON ${tableDef.name};
`);
  }

  return sqlStatements.join('\n');
}

/**
 * Ensure schema is valid before any operation
 * Returns repair SQL if schema is invalid (needs manual execution)
 */
export async function ensureSchemaValid(): Promise<{ isValid: boolean; repairSQL?: string }> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, skipping schema validation');
    return { isValid: false };
  }

  const validation = await validateSchema();
  
  if (!validation.isValid) {
    console.warn('Schema validation failed:', validation.errors);
    console.log('Generating repair SQL...');
    
    const repairSQL = generateRepairSQL();
    
    console.log('Please run the following SQL in Supabase SQL Editor to repair the schema:');
    console.log(repairSQL);
    
    return { 
      isValid: false, 
      repairSQL 
    };
  }
  
  return { isValid: true };
}
