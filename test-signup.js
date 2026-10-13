// Test signup functionality
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sotrgvahjouvelnsrsly.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdHJndmFoam91dmVsbnNyc2x5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Mzk2NTAsImV4cCI6MjA5MjQxNTY1MH0.vXmd18EnHTMcDcjG-QY11-CmR-MOclzClSnozAopF0k';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testSignup() {
  console.log('Testing signup...');
  
  const testData = {
    email: 'test@example.com',
    phone: '+260123456789',
    pin: '123456',
    companyName: 'Test Company',
    companyPhone: '+260987654321',
    companyEmail: 'company@example.com',
    companyAddress: 'Test Address',
    currency: 'ZMW'
  };

  try {
    // Step 1: Test auth signup
    console.log('Step 1: Testing auth signup...');
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: testData.email,
      password: testData.pin,
      options: {
        data: {
          phone: testData.phone,
          role: 'admin',
          full_name: testData.companyName
        }
      }
    });

    if (authError) {
      console.error('Auth signup failed:', authError);
      return;
    }

    console.log('Auth signup successful:', authData);

    if (!authData?.user) {
      console.error('No user created');
      return;
    }

    // Step 2: Test company creation
    console.log('Step 2: Testing company creation...');
    const companyId = crypto.randomUUID();
    const { error: companyError } = await supabase
      .from('companies')
      .insert({
        id: companyId,
        name: testData.companyName,
        owner_email: testData.email,
        owner_phone: testData.companyPhone,
        address: testData.companyAddress,
        currency: testData.currency,
        currency_symbol: testData.currency === 'ZMW' ? 'K' : testData.currency,
        base_currency: testData.currency,
        tax_rate: 0,
        sales_tax_mode: 'none',
        sales_tax_rate: 0,
        single_item_margin_percent: 0,
        receipt_footer: '',
        thermal_printer_width: '58mm',
        plan: 'free',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (companyError) {
      console.error('Company creation failed:', companyError);
      return;
    }

    console.log('Company creation successful');

    // Step 3: Test store creation
    console.log('Step 3: Testing store creation...');
    const storeId = crypto.randomUUID();
    const { error: storeError } = await supabase
      .from('stores')
      .insert({
        id: storeId,
        company_id: companyId,
        name: testData.companyName + ' - Main Store',
        location_name: 'Main Location',
        address: testData.companyAddress,
        phone: testData.companyPhone,
        currency: testData.currency,
        currency_symbol: testData.currency === 'ZMW' ? 'K' : testData.currency,
        is_public: true,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (storeError) {
      console.error('Store creation failed:', storeError);
      return;
    }

    console.log('Store creation successful');

    // Step 4: Test profile update (trigger should have created it)
    console.log('Step 4: Testing profile update...');
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        full_name: testData.companyName,
        phone: testData.phone,
        role: 'admin',
        company_id: companyId,
        store_id: storeId,
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', authData.user.id);

    if (profileError) {
      console.error('Profile update failed:', profileError);
      return;
    }

    console.log('Profile update successful');

    // Step 5: Test membership creation
    console.log('Step 5: Testing membership creation...');
    const { error: membershipError } = await supabase
      .from('memberships')
      .insert({
        user_id: authData.user.id,
        company_id: companyId,
        role: 'admin',
        store_id: storeId,
        is_active: true,
        joined_at: new Date().toISOString()
      });

    if (membershipError) {
      console.error('Membership creation failed:', membershipError);
      return;
    }

    console.log('Membership creation successful');
    console.log('All tests passed! Signup flow is working correctly.');

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testSignup();
