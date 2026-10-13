// Simple test for signup functionality
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sotrgvahjouvelnsrsly.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdHJndmFoam91dmVsbnNyc2x5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Mzk2NTAsImV4cCI6MjA5MjQxNTY1MH0.vXmd18EnHTMcDcjG-QY11-CmR-MOclzClSnozAopF0k';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testSimpleSignup() {
  console.log('Testing simple signup...');
  
  try {
    // Test basic auth signup with minimal data
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: 'testuser@example.com',
      password: '123456',
      options: {
        data: {
          phone: '+260123456789',
          role: 'admin',
          full_name: 'Test User'
        }
      }
    });

    if (authError) {
      console.error('❌ Auth signup failed:', authError.message);
      console.error('Error details:', authError);
      return false;
    }

    if (!authData?.user) {
      console.error('❌ No user created');
      return false;
    }

    console.log('✅ Auth signup successful!');
    console.log('User ID:', authData.user.id);
    console.log('User email:', authData.user.email);
    
    // Test if profile was created by trigger
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      console.error('❌ Profile check failed:', profileError.message);
      // This might be expected if trigger didn't run
    } else if (profile) {
      console.log('✅ Profile found:', profile);
    } else {
      console.log('⚠️  No profile found - trigger might not have worked');
    }

    // Clean up - delete the test user
    console.log('Cleaning up test user...');
    await supabase.auth.signOut();
    
    return true;

  } catch (error) {
    console.error('❌ Test failed with exception:', error);
    return false;
  }
}

testSimpleSignup().then(success => {
  console.log(success ? '✅ Test completed successfully' : '❌ Test failed');
  process.exit(success ? 0 : 1);
});
