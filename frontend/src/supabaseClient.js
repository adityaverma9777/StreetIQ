import { createClient } from '@supabase/supabase-js';

// These should be in .env in production
// For now we will use placeholders that the user will replace with their actual Supabase credentials
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('Error signing in anonymously:', error.message);
    return null;
  }
  return data;
}
