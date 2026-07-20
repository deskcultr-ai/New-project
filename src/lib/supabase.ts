import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: "pkce",
    // We handle the PKCE code exchange manually in /auth/callback to avoid
    // a race condition where detectSessionInUrl and our own exchangeCodeForSession
    // call both try to consume the one-time verifier simultaneously.
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  },
});
