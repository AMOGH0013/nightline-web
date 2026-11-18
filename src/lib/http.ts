import { NextResponse } from "next/server";
import { explain } from "@/lib/passengers";
import { ERROR_TEXT } from "@/lib/db";

export function jsonError(error: unknown, status = 400) {
  const code = explain(error);
  return NextResponse.json(
    { error: code, message: ERROR_TEXT[code] ?? "The request could not be completed." },
    { status: code === "not_admin" ? 403 : code === "unauthenticated" || code === "forbidden" ? 401 : status },
  );
}

export function badRequest(message: string) {
  return NextResponse.json({ error: "invalid", message }, { status: 400 });
}
