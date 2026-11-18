import { NextResponse } from "next/server";
import { getRuntime } from "@/lib/env";
import { sessionCookie } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST() {
  const runtime = getRuntime();
  if (runtime.mode === "supabase") {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }
  const response = NextResponse.redirect(new URL("/", runtime.siteUrl), 303);
  response.cookies.set(sessionCookie(), "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
