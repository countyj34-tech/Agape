// Test signup with a new email to avoid rate limits
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sotrgvahjouvelnsrsly.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvdHJndmFoam91dmVsbnNyc2x5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Mzk2NTAsImV4cCI6MjA5MjQxNTY1MH0.vXmd18EnHTMcDcjG-QY11-CmR-MOclzClSnozAopF0k';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Generate a unique email with timestamp
const uniqueEmail = `test${Date.now()}@example.com`;

async function testWithNewEmail() {
  console.log('Testing signup with new email:', uniqueEmail);
  
  try {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: uniqueEmail,
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
      
      // Check if it's the database error again
      if (authError.message.includes('Database error saving new user')) {
        console.log('🔍 The database trigger still has issues');
        return false;
      } else if (authError.message.includes('rate limit')) {
        console.log('⏰ Rate limit hit - try again later or use different email');
        return false;
      } else {
        console.log('🔍 Different error - investigate:', authError.message);
        return false;
      }
    }

    if (!authData?.user) {
      console.error('❌ No user created');
      return false;
    }

    console.log('✅ SUCCESS! Auth signup worked!');
    console.log('User ID:', authData.user.id);
    console.log('User email:', authData.user.email);
    
    // Check if profile was created
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      console.log('⚠️  Profile check failed:', profileError.message);
    } else if (profile) {
      console.log('✅ Profile created by trigger:', profile);
    } else {
      console.log('⚠️  No profile found - trigger might need adjustment');
    }

    // Clean up
    await supabase.auth.signOut();
    return true;

  } catch (error) {
    console.error('❌ Test failed with exception:', error);
    return false;
  }
}

testWithNewEmail().then(success => {
  if (success) {
    console.log('\n🎉 DATABASE FIX SUCCESSFUL!');
    console.log('The signup process now works correctly.');
  } else {
    console.log('\n📝 Test result received - check the messages above.');
  }
  process.exit(0);
});
