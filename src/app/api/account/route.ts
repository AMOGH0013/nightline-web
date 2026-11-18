import { NextResponse } from "next/server";
import { anonymiseOwn, explain } from "@/lib/passengers";
import { jsonError } from "@/lib/http";
import { getSession, sessionCookie } from "@/lib/session";

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthenticated", message: "The session has expired. Sign in again." },
      { status: 401 },
    );
  }
  try {
    await anonymiseOwn(session.userId);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookie(), "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return jsonError(new Error(explain(error)));
  }
}
