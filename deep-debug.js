// Deep debug to find actual error source
console.log('🔍 DEEP DEBUG - FINDING ACTUAL ERROR');
console.log('');

console.log('1️⃣ CHECKING CURRENT SYSTEM STATE:');
console.log('');

// Test if service role key is actually working
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sotrgvahjouvelnsrsly.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdHJndmFoam91dmVsbnNyc2x5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjgzOTY1MCwiZXhwIjoyMDkyNDE1NjUwfQ.dl4XrsDr5unbl05KDM3hjNxHGpMVcjljoAswjxl5uzc';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function deepDebug() {
  console.log('2️⃣ TESTING SERVICE ROLE KEY AUTHENTICATION:');
  
  try {
    // Test 1: Can we even connect with service role?
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('count')
      .limit(1);
    
    if (error) {
      console.log('❌ Service role connection FAILED:', error.message);
      console.log('   → This means service role key is invalid');
      console.log('   → Or service role key has wrong permissions');
      return false;
    }
    
    console.log('✅ Service role connection: WORKING');
    
    // Test 2: Try admin user creation directly
    console.log('3️⃣ TESTING ADMIN USER CREATION DIRECTLY:');
    
    const testEmail = `test${Date.now()}@debug.com`;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: '123456',
      email_confirm: true,
      user_metadata: {
        full_name: 'Debug User',
        phone: '+260123456789',
        role: 'staff',
        company_id: 'debug-company',
        store_id: 'debug-store'
      }
    });
    
    if (authError) {
      console.log('❌ Admin user creation FAILED:', authError.message);
      if (authError.message.includes('rate limit')) {
        console.log('   → STILL GETTING RATE LIMIT!');
        console.log('   → This should NOT happen with admin API');
        console.log('   → Service role key might be wrong');
      }
      return false;
    }
    
    console.log('✅ Admin user creation: WORKING');
    console.log('   User ID:', authData.user.id);
    console.log('   Email:', authData.user.email);
    
    // Test 3: Clean up
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    console.log('✅ Cleanup: SUCCESS');
    
    return true;
    
  } catch (error) {
    console.log('❌ EXCEPTION:', error.message);
    return false;
  }
}

deepDebug().then(success => {
  console.log('');
  console.log('4️⃣ DIAGNOSIS:');
  
  if (success) {
    console.log('✅ Service role key: VALID');
    console.log('✅ Admin API: WORKING');
    console.log('✅ Rate limits: BYPASSED');
    console.log('');
    console.log('🔍 ISSUE IS IN YOUR FRONTEND CODE:');
    console.log('   → Check if createMember is actually being called');
    console.log('   → Check if context is properly updated');
    console.log('   → Check for TypeScript errors');
    console.log('   → Check browser console for actual error');
  } else {
    console.log('❌ Service role key: INVALID');
    console.log('❌ Admin API: NOT WORKING');
    console.log('❌ Root cause: SERVICE ROLE KEY ISSUE');
    console.log('');
    console.log('🔧 FIX NEEDED:');
    console.log('   → Get correct service role key from Supabase');
    console.log('   → Update .env file');
    console.log('   → Restart dev server');
  }
  
  console.log('');
  console.log('5️⃣ NEXT STEPS:');
  console.log('1. Check browser console for actual error messages');
  console.log('2. Test admin API directly (as above)');
  console.log('3. Fix the actual issue found');
  console.log('4. Verify fix works');
});
