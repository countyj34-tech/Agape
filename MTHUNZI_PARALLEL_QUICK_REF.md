# Mthunzi Parallel - Quick Reference Guide

## 🚀 5-Minute Startup

### Step 1: Apply Database Migration
```bash
# In Supabase SQL Editor, run entire file:
supabase-migrations/parallel_schema.sql
```

### Step 2: Create Business Entity
```typescript
import { createParallelBusiness } from '@/lib/parallelSupabase';

const business = await createParallelBusiness({
  name: 'My Store',
  ownerName: 'Owner Name',
  ownerPhone: '+260971234567',
  ownerEmail: 'owner@email.com',
  currency: 'ZMW',
  currencySymbol: 'K',
  adminUserId: currentUser.id,
  isActive: true,
});
```

### Step 3: Create Branch
```typescript
import { createParallelBranch } from '@/lib/parallelSupabase';

const branch = await createParallelBranch({
  businessId: business.id,
  name: 'Ndola Branch',
  location: 'Ndola, Zambia',
  isActive: true,
});
```

### Step 4: Create Dashboard User
```typescript
import { createDashboardUser } from '@/lib/parallelSupabase';

const dashboardUser = await createDashboardUser({
  businessId: business.id,
  name: 'Store Manager',
  email: 'manager@store.com',
  role: 'viewer',
  password: 'temp-password-123',
  isActive: true,
});
```

### Step 5: Access Screens
- **Admin Upload**: `/parallel/admin/upload` (Admin only)
- **Admin Approval**: `/parallel/admin/approve` (Admin only)
- **Client Dashboard**: `/parallel/dashboard` (Read-only)

---

## 📁 File Structure

```
✅ COMPLETE IMPLEMENTATION

Types:
  src/types/pos.ts (ParallelBusiness, ParallelReport, etc.)

Services:
  src/lib/parallelFileProcessing.ts (Excel, CSV, PDF parsing)
  src/lib/parallelSupabase.ts (Database CRUD operations)
  src/lib/parallelReportPdf.ts (PDF generation)

UI Components:
  src/pages/ParallelAdminUploadScreen.tsx
  src/pages/ParallelAdminApprovalScreen.tsx
  src/pages/ParallelClientDashboard.tsx

Database:
  supabase-migrations/parallel_schema.sql (Tables & RLS)

Routes:
  src/App.tsx (Routes integrated)

Documentation:
  MTHUNZI_PARALLEL_README.md (Full API docs)
  MTHUNZI_PARALLEL_SETUP.md (Setup & troubleshooting)
  MTHUNZI_PARALLEL_IMPLEMENTATION.md (Implementation status)
  MTHUNZI_PARALLEL_QUICK_REF.md (This file)
```

---

## 🎯 Common Tasks

### Upload File Programmatically
```typescript
import { processFile, uploadFile } from '@/lib/parallelSupabase';

const file = e.target.files[0];
const extractedData = await processFile(file);
const storageUrl = await uploadFile(file, businessId, branchId, adminEmail);
```

### Query Reports by Branch
```typescript
import { getReportsByBranch, getApprovedReportsByBranch } from '@/lib/parallelSupabase';

const allReports = await getReportsByBranch(branchId);
const approvedReports = await getApprovedReportsByBranch(branchId);
```

### Approve a Report
```typescript
import { updateParallelReport } from '@/lib/parallelSupabase';

const updated = await updateParallelReport(reportId, {
  status: 'approved',
  approvedBy: adminUserId,
  approvedAt: new Date(),
});
```

### Reject a Report
```typescript
const rejected = await updateParallelReport(reportId, {
  status: 'rejected',
  rejectionReason: 'Data incomplete, please re-submit',
});
```

### Generate PDF
```typescript
import { generateParallelReportPDF } from '@/lib/parallelReportPdf';

const pdfBlob = await generateParallelReportPDF({
  report,
  business,
  branch,
});

// Download
const url = URL.createObjectURL(pdfBlob);
const link = document.createElement('a');
link.href = url;
link.download = `report-${reportDate}.pdf`;
link.click();
```

### Get Processing Logs
```typescript
import { getProcessingLogsByFile } from '@/lib/parallelSupabase';

const logs = await getProcessingLogsByFile(fileId);
logs.forEach(log => {
  console.log(`[${log.logLevel}] ${log.message}`);
});
```

---

## 🔐 Authentication & Authorization

### Admin Access
```typescript
// Automatically protected by <AdminGate> in routes
<AdminGate><ParallelAdminUploadScreen /></AdminGate>
```

### Dashboard User Access
```typescript
// Optional: Add authentication check
const canAccessDashboard = async (businessId, branchId, userId) => {
  const user = await getDashboardUser(userId);
  return user?.businessId === businessId;
};
```

---

## 📊 Report Metrics Reference

| Metric | Formula | Example |
|--------|---------|---------|
| **Products Sold** | COUNT(items where opening > closing) | 25 products |
| **Quantity Sold** | SUM(opening - closing) | 150 units |
| **Sales Value** | Opening Value - Closing Value | K2,500 |
| **Gross Profit** | Sales Value × 35% | K875 |
| **Inventory Accuracy** | (Matched Items / Total Items) × 100 | 98% |
| **Stock Variance** | Closing Qty - Expected Qty | -5 units |

---

## 🛠️ Configuration

### Change Colors (PDF)
Edit `src/lib/parallelReportPdf.ts`:
```typescript
const colors = {
  primary: '#10b981',    // Green
  secondary: '#3b82f6',  // Blue
  success: '#22c55e',    // Light green
  warning: '#f59e0b',    // Amber
  error: '#ef4444',      // Red
};
```

### Change File Size Limit
Edit `src/pages/ParallelAdminUploadScreen.tsx`:
```typescript
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB instead of 50MB
```

### Change Max Dashboard Users per Business
Edit `src/lib/parallelSupabase.ts`:
```typescript
const MAX_USERS_PER_BUSINESS = 10; // Instead of 5
```

### Change CSV Column Headers
Edit `src/lib/parallelFileProcessing.ts`:
```typescript
const PRODUCT_HEADERS = ['product', 'name', 'item', 'article'];
const QUANTITY_HEADERS = ['qty', 'quantity', 'units', 'amount'];
const PRICE_HEADERS = ['price', 'cost', 'unit_price', 'unitprice'];
```

---

## 🧪 Testing Commands

### Test File Processing
```bash
# Create test file
npm run test -- --grep "parseCSV"
npm run test -- --grep "processXLSX"
npm run test -- --grep "validateExtractedData"
```

### Test Report Generation
```bash
npm run test -- --grep "generateReport"
```

### Test API Endpoints
```bash
npm run test -- --grep "parallelSupabase"
```

---

## 📈 Performance Tips

### Optimize Queries
```typescript
// ✅ GOOD - Use specific fields
const reports = await db.table('parallel_reports')
  .where('status').equals('approved')
  .limit(10);

// ❌ AVOID - Fetch all data
const all = await db.table('parallel_reports').toArray();
```

### Lazy Load PDF Library
```typescript
// Preload when needed
import { preloadParallelPdfDeps } from '@/lib/parallelReportPdf';
await preloadParallelPdfDeps();
```

### Cache Business Data
```typescript
const cachedBusinesses = useMemo(
  () => getParallelBusinesses(),
  []
);
```

---

## 🐛 Debugging

### Enable Logging
```typescript
// In parallelSupabase.ts
const DEBUG = true;

if (DEBUG) {
  console.log('[PARALLEL]', message, data);
}
```

### Check Database
```sql
-- View all businesses
SELECT * FROM parallel_businesses;

-- View reports by status
SELECT status, COUNT(*) FROM parallel_reports GROUP BY status;

-- Check processing logs
SELECT * FROM processing_logs ORDER BY created_at DESC LIMIT 10;
```

### Monitor File Uploads
```typescript
// Track in browser console
const fileKey = `${businessId}-${branchId}-${Date.now()}`;
console.log('Upload started:', fileKey);
// ... processing ...
console.log('Upload completed:', fileKey);
```

---

## 🚨 Common Errors & Fixes

**Error**: "File upload failed"
- Check file size (< 50MB)
- Verify file format
- Check storage bucket permissions

**Error**: "No data extracted"
- Verify CSV/Excel column headers
- Check for missing data rows
- Review processing logs

**Error**: "Report not visible on dashboard"
- Ensure status = 'approved'
- Check user is assigned to business
- Verify branch assignment

**Error**: "PDF generation failed"
- Check jsPDF library loaded
- Clear browser cache
- Review browser console

---

## 📚 Related Documentation

**Full Documentation**: `MTHUNZI_PARALLEL_README.md`
- API Reference
- Feature Details
- Architecture
- Deployment Notes

**Setup Guide**: `MTHUNZI_PARALLEL_SETUP.md`
- Step-by-step setup
- File format specifications
- Troubleshooting
- Performance optimization

**Implementation Status**: `MTHUNZI_PARALLEL_IMPLEMENTATION.md`
- Component details
- Testing checklist
- Deployment steps
- Version history

---

## 🎓 Learning Path

### Beginner
1. Read: Mthunzi Parallel Overview in README
2. Setup: Follow setup guide
3. Test: Upload sample Excel file
4. View: Check dashboard

### Intermediate
1. Study: Database schema
2. Explore: Service layer code
3. Modify: Try customizing UI colors
4. Deploy: Push to production

### Advanced
1. Extend: Add custom calculations
2. Integrate: Connect WhatsApp API
3. Optimize: Implement caching
4. Monitor: Setup analytics

---

## ✅ Deployment Checklist

- [ ] Database migration applied
- [ ] Storage bucket created
- [ ] Dependencies installed
- [ ] Routes working
- [ ] Admin screens accessible
- [ ] File upload tested
- [ ] Report generation tested
- [ ] PDF download tested
- [ ] Dashboard displaying correctly
- [ ] Error handling working
- [ ] Logs visible
- [ ] Performance acceptable
- [ ] Security verified
- [ ] Documentation reviewed

---

## 📞 Quick Support

### Documentation
- API Docs: `MTHUNZI_PARALLEL_README.md`
- Setup: `MTHUNZI_PARALLEL_SETUP.md`
- Status: `MTHUNZI_PARALLEL_IMPLEMENTATION.md`
- Reference: `MTHUNZI_PARALLEL_QUICK_REF.md`

### Files
- Types: `src/types/pos.ts`
- Services: `src/lib/parallel*.ts`
- Screens: `src/pages/Parallel*.tsx`
- Schema: `supabase-migrations/parallel_schema.sql`

### Routes
- `/parallel/admin/upload` - Upload files
- `/parallel/admin/approve` - Approve reports
- `/parallel/dashboard` - Client view

---

## 🎉 You're All Set!

**Status**: ✅ Mthunzi Parallel is ready to use

**Next Steps**:
1. Apply database migration
2. Create test business
3. Upload sample file
4. Approve report
5. View on dashboard

**Questions?** See documentation files or review code comments.

---

*Last Updated: January 2025*  
*Version: 1.0.0*
