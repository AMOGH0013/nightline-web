import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeUsernameLookupLimit, requestPendingBoarding } from "@/lib/passengers";
import { normalizeInstagramUsername } from "@/lib/follower-import-format";

const input = z.object({ username: z.string().trim().min(1).max(300) });

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter an Instagram username." }, { status: 400 });
  const username = normalizeInstagramUsername(parsed.data.username);
  if (!username) return NextResponse.json({ error: "Enter a valid Instagram username." }, { status: 400 });
  const ip = request.headers.get("x-real-ip")?.trim() || "local";
  const secret = process.env.LOCAL_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "nightline-local-rate-limit";
  const keyHash = createHmac("sha256", secret).update(ip).digest("hex");
  try {
    if (!(await consumeUsernameLookupLimit(keyHash))) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
    await requestPendingBoarding(username, keyHash);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "The boarding request could not be saved." }, { status: 503 });
  }
}
