import { NextResponse } from "next/server";
import { z } from "zod";
import { readSettings } from "@/lib/passengers";
import { getSession } from "@/lib/session";

const input = z.object({ seatCode: z.string().regex(/^L-(00[1-9]|0[1-9][0-9])$/), idempotencyKey: z.string().min(8).max(120) });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const settings = await readSettings();
  if (!settings.paymentsEnabled) return NextResponse.json({ error: "payments_disabled", message: "Payments are disabled. No seat was held." }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  // No approved provider is connected. The database reservation primitive is in
  // place, but the public request cannot hold inventory or create a transaction.
  return NextResponse.json({ error: "provider_unavailable", message: "Checkout is unavailable until the creator configures and approves a payment provider." }, { status: 501 });
}
