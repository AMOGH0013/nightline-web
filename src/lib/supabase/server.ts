import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getRuntime } from "@/lib/env";

export async function createSupabaseServer() {
  const runtime = getRuntime();
  if (runtime.mode !== "supabase" || !runtime.supabaseUrl || !runtime.supabaseAnonKey) {
    throw new Error("Supabase Auth is not configured.");
  }
  const cookieStore = await cookies();
  return createServerClient(runtime.supabaseUrl, runtime.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const cookie of toSet) cookieStore.set(cookie.name, cookie.value, cookie.options);
        } catch {
          // Server Components cannot always write cookies. The callback route can.
        }
      },
    },
  });
}
