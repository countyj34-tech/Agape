# Mthunzi Parallel - Inventory Intelligence System

## Overview

**Mthunzi Parallel** is an advanced inventory intelligence system designed to work alongside any existing Point of Sale (POS) system. It enables businesses to:

- Upload stock data from multiple file formats
- Automatically extract and analyze inventory information
- Generate professional reports with actionable insights
- Maintain audit trails and approval workflows
- Provide read-only dashboards for business clients

## Key Features

### 📤 Multi-Format File Upload
- **Excel** (.xlsx) - Spreadsheets with stock data
- **CSV** - Comma-separated values
- **PDF** - Document extraction
- **Images** (JPG/PNG) - OCR-ready for future enhancement

### 🤖 Automatic Data Processing
- Intelligent product name matching
- Quantity and pricing extraction
- Data validation and error detection
- Comprehensive processing logs

### 📊 Advanced Analytics
- Opening & Closing stock valuations
- Products Sold calculation
- Sales Value analysis
- Gross Profit computation
- Inventory Accuracy metrics
- Stock Variance tracking
- Missing Products identification
- Low Stock detection
- Top Selling Products ranking

### ✅ Approval Workflow
- Administrator review interface
- Approval/Rejection with notes
- Timestamp tracking
- Audit trail maintenance

### 👥 Client Dashboard (Read-Only)
- Professional report visualization
- Key metrics display
- Historical report access
- Charts and analytics
- Business performance insights

## System Architecture

### Database Schema

#### parallel_businesses
```sql
- id (UUID, PK)
- name (TEXT)
- owner_name, owner_phone, owner_email (TEXT)
- address, industry (TEXT)
- logo_url (TEXT)
- currency, currency_symbol (TEXT)
- admin_user_id (UUID, FK to auth.users)
- is_active (BOOLEAN)
- timestamps
```

#### parallel_branches
```sql
- id (UUID, PK)
- business_id (UUID, FK)
- name, location (TEXT)
- manager_name, manager_phone (TEXT)
- is_active (BOOLEAN)
- timestamps
```

#### dashboard_users
```sql
- id (UUID, PK)
- business_id (UUID, FK)
- name, email, phone (TEXT)
- role: 'viewer' | 'manager'
- password_hash (TEXT)
- is_active, last_login_at
- timestamps
- Constraint: Max 5 active users per business
```

#### uploaded_files
```sql
- id (UUID, PK)
- business_id, branch_id (UUID, FK)
- file_name (TEXT)
- file_format: 'xlsx' | 'csv' | 'pdf' | 'image' | 'unknown'
- file_size (INTEGER)
- file_url (TEXT - Supabase storage path)
- uploaded_by (TEXT)
- process_status: 'uploaded' | 'processing' | 'completed' | 'failed'
- error_message (TEXT)
- processed_data (JSONB - extracted structured data)
- timestamps
```

#### parallel_reports
```sql
- id (UUID, PK)
- business_id, branch_id (UUID, FK)
- report_date (DATE)
- report_type: 'daily' | 'weekly' | 'custom'
- uploaded_file_ids (UUID[])
- extracted_from (TEXT[])

Metrics:
- opening_stock_items, opening_stock_value (JSONB, NUMERIC)
- closing_stock_items, closing_stock_value (JSONB, NUMERIC)
- products_sold, quantity_sold (INTEGER)
- sales_value, gross_profit, gross_profit_margin (NUMERIC)
- inventory_accuracy (NUMERIC - percentage)
- missing_products, extra_products (TEXT[])
- low_stock_products, out_of_stock_products (JSONB)
- stock_variance (INTEGER)
- top_selling_products (JSONB)
- recommendations (TEXT[])

Approval:
- status: 'draft' | 'pending_approval' | 'approved' | 'rejected'
- prepared_by, approved_by (TEXT, UUID)
- approved_at, rejection_reason (TIMESTAMP, TEXT)

Distribution:
- report_url (TEXT - PDF path)
- shared_via_whatsapp (BOOLEAN)
- shared_at (TIMESTAMP)
- shared_with (TEXT[] - emails)

- timestamps
```

#### processing_logs
```sql
- id (UUID, PK)
- uploaded_file_id, report_id (UUID, FK)
- log_level: 'info' | 'warning' | 'error' | 'success'
- message (TEXT)
- details (JSONB)
- processed_at (TIMESTAMP)
- created_at (TIMESTAMP)
```

### Row Level Security (RLS)

**Administrators** can:
- View their own businesses and branches
- Upload and process files
- Create and manage reports
- Approve/reject reports
- Create dashboard users
- View all logs

**Dashboard Users** can:
- View only approved reports for their assigned business
- Cannot edit, delete, or download PDFs
- Cannot approve or generate reports
- Read-only access to metrics and analytics

## Usage Guide

### For Administrators

#### 1. Setup Business & Branches
```typescript
// Create a business
const business = await createParallelBusiness({
  name: 'Company Name',
  ownerName: 'Owner Name',
  ownerPhone: '+260971112222',
  ownerEmail: 'owner@company.com',
  currency: 'ZMW',
  currencySymbol: 'K',
  adminUserId: currentUserId,
  isActive: true,
});

// Create branches
const branch = await createParallelBranch({
  businessId: business.id,
  name: 'Main Store',
  location: 'Ndola',
  isActive: true,
});
```

#### 2. Upload Stock Data
Navigate to `/parallel/admin/upload`
- Select Business & Branch
- Upload Excel/CSV file
- System automatically:
  - Detects file format
  - Extracts stock data
  - Validates information
  - Creates processing log
  - Generates initial report

#### 3. Review & Approve Reports
Navigate to `/parallel/admin/approve`
- View pending reports
- Review metrics and analytics
- Check for data issues
- Approve (publish to clients) or Reject (with feedback)

#### 4. Manage Dashboard Users
Create up to 5 read-only users per business:
```typescript
const user = await createDashboardUser({
  businessId: business.id,
  name: 'Manager Name',
  email: 'manager@company.com',
  role: 'viewer',
  password: 'temp-password',
  isActive: true,
});
```

### For Business Clients

#### 1. Access Dashboard
Navigate to `/parallel/dashboard?businessId=xxx&branchId=yyy`

#### 2. View Approved Reports
- See today's official report (if approved)
- View previous reports
- Check key metrics
- Review performance charts
- Read recommendations

#### 3. Limitations
- Cannot modify any data
- Cannot download PDFs
- Cannot generate reports
- Read-only access only

## API Reference

### File Processing
```typescript
// Detect file format
detectFileFormat(fileName: string, mimeType?: string): FileFormat

// Process file
processFile(file: File): Promise<FileProcessingResult>

// Match products with database
matchProductsWithDatabase(
  extractedItems: ParallelReportItem[],
  databaseProducts: Product[]
): ParallelReportItem[]

// Validate extracted data
validateExtractedData(data: ExtractedStockData): { valid: boolean; errors: string[] }
```

### Supabase Operations
```typescript
// Businesses
createParallelBusiness(business): Promise<ParallelBusiness>
getParallelBusinesses(): Promise<ParallelBusiness[]>
getParallelBusiness(id): Promise<ParallelBusiness>
updateParallelBusiness(id, updates): Promise<ParallelBusiness>

// Branches
createParallelBranch(branch): Promise<ParallelBranch>
getBranchesByBusiness(businessId): Promise<ParallelBranch[]>

// Dashboard Users
createDashboardUser(user): Promise<DashboardUser>
getDashboardUsersByBusiness(businessId): Promise<DashboardUser[]>

// Files
uploadFile(file, businessId, branchId, uploadedBy): Promise<string>
createUploadedFile(fileData): Promise<UploadedFile>
getUploadedFilesByBranch(branchId): Promise<UploadedFile[]>
updateUploadedFile(id, updates): Promise<UploadedFile>

// Reports
createParallelReport(report): Promise<ParallelReport>
getReportsByBranch(branchId): Promise<ParallelReport[]>
getApprovedReportsByBranch(branchId): Promise<ParallelReport[]>
getLatestApprovedReport(branchId): Promise<ParallelReport>
updateParallelReport(id, updates): Promise<ParallelReport>

// Logs
createProcessingLog(log): Promise<ProcessingLog>
getProcessingLogsByFile(fileId): Promise<ProcessingLog[]>
```

### PDF Generation
```typescript
// Generate PDF blob
generateParallelReportPDF(args: {
  report: ParallelReport
  business: ParallelBusiness
  branch: ParallelBranch
}): Promise<Blob>

// Download PDF
downloadParallelReportPDF(args): Promise<void>

// Preload dependencies
preloadParallelPdfDeps(): Promise<any>
```

## Implementation Checklist

- ✅ Database schema with migrations
- ✅ TypeScript type definitions
- ✅ File processing service
- ✅ Supabase integration layer
- ✅ PDF generation utility
- ✅ Admin upload screen
- ✅ Admin approval screen
- ✅ Client dashboard screen
- ✅ App routing integration
- ⏳ Navigation UI integration (add menu items)
- ⏳ Excel library (xlsx) dependency
- ⏳ PDF.js library for PDF processing
- ⏳ Tesseract.js for image OCR (optional)
- ⏳ WhatsApp integration for sharing

## Performance Considerations

1. **File Upload Limits**
   - Maximum file size: 50MB
   - Chunked upload for large files (recommended)
   - Progress tracking

2. **Data Extraction**
   - Process in background worker (optional)
   - Timeout: 30 seconds per file
   - Fallback: Manual data entry

3. **Storage**
   - Use Supabase Storage for files
   - Implement cleanup for old files (30+ days)
   - Archive reports to cold storage

4. **Database**
   - Index on `business_id, status` for fast queries
   - Index on `report_date` for date filtering
   - Partition reports table by year

## Security Notes

1. **RLS Enabled** on all tables
2. **Admin-only** approval and generation
3. **Read-only** access for dashboard users
4. **Audit logging** for all operations
5. **File validation** before processing
6. **CORS** properly configured for file uploads

## Error Handling

### File Processing Errors
- Invalid file format
- Corrupted data
- Missing required columns
- Timeout during extraction
- Storage upload failure

### Report Generation Errors
- Insufficient data
- Invalid calculations
- PDF generation failure
- Approval conflicts

All errors are logged with:
- Timestamp
- Error level
- Detailed message
- Context data

## Future Enhancements

1. **Image OCR Integration**
   - Tesseract.js for browser-side OCR
   - Google Cloud Vision API
   - Automated receipt processing

2. **WhatsApp Integration**
   - Automated report sharing
   - Business messaging API
   - Delivery confirmations

3. **Advanced Analytics**
   - Trend analysis across months
   - Predictive inventory levels
   - Seasonal patterns

4. **Multi-language Support**
   - Report generation in multiple languages
   - Currency conversions
   - Localized date formats

5. **Mobile App**
   - Native iOS/Android apps
   - Offline capabilities
   - Mobile-optimized dashboards

## Deployment Notes

### Environment Variables Required
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Database Migration
Run migrations in Supabase SQL Editor:
```sql
-- Execute supabase-migrations/parallel_schema.sql
```

### Storage Setup
Create bucket in Supabase Storage:
```
Bucket name: pos-files
Public: false
```

## Support & Troubleshooting

### Common Issues

**"File upload failed"**
- Check file size (max 50MB)
- Verify file format support
- Check storage bucket permissions

**"No data extracted"**
- Verify file structure (headers, columns)
- Check for special characters
- Review processing logs

**"Report not showing on dashboard"**
- Ensure report is marked 'approved'
- Verify branch assignment
- Check user dashboard assignment

**"PDF download failing"**
- Verify jsPDF library loaded
- Check browser storage space
- Review browser console for errors

## License

Mthunzi Parallel is part of the Mthunzi POS Suite.
Proprietary - All rights reserved.

## Contact

For support or feature requests, contact:
- Email: support@mthunzi.tech
- Website: https://mthunzi.tech
