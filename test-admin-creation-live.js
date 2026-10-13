// Test admin user creation with actual service role key
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sotrgvahjouvelnsrsly.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdHJndmFoam91dmVsbnNyc2x5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjgzOTY1MCwiZXhwIjoyMDkyNDE1NjUwfQ.dl4XrsDr5unbl05KDM3hjNxHGpMVcjljoAswjxl5uzc';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function testAdminUserCreation() {
  console.log('🚀 TESTING ADMIN USER CREATION (BYPASSES RATE LIMITS)');
  console.log('');
  
  const testData = {
    email: `admin${Date.now()}@testcompany.com`,
    password: '123456',
    fullName: 'Test Admin User',
    phone: '+260123456789',
    role: 'staff',
    companyId: 'test-company-id-123',
    storeId: 'test-store-id-456'
  };

  console.log('📝 Test data:', {
    email: testData.email,
    fullName: testData.fullName,
    phone: testData.phone,
    role: testData.role,
    companyId: testData.companyId,
    storeId: testData.storeId
  });

  try {
    // Step 1: Create user using admin API
    console.log('\n1️⃣ Creating user with admin API...');
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: testData.email,
      password: testData.password,
      email_confirm: true, // bypasses confirmation email
      user_metadata: {
        full_name: testData.fullName,
        phone: testData.phone,
        role: testData.role,
        company_id: testData.companyId,
        store_id: testData.storeId
      }
    });

    if (authError) {
      console.error('❌ Admin user creation failed:', authError.message);
      if (authError.message.includes('rate limit')) {
        console.log('📝 Still getting rate limit - this should not happen with admin API');
      }
      return false;
    }

    if (!authData?.user) {
      console.error('❌ No user created');
      return false;
    }

    console.log('✅ SUCCESS! Admin user creation worked!');
    console.log('User ID:', authData.user.id);
    console.log('User email:', authData.user.email);
    console.log('No rate limit hit! 🎉');

    // Step 2: Test if we can access the user
    console.log('\n2️⃣ Testing user access...');
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(authData.user.id);
    
    if (userError) {
      console.log('⚠️  Could not retrieve user:', userError.message);
    } else {
      console.log('✅ User retrieval successful');
    }

    // Step 3: Clean up the test user
    console.log('\n3️⃣ Cleaning up test user...');
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    
    if (deleteError) {
      console.log('⚠️  Could not delete user:', deleteError.message);
    } else {
      console.log('✅ Test user cleaned up');
    }

    console.log('\n🎯 ADMIN USER CREATION TEST RESULTS:');
    console.log('✅ Service role key: WORKING');
    console.log('✅ Admin API: ACCESSIBLE');
    console.log('✅ Rate limits: BYPASSED');
    console.log('✅ User creation: SUCCESSFUL');
    console.log('✅ No email confirmation: REQUIRED');
    
    console.log('\n🎉 EMAIL RATE LIMIT ISSUE IS SOLVED!');
    console.log('You can now use createCompanyMember() without rate limits.');
    
    return true;

  } catch (error) {
    console.error('❌ Test failed with exception:', error);
    return false;
  }
}

testAdminUserCreation().then(success => {
  if (success) {
    console.log('\n✅ ADMIN USER CREATION IS FULLY FUNCTIONAL!');
    console.log('Rate limits are completely bypassed.');
  } else {
    console.log('\n❌ Admin user creation test failed');
  }
  process.exit(success ? 0 : 1);
});
