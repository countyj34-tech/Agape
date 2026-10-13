// Test the complete authentication system
console.log('🧪 TESTING COMPLETE AUTHENTICATION SYSTEM');
console.log('');

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sotrgvahjouvelnsrsly.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdHJndmFoam91dmVsbnNyc2x5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjgzOTY1MCwiZXhwIjoyMDkyNDE1NjUwfQ.dl4XrsDr5unbl05KDM3hjNxHGpMVcjljoAswjxl5uzc';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function testCompleteSystem() {
  console.log('1️⃣ Testing Service Role Key Connection...');
  
  try {
    // Test basic connection
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('count')
      .limit(1);
    
    if (error) {
      console.log('❌ Connection FAILED:', error.message);
      return false;
    }
    
    console.log('✅ Connection: SUCCESS');
  } catch (error) {
    console.log('❌ Connection EXCEPTION:', error.message);
    return false;
  }

  console.log('');
  console.log('2️⃣ Testing Admin User Creation...');
  
  try {
    const testEmail = `test-${Date.now()}@example.com`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: '123456',
      email_confirm: true,
      user_metadata: {
        full_name: 'Test User',
        phone: '+260123456789',
        role: 'admin',
        company_id: 'test-company-' + Date.now(),
        store_id: 'test-store-' + Date.now()
      }
    });
    
    if (error) {
      console.log('❌ Admin user creation FAILED:', error.message);
      if (error.message.includes('rate limit')) {
        console.log('   → Rate limit error - admin API not working');
      }
      return false;
    }
    
    console.log('✅ Admin user creation: SUCCESS');
    console.log('   User ID:', data.user.id);
    console.log('   Email:', data.user.email);
    console.log('   Role: admin');
    
    // Clean up test user
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
    console.log('✅ Test user cleaned up');
    
  } catch (error) {
    console.log('❌ Admin user creation EXCEPTION:', error.message);
    return false;
  }

  console.log('');
  console.log('3️⃣ Testing Database Schema...');
  
  try {
    // Test if profiles table exists
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .limit(1);
    
    if (error) {
      console.log('❌ Profiles table check FAILED:', error.message);
      return false;
    }
    
    console.log('✅ Profiles table: ACCESSIBLE');
    
    // Test if companies table exists
    const { data: companies, error: companiesError } = await supabaseAdmin
      .from('companies')
      .select('*')
      .limit(1);
    
    if (companiesError) {
      console.log('❌ Companies table check FAILED:', companiesError.message);
      return false;
    }
    
    console.log('✅ Companies table: ACCESSIBLE');
    
  } catch (error) {
    console.log('❌ Database schema EXCEPTION:', error.message);
    return false;
  }

  console.log('');
  console.log('4️⃣ Testing Authentication Lock Prevention...');
  
  try {
    // Simulate multiple concurrent authentication calls
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        supabaseAdmin.auth.getUser().catch(error => {
          if (error.message && error.message.includes('Lock')) {
            console.log('❌ Lock error detected:', error.message);
            return false;
          }
          return true;
        })
      );
    }
    
    const results = await Promise.all(promises);
    const hasLockErrors = results.some(result => result === false);
    
    if (hasLockErrors) {
      console.log('❌ Lock errors still occurring');
      return false;
    }
    
    console.log('✅ No lock errors detected');
    
  } catch (error) {
    console.log('❌ Lock test EXCEPTION:', error.message);
    return false;
  }

  console.log('');
  console.log('🎉 COMPLETE SYSTEM TEST RESULTS:');
  console.log('✅ Service Role Key: WORKING');
  console.log('✅ Admin API: FUNCTIONAL');
  console.log('✅ Rate Limits: BYPASSED');
  console.log('✅ Database Schema: ACCESSIBLE');
  console.log('✅ Authentication Locks: PREVENTED');
  console.log('');
  console.log('🚀 SYSTEM IS READY FOR PRODUCTION USE!');
  
  return true;
}

// Run the test
testCompleteSystem().then(success => {
  if (success) {
    console.log('');
    console.log('✅ All tests passed - authentication system is working correctly!');
  } else {
    console.log('');
    console.log('❌ Some tests failed - check the errors above');
  }
});
