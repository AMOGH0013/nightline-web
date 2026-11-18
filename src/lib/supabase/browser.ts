import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowser(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey);
}
