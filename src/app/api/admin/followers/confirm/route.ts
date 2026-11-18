import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmFollowerImport } from "@/lib/followers";
import { isAdmin } from "@/lib/passengers";
import { getSession } from "@/lib/session";

const input = z.object({ importId: z.uuid(), approveLateHistorical: z.boolean().default(false), approveMissingTimestamps: z.boolean().default(false) });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isAdmin(session.userId))) return NextResponse.json({ error: "not_admin" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  try {
    return NextResponse.json(await confirmFollowerImport(parsed.data.importId, parsed.data.approveLateHistorical, parsed.data.approveMissingTimestamps, session.userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The manifest could not be confirmed.";
    const status = ["late_followers_need_approval", "missing_timestamps_need_review", "import_has_incomplete_records", "legacy_identity_review_required"].includes(message) ? 409 : 400;
    return NextResponse.json({ error: message, message }, { status });
  }
}
