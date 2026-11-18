import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { consumeUsernameLookupLimit } from "@/lib/passengers";
import { normalizeInstagramUsername } from "@/lib/follower-import-format";
import { z } from "zod";

const input = z.object({ username: z.string().trim().min(1).max(300) });

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter an Instagram username." }, { status: 400 });
  const username = normalizeInstagramUsername(parsed.data.username);
  if (!username) return NextResponse.json({ error: "Enter a valid Instagram username, with or without @." }, { status: 400 });
  const ip = request.headers.get("x-real-ip")?.trim() || "local";
  const keyHash = createHmac("sha256", rateLimitSecret()).update(ip).digest("hex");
  try {
    if (!(await consumeUsernameLookupLimit(keyHash))) {
      return NextResponse.json({ error: "Too many lookups. Please try again in a few minutes." }, { status: 429 });
    }
    // A username is public and cannot prove ownership. Keep lookup responses identical
    // for present and absent usernames; the BOARD claim workflow performs verification.
    await new Promise((resolve) => setTimeout(resolve, 100));
    return NextResponse.json({ found: false, claimRequired: true });
  } catch {
    return NextResponse.json({ error: "Ticket lookup is temporarily unavailable." }, { status: 503 });
  }
}

function rateLimitSecret() {
  return process.env.LOCAL_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "nightline-local-rate-limit";
}
