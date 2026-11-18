import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getRuntime } from "@/lib/env";
import { badRequest } from "@/lib/http";
import { sessionCookie, signSession } from "@/lib/session";
import { localVerify } from "@/lib/validators";

export async function POST(request: Request) {
  if (getRuntime().mode !== "local") {
    return badRequest("Local sign-in is only available when Supabase is not configured.");
  }
  const parsed = localVerify.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Enter the six-digit local development code.");
  const email = parsed.data.email.toLowerCase();
  const [row] = await query<{ user_id: string }>(
    `delete from public.local_login_codes
     where email = $1 and code = $2 and expires_at > pg_catalog.now()
     returning user_id`,
    [email, parsed.data.code],
  );
  if (!row) {
    return NextResponse.json({ error: "invalid_code", message: "That code is expired or incorrect." }, { status: 401 });
  }

  const admins = (process.env.LOCAL_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (admins.includes(email)) {
    await query(
      `insert into public.admin_users (user_id) values ($1) on conflict (user_id) do nothing`,
      [row.user_id],
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(), signSession(row.user_id, email), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
