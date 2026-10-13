import { supabase } from './supabaseClient';

export async function getTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*');

  if (error) {
    console.error('Failed to load transactions:', error);
    return null;
  }

  console.log('Transactions:', data);
  return data;
}
