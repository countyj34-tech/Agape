# Complete Supabase Setup Guide for Mthunzi POS

This guide provides everything needed to set up the Mthunzi POS system with Supabase for remote authentication and multi-tenant functionality.

## 🚀 Quick Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "Start your project"
3. Sign in with GitHub/Google
4. Create new organization (if needed)
5. Create new project:
   - Project name: `mthunzi-pos`
   - Database password: Generate strong password
   - Region: Choose closest to your users
   - Pricing tier: Free tier (to start)

### 2. Configure Environment Variables

Create `.env` file in your project root:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

Get these values from:
- Supabase Dashboard → Settings → API
- Copy the Project URL and anon key

### 3. Run Database Schema

1. Go to Supabase Dashboard → SQL Editor
2. Copy the entire contents of `complete-supabase-schema.sql`
3. Paste into SQL Editor
4. Click "Run" to execute

This will create:
- ✅ All tables (companies, stores, profiles, products, sales, etc.)
- ✅ Row Level Security (RLS) policies
- ✅ Database functions for authentication
- ✅ Triggers and indexes
- ✅ Proper relationships and constraints

### 4. Update Application Code

Replace your existing auth imports:

```tsx
// OLD
import { useAuth } from '@/contexts/AuthContext';

// NEW
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
```

### 5. Add Authentication Routes

Update your router to include:

```tsx
import { SupabaseSignupForm } from '@/components/auth/SupabaseSignupForm';
import { SupabaseLoginForm } from '@/components/auth/SupabaseLoginForm';

// Add routes
<Route path="/signup" element={<SupabaseSignupForm />} />
<Route path="/login" element={<SupabaseLoginForm />} />
```

### 6. Wrap App with Auth Provider

```tsx
// src/main.tsx or App.tsx
import { SupabaseAuthProvider } from '@/contexts/SupabaseAuthContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SupabaseAuthProvider>
      <App />
    </SupabaseAuthProvider>
  </React.StrictMode>
);
```

## 📋 Complete System Features

### 🔐 Authentication System
- **Multi-tenant**: Each company has isolated data
- **Remote login**: Email/phone + 6-digit PIN
- **User roles**: Admin, Owner, Manager, Staff
- **Company membership**: Users can belong to multiple companies
- **Store assignment**: Users can be assigned to specific stores

### 🏢 Multi-Tenant Architecture
- **Companies**: Root tenant with settings and configuration
- **Stores**: Branches/locations within companies
- **Profiles**: User profiles linked to auth.users
- **Memberships**: User-company relationships with roles
- **Row Level Security**: Complete data isolation

### 📦 Inventory Management
- **Products**: Multi-store inventory tracking
- **Categories**: Store-specific product categories
- **Stock movements**: Track all inventory changes
- **Low stock alerts**: Automatic notifications
- **Barcode support**: Product scanning and lookup

### 💰 Sales & Transactions
- **Sales processing**: Complete POS functionality
- **Payment methods**: Cash, card, mobile, credit
- **Customer management**: Customer accounts and ledgers
- **Receipt generation**: Automatic receipt numbers
- **Tax calculation**: Configurable tax rates

### 📊 Operations
- **Shift management**: Cashier shifts and reporting
- **Expenses tracking**: Business expense recording
- **Online orders**: E-commerce integration
- **Audit logging**: Complete activity tracking
- **Reports**: Sales summaries and analytics

## 🔧 Configuration Options

### Company Settings
```sql
-- Update company information
UPDATE companies 
SET 
  name = 'Your Business Name',
  currency = 'ZMW',
  tax_rate = 16.00,
  receipt_footer = 'Thank you for your business!'
WHERE id = 'your-company-id';
```

### User Management
```typescript
// Invite new staff member
const result = await inviteStaff(
  'staff@company.com',
  '0971234567',
  'staff',
  'company-id',
  'store-id'
);
```

### Store Configuration
```typescript
// Create new store
const { data } = await supabase
  .from('stores')
  .insert({
    company_id: 'company-id',
    name: 'Branch Office',
    location_name: 'Downtown',
    phone: '0971234567',
    address: '123 Main St'
  });
```

## 🛡️ Security Features

### Row Level Security (RLS)
- **Company isolation**: Users only see their company's data
- **Store filtering**: Staff only see assigned store data
- **Role-based access**: Different permissions by role
- **API protection**: All database calls protected

### Authentication Security
- **PIN-based login**: 6-digit secure PINs
- **Session management**: Automatic token refresh
- **Password policies**: PIN complexity requirements
- **Failed login tracking**: Brute force protection

### Data Protection
- **Encrypted connections**: HTTPS only
- **API key rotation**: Regular key updates
- **Audit trails**: Complete activity logging
- **Data backups**: Automatic Supabase backups

## 🚀 Deployment Guide

### Environment Setup
```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your Supabase credentials

# Start development server
npm run dev
```

### Production Deployment
```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

### Environment Variables for Production
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-production-anon-key
```

## 📱 Mobile & PWA Features

### Progressive Web App
- **Offline support**: Works without internet
- **App installation**: Install on mobile devices
- **Push notifications**: Real-time alerts
- **Responsive design**: Works on all screen sizes

### Mobile Optimization
- **Touch interfaces**: Mobile-friendly controls
- **Camera support**: Barcode scanning
- **Bluetooth printing**: Receipt printers
- **GPS location**: Store-based features

## 🔍 Testing Guide

### Development Testing
```bash
# Start development server
npm run dev

# Test with demo credentials
Email: admin@demo.com
PIN: 123456
```

### Database Testing
```sql
-- Test user creation
SELECT * FROM profiles WHERE email = 'test@example.com';

-- Test company data
SELECT * FROM companies WHERE owner_email = 'test@example.com';

-- Test RLS policies
SELECT * FROM sales WHERE company_id = 'test-company-id';
```

### API Testing
```typescript
// Test authentication
const result = await loginWithCredentials({
  emailOrPhone: 'admin@demo.com',
  pin: '123456'
});

// Test data access
const products = await supabase
  .from('products')
  .select('*');
```

## 🐛 Troubleshooting

### Common Issues

**"Supabase is not configured"**
- Check `.env` file exists
- Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Restart development server after changing env vars

**"Invalid login credentials"**
- Verify email/phone exists in database
- Check PIN is exactly 6 digits
- Ensure user is active and has membership

**"No data returned"**
- Check RLS policies are enabled
- Verify user has company membership
- Check store assignments

**"Permission denied"**
- Ensure RLS policies are properly configured
- Check user role and permissions
- Verify company membership is active

### Debug Tools
```typescript
// Check authentication status
const isAuth = await isAuthenticated();
console.log('Authenticated:', isAuth);

// Get current user profile
const profile = await getCurrentUserProfile();
console.log('Profile:', profile);

// Check Supabase connection
console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
```

## 📞 Support

### Documentation
- [Supabase Documentation](https://supabase.com/docs)
- [React Documentation](https://react.dev)
- [Vite Documentation](https://vitejs.dev)

### Common Solutions
1. **Clear browser cache** after schema changes
2. **Restart development server** after env changes
3. **Check browser console** for detailed errors
4. **Verify database schema** in Supabase dashboard

### Getting Help
- Check Supabase logs for database errors
- Review browser console for frontend errors
- Test with incognito window to rule out cache issues
- Verify all environment variables are set correctly

---

## ✅ Setup Complete Checklist

- [ ] Supabase project created
- [ ] Environment variables configured
- [ ] Database schema executed
- [ ] Authentication components integrated
- [ ] Auth provider wrapped around app
- [ ] Routes configured
- [ ] Development server running
- [ ] Login/signup working
- [ ] Data isolation verified
- [ ] Mobile responsive tested

Your Mthunzi POS system is now fully configured with Supabase for remote authentication and multi-tenant functionality!
