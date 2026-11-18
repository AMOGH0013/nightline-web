import { NextResponse } from "next/server";
import { explain, updateProfile } from "@/lib/passengers";
import { jsonError } from "@/lib/http";
import { getSession } from "@/lib/session";
import { profileInput } from "@/lib/validators";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthenticated", message: "The session has expired. Sign in again." },
      { status: 401 },
    );
  }
  const parsed = profileInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", message: "Check the profile fields." }, { status: 400 });
  }
  try {
    const saved = await updateProfile(session.userId, parsed.data);
    if (!saved) {
      return NextResponse.json({ error: "account_closed", message: "This account can no longer be edited." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(new Error(explain(error)));
  }
}
