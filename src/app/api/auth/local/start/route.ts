import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getRuntime } from "@/lib/env";
import { badRequest } from "@/lib/http";
import { localEmail } from "@/lib/validators";

export async function POST(request: Request) {
  if (getRuntime().mode !== "local") {
    return badRequest("Local sign-in is only available when Supabase is not configured.");
  }
  const parsed = localEmail.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Enter a valid email address.");
  const email = parsed.data.email.toLowerCase();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  const [user] = await query<{ id: string }>(
    `insert into auth.users (id, email)
     values (pg_catalog.gen_random_uuid(), $1)
     on conflict (email) do update set email = excluded.email
     returning id`,
    [email],
  );
  await query(
    `insert into public.local_login_codes (email, code, user_id, expires_at)
     values ($1, $2, $3, pg_catalog.now() + interval '10 minutes')
     on conflict (email) do update
       set code = excluded.code, user_id = excluded.user_id, expires_at = excluded.expires_at`,
    [email, code, user.id],
  );

  return NextResponse.json({
    ok: true,
    devCode: code,
    message: "Local development code. It was not emailed.",
  });
}
