import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getRuntime } from "@/lib/env";

export function createSupabaseAdmin() {
  const runtime = getRuntime();
  if (runtime.mode !== "supabase" || !runtime.supabaseUrl || !runtime.serviceRoleKey) {
    throw new Error("The Supabase service role key is only available on the server.");
  }
  return createClient(runtime.supabaseUrl, runtime.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
