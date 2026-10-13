# Mthunzi Parallel - Setup & Integration Guide

## Quick Start (5 Minutes)

### 1. Database Setup
Apply the SQL migration to create all tables:

```bash
# In Supabase SQL Editor, run:
supabase-migrations/parallel_schema.sql
```

This creates:
- `parallel_businesses` - Business entities
- `parallel_branches` - Store locations
- `dashboard_users` - Read-only client users
- `uploaded_files` - File tracking
- `parallel_reports` - Generated reports
- `processing_logs` - Audit trail

### 2. Install Dependencies (if not already installed)

```bash
npm install xlsx pdfjs-dist
# or
yarn add xlsx pdfjs-dist
```

These are used for:
- **xlsx**: Excel file processing
- **pdfjs-dist**: PDF text extraction

### 3. Create Admin Business

In your admin panel or via API:

```typescript
import { createParallelBusiness, createParallelBranch } from '@/lib/parallelSupabase';

// Create business
const business = await createParallelBusiness({
  name: 'Sample Store',
  ownerName: 'John Doe',
  ownerPhone: '+260971234567',
  ownerEmail: 'john@store.com',
  currency: 'ZMW',
  currencySymbol: 'K',
  adminUserId: currentUser.id,
  isActive: true,
});

// Create branch
const branch = await createParallelBranch({
  businessId: business.id,
  name: 'Main Branch',
  location: 'Ndola',
  isActive: true,
});
```

### 4. Access Admin Features

Navigate to:
- **Upload Files**: `/parallel/admin/upload`
- **Approve Reports**: `/parallel/admin/approve`

### 5. Create Dashboard Users

```typescript
import { createDashboardUser } from '@/lib/parallelSupabase';

const dashboardUser = await createDashboardUser({
  businessId: business.id,
  name: 'Store Manager',
  email: 'manager@store.com',
  role: 'viewer',
  password: 'temp-password',
  isActive: true,
});
```

### 6. Client Access

Share with clients:
- **URL**: `/parallel/dashboard?businessId=${businessId}&branchId=${branchId}`
- **Login**: Dashboard user email + password

---

## File Processing Workflow

### Supported Formats

#### Excel (.xlsx)
**Required columns** (case-insensitive):
- Product Name / Product / Item
- Quantity / Qty / Qty Received
- Unit Price / Price / Cost

**Example:**
```
| Product          | Quantity | Unit Price |
|------------------|----------|------------|
| Coca-Cola 500ml  | 50       | 18.00      |
| Fanta Orange     | 45       | 18.00      |
| Simba Chips      | 5        | 15.00      |
```

#### CSV Format
**Same column structure as Excel**

```csv
Product,Quantity,Unit Price
Coca-Cola 500ml,50,18.00
Fanta Orange,45,18.00
Simba Chips,5,15.00
```

#### PDF
- Simple text extraction
- Looks for number patterns
- Requires tabular layout
- Manual review recommended

#### Images (JPG/PNG)
- Requires OCR integration (future)
- Currently returns error with setup instructions

### Data Extraction Process

```
1. Upload File
   ↓
2. Detect Format
   ↓
3. Parse Data
   ↓
4. Validate
   ↓
5. Create Report
   ↓
6. Log Results
```

### Processing Status Codes

- `uploaded` - File received
- `processing` - Being analyzed
- `completed` - Successfully processed
- `failed` - Error occurred (see error_message)

---

## Report Generation

### Automatic Calculations

**Products Sold**
```
= COUNT(items where opening_qty > closing_qty)
```

**Quantity Sold**
```
= SUM(opening_qty - closing_qty for all products)
```

**Sales Value**
```
= Opening Stock Value - Closing Stock Value
```

**Gross Profit** (estimated)
```
= Sales Value × 0.35  (35% average margin)
```

**Inventory Accuracy**
```
= (Matched Items / Total Items) × 100
```

**Missing Products**
```
= Products in Opening Stock but not in Closing Stock
```

**Extra Products**
```
= Products in Closing Stock but not in Opening Stock
```

---

## Admin Approval Workflow

### Steps

1. **Review Report**
   - Check metrics
   - Verify calculations
   - Review issues
   - Read recommendations

2. **Approve**
   - Report marked as "approved"
   - Timestamp recorded
   - Admin user ID logged
   - Becomes visible to clients

3. **Reject**
   - Provide feedback reason
   - Report marked as "rejected"
   - Can be re-uploaded
   - Not visible to clients

### Approval Checklist

- [ ] Opening stock values accurate
- [ ] Closing stock values accurate
- [ ] Product matching looks correct
- [ ] Calculations make sense
- [ ] No obvious data errors
- [ ] Recommendations are helpful
- [ ] Report is ready to share

---

## Client Dashboard Features

### What Clients See (Read-Only)

✅ Approved reports only
✅ Key metrics (opening, closing, sales, profit)
✅ Performance charts
✅ Top selling products
✅ Inventory issues
✅ Recommendations
✅ Historical reports

### What Clients Cannot Do

❌ Edit any data
❌ Download PDFs
❌ Generate new reports
❌ Delete reports
❌ Export data
❌ Approve/reject reports

### Dashboard Layout

```
Header
├─ Business Name
├─ Branch Name
└─ Report Date

Status Card
├─ 🟢 Official Report Ready
├─ Approval Date
└─ Prepared By: Mthunzi

Key Metrics (4 Cards)
├─ Opening Stock
├─ Closing Stock
├─ Sales Value
└─ Gross Profit

Performance Indicators (3 Cards)
├─ Products Sold
├─ Inventory Accuracy
└─ Stock Variance

Charts
├─ Top Selling Products (Bar)
└─ Stock Performance (Bar)

Issues & Recommendations
├─ Inventory Issues (if any)
└─ Recommendations (top 3)

Previous Reports (Table)
└─ Clickable history

Footer
└─ Read-only notice
```

---

## Data Flow Diagram

```
Business Owner
     ↓
Upload Excel/CSV
     ↓
Mthunzi Parallel
├─ Parse file
├─ Extract data
├─ Validate
└─ Create report
     ↓
Administrator
├─ Review report
├─ Check metrics
└─ Approve/Reject
     ↓
✅ APPROVED
     ↓
Supabase Database
├─ Update report status
├─ Mark as approved
└─ Set approval timestamp
     ↓
Dashboard Users
├─ See report on dashboard
├─ View metrics
├─ Review charts
└─ Read-only access
```

---

## Troubleshooting

### Upload Issues

**"File is too large"**
- Max size: 50MB
- Compress Excel or split data

**"Unsupported file format"**
- Use: Excel, CSV, PDF, JPG, PNG
- Check file extension

**"No data extracted"**
- Check column headers
- Verify data format
- Review processing log

### Report Issues

**"Missing required data"**
- Need both opening and closing stock
- Check for empty columns

**"Calculations look wrong"**
- Verify source data
- Check product prices
- Review matching results

**"Report not showing on dashboard"**
- Must be marked "approved"
- User must be assigned to business
- Try refreshing browser

### Performance Issues

**"Upload is slow"**
- File might be large
- Check internet connection
- Try splitting data

**"Dashboard loads slowly"**
- Clear browser cache
- Check network tab
- Verify Supabase connection

---

## Advanced Configuration

### Customize Report Template

Edit `src/lib/parallelReportPdf.ts`:

```typescript
// Change colors
const colors = {
  primary: '#10b981',    // Green
  secondary: '#3b82f6',  // Blue
  success: '#22c55e',    // Light green
};

// Modify layout
doc.setFontSize(14);     // Change sizes
doc.setTextColor(0, 0, 0); // Change colors

// Add company logo
doc.addImage(logoUrl, 'JPEG', x, y, width, height);
```

### Custom Calculations

Add to `calculateAuditMetrics()` in `src/lib/parallelFileProcessing.ts`:

```typescript
// Custom profit calculation
const customProfit = salesValue * businessMarginPercent / 100;

// Custom accuracy formula
const customAccuracy = (matchedItems / totalItems) * 100;
```

### Email Integration

Add to approval workflow:

```typescript
// After approving report
await sendEmail({
  to: 'client@email.com',
  subject: `New Report: ${reportDate}`,
  body: `Your official report is ready at /parallel/dashboard`,
});
```

---

## Security Best Practices

### For Administrators

1. ✅ Use strong passwords
2. ✅ Enable 2FA on Supabase
3. ✅ Review processing logs regularly
4. ✅ Verify file contents before approval
5. ✅ Keep client emails updated

### For Dashboard Users

1. ✅ Share read-only links only
2. ✅ Don't expose PDF download links
3. ✅ Rotate passwords regularly
4. ✅ Use separate credentials per business
5. ✅ Monitor access logs

### System Security

1. ✅ RLS enabled on all tables
2. ✅ File validation before processing
3. ✅ Audit logs for all operations
4. ✅ CORS properly configured
5. ✅ Rate limiting on uploads

---

## Performance Optimization

### Database

```sql
-- Add indexes for common queries
CREATE INDEX idx_parallel_reports_approval 
ON parallel_reports(status, approved_at);

CREATE INDEX idx_uploaded_files_processing
ON uploaded_files(process_status, created_at);
```

### Frontend

```typescript
// Lazy load chart libraries
const BarChart = lazy(() => import('recharts').then(m => ({ default: m.BarChart })));

// Virtualize long lists
import { FixedSizeList } from 'react-window';
```

### Storage

```typescript
// Compress PDFs before storage
const compressedPdf = await compressPdf(blob);

// Delete old files after 90 days
const deleteOldFiles = async () => {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  // Delete logic
};
```

---

## Monitoring & Logs

### View Processing Logs

```typescript
const logs = await getProcessingLogsByFile(fileId);

logs.forEach(log => {
  console.log(`[${log.level}] ${log.message}`, log.details);
});
```

### Monitor Report Status

```
Dashboard:
/admin/parallel/reports → Shows all reports with status

Search: Use filters for
- Date range
- Business
- Branch
- Status (approved, pending, rejected)
```

### Check System Health

```sql
-- Count uploaded files by status
SELECT process_status, COUNT(*) as count
FROM uploaded_files
GROUP BY process_status;

-- Recent reports
SELECT * FROM parallel_reports
ORDER BY created_at DESC
LIMIT 10;
```

---

## FAQ

**Q: Can I upload multiple files at once?**
A: Yes, the upload screen accepts multiple files and processes them sequentially.

**Q: What happens if the admin rejects a report?**
A: The rejection reason is recorded, and the report returns to draft status. The business must re-upload the file.

**Q: Can clients modify the dashboard layout?**
A: No, dashboard is read-only. Layout is fixed for security and consistency.

**Q: How long are files stored?**
A: Currently indefinite. Recommend implementing cleanup after 90 days (see optimization guide).

**Q: Can I export reports?**
A: Yes, download PDF from approval screen. Clients cannot export.

**Q: Is there a free tier?**
A: Mthunzi Parallel works with existing Supabase projects. Check Supabase pricing.

---

## Deployment Checklist

- [ ] Database migrations applied
- [ ] Dependencies installed (xlsx, pdfjs-dist)
- [ ] Environment variables configured
- [ ] Storage bucket created
- [ ] RLS policies enabled
- [ ] Test file upload/processing
- [ ] Test admin approval workflow
- [ ] Test client dashboard access
- [ ] PDF generation tested
- [ ] Error handling verified
- [ ] Logs reviewed
- [ ] Performance tested
- [ ] Security audit completed
- [ ] Documentation reviewed
- [ ] Team training completed

---

## Next Steps

1. **Run Database Migration**
   - Execute SQL in Supabase

2. **Configure Environment**
   - Set Supabase URL and key

3. **Test Upload Flow**
   - Use sample Excel file

4. **Create Test Business**
   - Set up test data

5. **Review Admin Panel**
   - Test approval workflow

6. **Configure Dashboard**
   - Create test users

7. **Launch**
   - Share with first businesses

---

For detailed API documentation, see: `MTHUNZI_PARALLEL_README.md`
