import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const runtime = getRuntime();
  if (runtime.mode === "supabase" && code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/board?error=auth", runtime.siteUrl));
    }
  }
  return NextResponse.redirect(new URL("/register", runtime.siteUrl));
}
