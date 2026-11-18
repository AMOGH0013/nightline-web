import { NextResponse } from "next/server";
import { readSettings } from "@/lib/passengers";
import { getSession } from "@/lib/session";

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthenticated", message: "The session has expired. Sign in again." },
      { status: 401 },
    );
  }
  const settings = await readSettings();
  if (!settings.paymentsEnabled) {
    return NextResponse.json(
      { error: "payments_disabled", message: "Payments are disabled until the creator approves them." },
      { status: 403 },
    );
  }
  return NextResponse.json(
    { error: "not_implemented", message: "No payment provider is connected." },
    { status: 501 },
  );
}
