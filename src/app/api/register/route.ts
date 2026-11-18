import { NextResponse } from "next/server";
import { explain, readSettings, registerPassenger } from "@/lib/passengers";
import { jsonError } from "@/lib/http";
import { getSession } from "@/lib/session";
import { registerInput } from "@/lib/validators";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthenticated", message: "The session has expired. Sign in again." },
      { status: 401 },
    );
  }
  const parsed = registerInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", message: "Check the name, the optional Instagram handle, and the terms." },
      { status: 400 },
    );
  }
  try {
    const settings = await readSettings();
    if (parsed.data.termsVersion !== settings.termsVersion || parsed.data.privacyVersion !== settings.privacyVersion) {
      return jsonError(new Error("terms_version_mismatch"));
    }
    const allocated = await registerPassenger({
      userId: session.userId,
      displayName: parsed.data.displayName,
      instagram: parsed.data.instagram,
      termsVersion: settings.termsVersion,
      privacyVersion: settings.privacyVersion,
    });
    return NextResponse.json({
      ok: true,
      already_registered: allocated.already_registered,
      kind: allocated.kind,
      ticket_serial: allocated.ticket_serial,
    });
  } catch (error) {
    return jsonError(new Error(explain(error)));
  }
}
