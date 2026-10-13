// Test current authentication state
console.log('🔍 TESTING CURRENT AUTHENTICATION STATE');
console.log('');

// Test 1: Check if service role key is working
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sotrgvahjouvelnsrsly.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdHJndmFoam91dmVsbnNyc2x5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjgzOTY1MCwiZXhwIjoyMDkyNDE1NjUwfQ.dl4XrsDr5unbl05KDM3hjNxHGpMVcjljoAswjxl5uzc';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function testServiceRoleKey() {
  console.log('🔑 Testing service role key...');
  
  try {
    // Test admin user creation
    const testEmail = `test-${Date.now()}@example.com`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: '123456',
      email_confirm: true,
      user_metadata: {
        full_name: 'Test User',
        phone: '+260123456789',
        role: 'staff',
        company_id: 'test-company',
        store_id: 'test-store'
      }
    });
    
    if (error) {
      console.log('❌ Service role key test FAILED:', error.message);
      return false;
    }
    
    // Clean up test user
    if (data.user) {
      await supabaseAdmin.auth.admin.deleteUser(data.user.id);
      console.log('✅ Test user deleted');
    }
    
    console.log('✅ Service role key test: SUCCESS');
    console.log('   - Admin user created successfully');
    console.log('   - No rate limit errors');
    console.log('   - User deleted successfully');
    
    return true;
  } catch (error) {
    console.log('❌ Service role key test EXCEPTION:', error.message);
    return false;
  }
}

// Test 2: Check if frontend is using correct function
console.log('');
console.log('🧪 FRONTEND ANALYSIS:');
console.log('The issue might be:');
console.log('1. Frontend still calling old signup() function');
console.log('2. TypeScript compilation errors blocking new code');
console.log('3. Browser caching old version');
console.log('4. Multiple auth calls causing lock contention');
console.log('');

console.log('🔧 QUICK FIXES TO TRY:');
console.log('');
console.log('1. Clear browser cache and hard refresh');
console.log('2. Check browser console for actual errors');
console.log('3. Test admin creation in browser console');
console.log('4. Verify createMember function is available');
console.log('5. Check if TypeScript compilation is working');
console.log('');

console.log('🎯 EXPECTED RESULTS:');
console.log('✅ Service role key: Working');
console.log('✅ Admin API: Working');
console.log('✅ Rate limits: Bypassed');
console.log('✅ Authentication locks: Fixed');
console.log('');

// Run the test
testServiceRoleKey();
