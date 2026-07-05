import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase server client — SSR, ANON key only (AD-10).
 * Safe to call in React Server Components.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url === undefined || anonKey === undefined) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createSupabaseClient(url, anonKey);
}
