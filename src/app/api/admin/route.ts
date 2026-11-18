import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addStamp,
  archivePoll,
  assignRole,
  awardAchievement,
  configureJourney,
  configureLuxurySeat,
  createPoll,
  publishAnnouncement,
  publishArchive,
  publishDiscovery,
  publishEpisode,
  publishTransmission,
  reviewSubmission,
  setListed,
  setModeration,
  setRegistrationOpen,
  setRoleEnabled,
  updateTrain,
  verifyHandle,
} from "@/lib/admin";
import { jsonError } from "@/lib/http";
import { explain, isAdmin } from "@/lib/passengers";
import { getSession } from "@/lib/session";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("role-enabled"), key: z.string().min(1), enabled: z.boolean() }),
  z.object({ action: z.literal("assign-role"), userId: z.uuid(), role: z.string().nullable() }),
  z.object({
    action: z.literal("moderation"),
    userId: z.uuid(),
    moderation: z.enum(["ok", "hidden", "flagged"]),
  }),
  z.object({ action: z.literal("listed"), userId: z.uuid(), listed: z.boolean() }),
  z.object({ action: z.literal("verify-handle"), userId: z.uuid(), verified: z.boolean() }),
  z.object({
    action: z.literal("achievement"),
    userId: z.uuid(),
    key: z.string().trim().min(1).max(40),
    label: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal("stamp"),
    userId: z.uuid(),
    label: z.string().trim().min(1).max(80),
    note: z.string().trim().max(280),
  }),
  z.object({ action: z.literal("registration"), open: z.boolean() }),
  z.object({ action: z.literal("luxury-seat-config"), seatCode: z.string().regex(/^L-(00[1-9]|0[1-9][0-9]|[1-3][0-9]{2}|400)$/), priceInr: z.number().int().positive().nullable(), saleApproved: z.boolean() }),
  z.object({ action: z.literal("journey-settings"), launchAt: z.string().datetime({ offset: true }).nullable(), timezone: z.string().min(1).max(64) }),
  z.object({
    action: z.literal("poll"),
    title: z.string().trim().min(2).max(160),
    story: z.string().trim().min(1).max(8000),
    options: z.array(z.string().trim().min(1).max(160)).min(2).max(8),
    opensAt: z.string().min(1),
    closesAt: z.string().min(1),
    showResults: z.enum(["live", "after_close", "hidden"]),
  }),
  z.object({ action: z.literal("archive-poll"), pollId: z.uuid() }),
  z.object({
    action: z.literal("episode"),
    number: z.number().int().positive(),
    title: z.string().trim().min(2).max(160),
    summary: z.string().trim().min(1).max(4000),
  }),
  z.object({
    action: z.literal("archive"),
    kind: z.enum(["episode", "location", "decision", "vote_outcome", "event", "transmission", "discovery"]),
    title: z.string().trim().min(2).max(160),
    body: z.string().trim().min(1).max(8000),
    occurredOn: z.string().optional(),
  }),
  z.object({
    action: z.literal("train"),
    state: z.string().trim().min(2).max(40),
    headline: z.string().trim().min(2).max(160),
    detail: z.string().trim().max(2000).optional(),
  }),
  z.object({
    action: z.literal("transmission"),
    title: z.string().trim().min(2).max(120),
    body: z.string().trim().min(1).max(4000),
  }),
  z.object({
    action: z.literal("announcement"),
    title: z.string().trim().min(2).max(160),
    body: z.string().trim().min(1).max(2000),
    active: z.boolean(),
  }),
  z.object({
    action: z.literal("discovery"),
    title: z.string().trim().min(2).max(160),
    body: z.string().trim().min(1).max(4000),
  }),
  z.object({
    action: z.literal("review"),
    id: z.uuid(),
    status: z.enum(["open", "reviewed", "archived"]),
  }),
]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "unauthenticated", message: "The session has expired. Sign in again." },
      { status: 401 },
    );
  }
  if (!(await isAdmin(session.userId))) {
    return NextResponse.json({ error: "not_admin", message: "This console is sealed." }, { status: 403 });
  }
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", message: "That admin request is incomplete." }, { status: 400 });
  }
  try {
    const body = parsed.data;
    switch (body.action) {
      case "role-enabled":
        await setRoleEnabled(body.key, body.enabled);
        break;
      case "assign-role":
        await assignRole(body.userId, body.role || null);
        break;
      case "moderation":
        await setModeration(body.userId, body.moderation);
        break;
      case "listed":
        await setListed(body.userId, body.listed);
        break;
      case "verify-handle":
        await verifyHandle(body.userId, body.verified);
        break;
      case "achievement":
        await awardAchievement(body.userId, body.key, body.label);
        break;
      case "stamp":
        await addStamp(body.userId, body.label, body.note);
        break;
      case "registration":
        await setRegistrationOpen(body.open);
        break;
      case "luxury-seat-config":
        await configureLuxurySeat({ ...body, actorId: session.userId });
        break;
      case "journey-settings":
        await configureJourney({ ...body, actorId: session.userId });
        break;
      case "poll":
        await createPoll(body);
        break;
      case "archive-poll":
        await archivePoll(body.pollId);
        break;
      case "episode":
        await publishEpisode(body);
        break;
      case "archive":
        await publishArchive(body);
        break;
      case "train":
        await updateTrain(body);
        break;
      case "transmission":
        await publishTransmission(body);
        break;
      case "announcement":
        await publishAnnouncement(body);
        break;
      case "discovery":
        await publishDiscovery(body);
        break;
      case "review":
        await reviewSubmission(body.id, body.status);
        break;
      default:
        return NextResponse.json({ error: "invalid", message: "Unknown action." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(new Error(explain(error)));
  }
}
