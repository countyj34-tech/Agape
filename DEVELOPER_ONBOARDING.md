# Mthunzi Parallel - Developer Onboarding Guide

Welcome to the Mthunzi Parallel module! This guide will help you understand the system architecture and get started with development.

---

## 📖 Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Getting Started](#getting-started)
4. [Code Structure](#code-structure)
5. [Development Workflow](#development-workflow)
6. [Common Tasks](#common-tasks)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)

---

## System Overview

### What is Mthunzi Parallel?

Mthunzi Parallel is an **Inventory Intelligence System** that:
- Accepts stock data uploads (Excel, CSV, PDF)
- Automatically extracts and processes inventory information
- Generates detailed reports with metrics and analysis
- Provides admin approval workflow
- Offers read-only client dashboards

### Key Principle

**The module is completely separate from the main POS system.** It does NOT modify any existing functionality and operates independently.

### Users

1. **Business Owners** - Upload stock data files
2. **Administrators** - Review, approve, and manage reports
3. **Dashboard Users** - View approved reports (read-only)

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────┐
│           Mthunzi Parallel Module                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Upload Screen        Approval Screen              │
│  (Drag-drop)          (Review/Approve)             │
│      ↓                     ↓                        │
│  File Processing      Database Update              │
│  (Parse & Extract)    (Mark approved)              │
│      ↓                     ↓                        │
│  Validation          ← Supabase ←                  │
│      ↓                                              │
│  Database Store                                     │
│      ↓                                              │
│  Client Dashboard    ← Read Approved Reports       │
│  (View Metrics)                                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Technology Stack

- **Frontend**: React 18, TypeScript, Vite
- **UI**: shadcn/ui, Recharts, Lucide Icons
- **Backend**: Supabase (PostgreSQL + Auth + Storage)
- **File Processing**: xlsx, pdfjs-dist
- **PDF Gen**: jsPDF
- **Styling**: Tailwind CSS

---

## Getting Started

### 1. Clone & Setup

```bash
cd d:\mthunzi-pos-suite-main
npm install
```

### 2. Database Setup

Apply migrations in Supabase SQL Editor:
```sql
-- Copy entire file: supabase-migrations/parallel_schema.sql
-- Run in Supabase SQL Editor
```

This creates:
- `parallel_businesses`
- `parallel_branches`
- `dashboard_users`
- `uploaded_files`
- `parallel_reports`
- `processing_logs`

### 3. Environment

Verify `.env` has:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### 4. Install Dependencies

```bash
npm install xlsx pdfjs-dist
```

### 5. Start Dev Server

```bash
npm run dev
```

### 6. Access Routes

- **Admin Upload**: `http://localhost:5173/parallel/admin/upload`
- **Admin Approve**: `http://localhost:5173/parallel/admin/approve`
- **Client Dashboard**: `http://localhost:5173/parallel/dashboard`

---

## Code Structure

### Types (`src/types/pos.ts`)

All type definitions in one file:

```typescript
// Business entity
export interface ParallelBusiness {
  id: string;
  name: string;
  ownerName: string;
  adminUserId: string;
  // ... more fields
}

// Branch/store
export interface ParallelBranch {
  id: string;
  businessId: string;
  name: string;
  // ... more fields
}

// Report (main entity)
export interface ParallelReport {
  id: string;
  businessId: string;
  branchId: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  // Metrics
  openingStockValue: number;
  closingStockValue: number;
  salesValue: number;
  grossProfit: number;
  // ... more metrics
}

// Enums
export enum FileFormat {
  XLSX = 'xlsx',
  CSV = 'csv',
  PDF = 'pdf',
  IMAGE = 'image',
  UNKNOWN = 'unknown',
}

export enum ProcessingStatus {
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum ReportStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
```

**Why**: Centralized types ensure consistency across entire module.

---

### File Processing (`src/lib/parallelFileProcessing.ts`)

Handles file detection and data extraction:

```typescript
// Main entry point
export async function processFile(file: File): Promise<FileProcessingResult> {
  const format = detectFileFormat(file.name, file.type);
  
  switch (format) {
    case FileFormat.XLSX:
      return processXLSX(file);
    case FileFormat.CSV:
      return processCSV(file);
    case FileFormat.PDF:
      return processPDF(file);
    case FileFormat.IMAGE:
      return processImage(file);
    default:
      return { success: false, error: 'Unknown format' };
  }
}

// Format-specific processors
async function processXLSX(file: File): Promise<FileProcessingResult> {
  // 1. Read workbook
  // 2. Find sheet with data
  // 3. Detect product/qty/price columns
  // 4. Extract items
  // 5. Return structured data
}

async function processCSV(file: File): Promise<FileProcessingResult> {
  // 1. Read CSV text
  // 2. Parse rows
  // 3. Detect headers
  // 4. Map columns
  // 5. Return items
}

// Helper: Match extracted products with database
function matchProductsWithDatabase(
  extractedItems: ParallelReportItem[],
  databaseProducts: Product[]
): ParallelReportItem[] {
  // Fuzzy match each extracted product
  // Return with match status
}

// Helper: Validate extracted data
function validateExtractedData(data: ExtractedStockData): ValidationResult {
  // Check required fields
  // Verify data types
  // Check for anomalies
  // Return validation result
}
```

**Key Pattern**: Each processor returns a consistent `FileProcessingResult` type.

---

### Supabase Operations (`src/lib/parallelSupabase.ts`)

Database abstraction layer:

```typescript
// Organized by entity

// ===== BUSINESSES =====
export async function createParallelBusiness(
  business: ParallelBusiness
): Promise<ParallelBusiness | null> {
  try {
    const { data, error } = await supabase
      .from('parallel_businesses')
      .insert([business])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[PARALLEL] Error creating business:', err);
    return null;
  }
}

// List all businesses for current admin
export async function getParallelBusinesses(): Promise<ParallelBusiness[]> {
  // Query with current user filter
}

// ===== REPORTS =====
export async function createParallelReport(
  report: ParallelReport
): Promise<ParallelReport | null> {
  // Create with full metrics
}

export async function getReportsByBranch(
  branchId: string
): Promise<ParallelReport[]> {
  // Get all reports for branch
}

export async function getApprovedReportsByBranch(
  branchId: string
): Promise<ParallelReport[]> {
  // Get only approved reports
}

export async function updateParallelReport(
  id: string,
  updates: Partial<ParallelReport>
): Promise<ParallelReport | null> {
  // Update status, approval info, etc.
}

// ===== PROCESSING LOGS =====
export async function createProcessingLog(
  log: ProcessingLog
): Promise<ProcessingLog | null> {
  // Create audit trail entry
}
```

**Pattern**: 
- Functions check if Supabase is configured
- Return `null` on error with `console.error()` logging
- Caller responsible for showing toast notifications
- Type-safe with TypeScript inference

---

### PDF Generation (`src/lib/parallelReportPdf.ts`)

Professional report PDF creation:

```typescript
export async function generateParallelReportPDF(args: {
  report: ParallelReport;
  business: ParallelBusiness;
  branch: ParallelBranch;
}): Promise<Blob> {
  // 1. Create PDF instance
  const doc = new jsPDF();
  
  // 2. Add header
  doc.setFontSize(20);
  doc.text('Mthunzi Parallel', 20, 20);
  
  // 3. Add business info
  doc.setFontSize(12);
  doc.text(`Business: ${business.name}`, 20, 40);
  
  // 4. Add metrics cards
  drawMetricsCard(doc, 'Opening Stock', report.openingStockValue);
  
  // 5. Add tables and charts
  drawTopProductsTable(doc, report.topSellingProducts);
  
  // 6. Add footer
  doc.setFontSize(8);
  doc.text('Prepared by Mthunzi-Tech-Labs', 20, 280);
  
  // 7. Return blob
  return doc.output('blob');
}

export async function downloadParallelReportPDF(args): Promise<void> {
  const blob = await generateParallelReportPDF(args);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `report-${reportDate}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
```

**Note**: Uses existing jsPDF pattern from `eodPdf.ts`.

---

### UI Screens

#### 1. ParallelAdminUploadScreen.tsx

```typescript
export default function ParallelAdminUploadScreen() {
  // State
  const [selectedBusiness, setSelectedBusiness] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [files, setFiles] = useState<Map<string, UploadProgress>>();
  
  // Handlers
  const handleBusinessChange = async (id: string) => {
    setSelectedBusiness(id);
    const branches = await getBranchesByBusiness(id);
    setBranches(branches);
  };
  
  const handleFileDrop = async (droppedFiles: File[]) => {
    // For each file:
    // 1. Validate size
    // 2. Detect format
    // 3. Process data
    // 4. Upload to storage
    // 5. Create DB record
    // 6. Log results
  };
  
  return (
    <div>
      <Select value={selectedBusiness} onValueChange={handleBusinessChange}>
        {/* Business options */}
      </Select>
      
      <DropZone onDrop={handleFileDrop} />
      
      {/* Progress bars per file */}
      {files.map((file, key) => (
        <ProgressBar key={key} progress={file.progress} status={file.status} />
      ))}
    </div>
  );
}
```

**Key Features**:
- Cascading business → branch selection
- Multi-file upload with individual progress
- Real-time error feedback
- Toast notifications

---

#### 2. ParallelAdminApprovalScreen.tsx

```typescript
export default function ParallelAdminApprovalScreen() {
  // State
  const [selectedBusiness, setSelectedBusiness] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [reports, setReports] = useState<ParallelReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<ParallelReport | null>();
  
  // Handlers
  const handleApprove = async (reportId: string) => {
    await updateParallelReport(reportId, {
      status: 'approved',
      approvedBy: adminUserId,
      approvedAt: new Date(),
    });
    toast.success('Report approved!');
    loadReports(); // Refresh
  };
  
  const handleReject = async (reportId: string, reason: string) => {
    await updateParallelReport(reportId, {
      status: 'rejected',
      rejectionReason: reason,
    });
    toast.error('Report rejected');
    loadReports();
  };
  
  const handleDownloadPDF = async (reportId: string) => {
    const report = reports.find(r => r.id === reportId);
    const business = await getParallelBusiness(report.businessId);
    const branch = await getParallelBranch(report.branchId);
    
    await downloadParallelReportPDF({
      report,
      business,
      branch,
    });
  };
  
  return (
    <div>
      {/* Business & branch filters */}
      {/* Reports list */}
      {/* Report details dialog */}
      {/* Action buttons: Approve, Reject, Download PDF */}
    </div>
  );
}
```

**Key Features**:
- Filter by business/branch
- View pending reports
- Approve/reject with notes
- Download PDF
- See approval history

---

#### 3. ParallelClientDashboard.tsx

```typescript
export default function ParallelClientDashboard() {
  // Get latest approved report
  const report = await getLatestApprovedReport(branchId);
  
  return (
    <div>
      {/* Status indicator */}
      {report ? (
        <div>🟢 Official Report Ready</div>
      ) : (
        <div>🟡 Waiting for report</div>
      )}
      
      {/* Key metrics cards */}
      <MetricsCard title="Opening Stock" value={report.openingStockValue} />
      <MetricsCard title="Closing Stock" value={report.closingStockValue} />
      <MetricsCard title="Sales Value" value={report.salesValue} />
      <MetricsCard title="Gross Profit" value={report.grossProfit} />
      
      {/* Charts */}
      <BarChart data={report.topSellingProducts} />
      <BarChart data={report.stockPerformance} />
      
      {/* Issues & Recommendations */}
      <IssuesCard issues={report.inventoryIssues} />
      <RecommendationsCard recs={report.recommendations} />
      
      {/* Previous reports */}
      <HistoryList reports={previousReports} />
    </div>
  );
}
```

**Key Features**:
- Status indicator
- Key metrics display
- Interactive charts
- Issues highlighting
- Recommendations
- Report history
- **Read-only**: No edit/delete/download

---

## Development Workflow

### Adding a New Feature

**Example**: Add email notifications on report approval

1. **Update Type** (`src/types/pos.ts`)
```typescript
export interface ParallelReport {
  // existing fields...
  emailNotificationSent?: boolean;
  emailSentAt?: Date;
}
```

2. **Update Database** (in Supabase)
```sql
ALTER TABLE parallel_reports 
ADD COLUMN email_notification_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN email_sent_at TIMESTAMP;
```

3. **Create Service** (`src/lib/parallelEmail.ts`)
```typescript
export async function sendReportApprovalEmail(
  report: ParallelReport,
  dashboardUsers: DashboardUser[]
): Promise<boolean> {
  // Send email to all users
  // Update report.emailNotificationSent
  // Log results
}
```

4. **Update UI** (`src/pages/ParallelAdminApprovalScreen.tsx`)
```typescript
const handleApprove = async (reportId: string) => {
  const report = await updateParallelReport(reportId, {
    status: 'approved',
  });
  
  // NEW: Send emails
  await sendReportApprovalEmail(report, dashboardUsers);
  
  toast.success('Report approved and notifications sent!');
};
```

5. **Test**
- Approve a report
- Verify emails sent
- Check database fields updated
- Review logs

---

### Debugging Tips

#### 1. Enable Console Logging
```typescript
// In any service file
const DEBUG = true;

if (DEBUG) {
  console.log('[PARALLEL]', 'message', data);
}
```

#### 2. Check Processing Logs
```typescript
import { getProcessingLogsByFile } from '@/lib/parallelSupabase';

const logs = await getProcessingLogsByFile(fileId);
logs.forEach(log => console.log(log));
```

#### 3. Inspect Database
```sql
-- View all files
SELECT * FROM uploaded_files ORDER BY created_at DESC;

-- Check report status
SELECT id, status, rejection_reason FROM parallel_reports;

-- See processing logs
SELECT * FROM processing_logs ORDER BY created_at DESC LIMIT 20;
```

#### 4. Browser DevTools
- Console: Check for errors
- Network: Monitor API calls
- Storage: Inspect localStorage
- Application: Check IndexedDB (if using Dexie)

---

## Common Tasks

### Task 1: Create a Business Programmatically

```typescript
import { createParallelBusiness } from '@/lib/parallelSupabase';

const business = await createParallelBusiness({
  name: 'Test Store',
  ownerName: 'John Doe',
  ownerPhone: '+260971234567',
  ownerEmail: 'john@store.com',
  address: 'Ndola, Zambia',
  industry: 'Retail',
  currency: 'ZMW',
  currencySymbol: 'K',
  adminUserId: currentUser.id,
  isActive: true,
});

if (business) {
  console.log('Business created:', business.id);
}
```

### Task 2: Upload & Process File

```typescript
import { processFile, uploadFile, createUploadedFile } from '@/lib/parallelSupabase';

const file = /* from file input */;
const extractedData = await processFile(file);

if (extractedData.success) {
  const storageUrl = await uploadFile(
    file,
    businessId,
    branchId,
    adminEmail
  );
  
  const uploadRecord = await createUploadedFile({
    businessId,
    branchId,
    fileName: file.name,
    fileFormat: detectFileFormat(file.name),
    filePath: storageUrl,
    extractedData: extractedData.data,
    processStatus: 'completed',
  });
  
  console.log('File processed:', uploadRecord.id);
}
```

### Task 3: Generate & Download PDF

```typescript
import { downloadParallelReportPDF } from '@/lib/parallelReportPdf';

await downloadParallelReportPDF({
  report,
  business,
  branch,
});
```

### Task 4: Query Dashboard Users

```typescript
import { getDashboardUsersByBusiness } from '@/lib/parallelSupabase';

const users = await getDashboardUsersByBusiness(businessId);
console.log(`Found ${users.length} dashboard users`);

users.forEach(user => {
  console.log(`- ${user.name} (${user.email})`);
});
```

---

## Testing

### Unit Tests

```typescript
// src/lib/__tests__/parallelFileProcessing.test.ts

describe('parallelFileProcessing', () => {
  test('should detect Excel format', () => {
    const format = detectFileFormat('data.xlsx');
    expect(format).toBe(FileFormat.XLSX);
  });
  
  test('should parse CSV with headers', async () => {
    const csvText = 'Product,Qty,Price\nCoke,50,18.00';
    const result = await parseCSVData(csvText);
    expect(result.length).toBe(1);
    expect(result[0].productName).toBe('Coke');
  });
  
  test('should validate extracted data', () => {
    const data = { items: [...], openingValue: 1000 };
    const { valid, errors } = validateExtractedData(data);
    expect(valid).toBe(true);
    expect(errors.length).toBe(0);
  });
});
```

### Component Tests

```typescript
// src/pages/__tests__/ParallelAdminUploadScreen.test.tsx

describe('ParallelAdminUploadScreen', () => {
  test('should show business dropdown', () => {
    const { getByText } = render(<ParallelAdminUploadScreen />);
    expect(getByText('Select Business')).toBeInTheDocument();
  });
  
  test('should handle file drop', async () => {
    const { container } = render(<ParallelAdminUploadScreen />);
    const dropZone = container.querySelector('[data-testid="drop-zone"]');
    
    // Simulate file drop
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [mockFile] }
    });
    
    await waitFor(() => {
      expect(getByText('Upload complete')).toBeInTheDocument();
    });
  });
});
```

### Integration Tests

```typescript
// Test full workflow: upload → process → approve → view

test('full workflow', async () => {
  // 1. Create business
  const business = await createTestBusiness();
  
  // 2. Upload file
  const file = loadTestFile('sample.xlsx');
  const processed = await processFile(file);
  
  // 3. Create report
  const report = await createParallelReport({
    businessId: business.id,
    ...processed,
  });
  
  // 4. Approve
  await updateParallelReport(report.id, {
    status: 'approved',
  });
  
  // 5. Verify visible to clients
  const approved = await getApprovedReportsByBranch(branch.id);
  expect(approved.some(r => r.id === report.id)).toBe(true);
});
```

---

## Troubleshooting

### Problem: "File upload failed"

**Causes**:
1. File size > 50MB
2. Invalid file format
3. Storage bucket not found
4. Permission denied

**Debug**:
```typescript
console.log('File size:', file.size);
console.log('File type:', file.type);
console.log('Bucket exists:', await checkStorageBucket('pos-files'));
```

---

### Problem: "No data extracted"

**Causes**:
1. Missing column headers
2. Empty file
3. Unsupported format
4. Corrupted data

**Debug**:
```typescript
const format = detectFileFormat(file.name);
console.log('Detected format:', format);

if (format === FileFormat.XLSX) {
  const workbook = XLSX.read(file, { header: 1 });
  console.log('Sheet names:', workbook.SheetNames);
  console.log('First row:', workbook.Sheets[workbook.SheetNames[0]][0]);
}
```

---

### Problem: "Report not showing on dashboard"

**Causes**:
1. Report status not 'approved'
2. Wrong branch assigned
3. User not assigned to business

**Debug**:
```typescript
const report = await getParallelReport(reportId);
console.log('Status:', report.status);
console.log('Branch:', report.branchId);

const user = await getDashboardUser(userId);
console.log('User business:', user.businessId);
```

---

### Problem: "Slow PDF generation"

**Solutions**:
1. Preload jsPDF:
```typescript
await preloadParallelPdfDeps();
```

2. Generate in background:
```typescript
const blob = await generateParallelReportPDF({...});
// Show toast while generating
```

3. Cache frequently used reports:
```typescript
const cachedReports = useMemo(
  () => getApprovedReportsByBranch(branchId),
  [branchId]
);
```

---

## Resources

### Documentation Files
- `MTHUNZI_PARALLEL_README.md` - Full API reference
- `MTHUNZI_PARALLEL_SETUP.md` - Setup & configuration
- `MTHUNZI_PARALLEL_QUICK_REF.md` - Quick reference
- `MTHUNZI_PARALLEL_IMPLEMENTATION.md` - Implementation details

### External Documentation
- [React Docs](https://react.dev)
- [TypeScript Docs](https://www.typescriptlang.org)
- [Supabase Docs](https://supabase.com/docs)
- [shadcn/ui](https://ui.shadcn.com)
- [Recharts](https://recharts.org)

### Code References
- Existing POS code: `src/pages/`, `src/lib/`
- Similar patterns: `src/lib/supabase.ts`, `src/lib/eodPdf.ts`

---

## Key Takeaways

1. **Modular Design**: Each service has a single responsibility
2. **Type Safety**: Full TypeScript coverage prevents runtime errors
3. **Error Handling**: Consistent patterns across all services
4. **Documentation**: Code is well-commented and documented
5. **Separation of Concerns**: UI, services, and types are independent
6. **RLS Security**: All operations respect database security policies
7. **User Experience**: Toast notifications and progress feedback throughout

---

## Next Steps

1. Read the documentation files
2. Explore the existing code
3. Create a test business
4. Upload a sample file
5. Test the approval workflow
6. View the dashboard
7. Customize for your needs

---

**Happy developing! 🚀**

For questions, refer to documentation or review the code comments.

---

*Version: 1.0.0*  
*Last Updated: January 2025*
