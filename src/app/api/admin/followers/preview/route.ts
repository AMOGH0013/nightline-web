import { NextResponse } from "next/server";
import { parseFollowerUpload } from "@/lib/follower-import";
import { stageFollowerImport } from "@/lib/followers";
import { isAdmin } from "@/lib/passengers";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!(await isAdmin(session.userId))) return NextResponse.json({ error: "not_admin" }, { status: 403 });
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 21 * 1024 * 1024) return NextResponse.json({ error: "upload_too_large" }, { status: 413 });
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const parsed = await parseFollowerUpload(files);
    const sourceBytes = await Promise.all(files.map(async (file) => Buffer.from(await file.arrayBuffer())));
    const preview = await stageFollowerImport({ parsed, uploadedBy: session.userId, sourceBytes });
    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Follower export could not be read.";
    return NextResponse.json({ error: "invalid_follower_export", message }, { status: 400 });
  }
}
