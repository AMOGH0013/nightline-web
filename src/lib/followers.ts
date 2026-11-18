import "server-only";
import { createHash } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import type { ParsedFollowerFiles } from "@/lib/follower-import-format";

export async function stageFollowerImport(input: {
  parsed: ParsedFollowerFiles;
  uploadedBy: string;
  sourceBytes: Buffer[];
}) {
  return withTransaction(async (run) => {
    const digest = createHash("sha256");
    input.sourceBytes.forEach((bytes, index) => {
      const name = Buffer.from(input.parsed.fileNames[index] ?? `source-${index}`);
      digest.update(Buffer.from(`${name.byteLength}:`)).update(name).update(Buffer.from(`${bytes.byteLength}:`)).update(bytes);
    });
    const hash = digest.digest("hex");
    const [header] = await run<{ id: string }>(
      `insert into public.follower_manifest_imports
       (uploaded_by,file_names,content_sha256,status,total_records,unique_records,duplicate_records,malformed_records,missing_timestamps)
       values($1,$2,$3,'preview',$4,$5,$6,$7,$8) returning id`,
      [input.uploadedBy, input.parsed.fileNames.map((name) => name.slice(0, 255)), hash,
        input.parsed.totalRecords, input.parsed.records.length, input.parsed.duplicateRecords,
        input.parsed.malformedRecords, input.parsed.missingTimestamps],
    );
    const usernames = input.parsed.records.map(({ username }) => username);
    const existingRows = usernames.length ? await run<{
      username: string;
      passenger_id: string | null;
      has_manifest_record: boolean;
      legacy_passenger_id: string | null;
    }>(
      `select incoming.username,
              fr.passenger_id,
              fr.normalized_username is not null as has_manifest_record,
              p.id as legacy_passenger_id
       from unnest($1::text[]) as incoming(username)
       left join public.follower_records fr on fr.normalized_username=incoming.username
       left join public.profiles pr on lower(pr.instagram_handle)=incoming.username
       left join public.passengers p on p.user_id=pr.id`,
      [usernames],
    ) : [];
    const state = new Map(existingRows.map((row) => [row.username, row]));
    const [latest] = await run<{ latest: string | null; last_rank: string | null }>(
      `select max(followed_at) as latest, max(follower_rank)::text as last_rank from public.follower_records fr
       left join public.passengers p on p.id=fr.passenger_id`,
    );
    let lateHistoricalRecords = 0;
    const staged = input.parsed.records.map((record) => {
      const existing = state.get(record.username);
      let disposition: "new" | "existing" | "late_review" | "legacy_conflict";
      if (existing?.legacy_passenger_id && !existing.has_manifest_record) disposition = "legacy_conflict";
      else if (existing?.has_manifest_record) disposition = "existing";
      else if (record.followedAt && latest?.latest && Date.parse(record.followedAt) < Date.parse(latest.latest)) {
        disposition = "late_review";
        lateHistoricalRecords += 1;
      } else disposition = "new";
      return { ...record, disposition, existingPassengerId: existing?.passenger_id ?? existing?.legacy_passenger_id ?? null };
    });
    for (const record of staged) {
      await run(
        `insert into public.follower_import_preview_rows(import_id,normalized_username,profile_url,followed_at,source_order,disposition,existing_passenger_id)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [header.id, record.username, record.profileUrl, record.followedAt, record.sourceOrder, record.disposition, record.existingPassengerId],
      );
    }
    await run(
      `update public.follower_manifest_imports set late_historical_records=$2,
       summary=$3::jsonb where id=$1`,
      [header.id, lateHistoricalRecords, JSON.stringify({
        timestampsRequired: true,
        legacyIdentityConflicts: staged.filter((row) => row.disposition === "legacy_conflict").length,
        missingTimestamps: input.parsed.missingTimestamps,
        tiedTimestampRecords: input.parsed.tiedTimestampRecords,
        malformedRecords: input.parsed.malformedRecords,
      })],
    );
    const baseRank = Number(latest?.last_rank ?? 0);
    const pending = staged.filter((row) => row.disposition === "new" || row.disposition === "late_review");
    const normal = pending.filter((row) => row.disposition === "new");
    const late = pending.filter((row) => row.disposition === "late_review");
    const mapping = [...normal, ...late].map((row, index) => {
      const rank = baseRank + index + 1;
      return { username: row.username, followerRank: rank, permanentNumber: 99 + rank, entitlement: entitlementFor(99 + rank), disposition: row.disposition };
    });
    return {
      importId: header.id,
      contentSha256: hash,
      counts: {
        total: input.parsed.totalRecords,
        unique: input.parsed.records.length,
        duplicates: input.parsed.duplicateRecords,
        malformed: input.parsed.malformedRecords,
        missingTimestamps: input.parsed.missingTimestamps,
        tiedTimestampRecords: input.parsed.tiedTimestampRecords,
        existing: staged.filter((row) => row.disposition === "existing").length,
        new: normal.length,
        lateHistorical: late.length,
        legacyConflicts: staged.filter((row) => row.disposition === "legacy_conflict").length,
      },
      preview: mapping.slice(0, 1000).map((row) => ({ ...row, seat: row.followerRank <= 100 ? `L-${String(99 + row.followerRank).padStart(3, "0")}` : null })),
      confirmable: input.parsed.malformedRecords === 0 && !staged.some((row) => row.disposition === "legacy_conflict"),
    };
  });
}

export async function confirmFollowerImport(importId: string, approveLateHistorical: boolean, approveMissingTimestamps: boolean, actorId: string) {
  return withTransaction(async (run) => {
    const [header] = await run<{
      id: string;
      status: string;
      malformed_records: number;
      duplicate_records: number;
      missing_timestamps: number;
      late_historical_records: number;
      summary: { legacyIdentityConflicts?: number };
    }>("select * from public.follower_manifest_imports where id=$1 for update", [importId]);
    if (!header || header.status !== "preview") throw new Error("import_not_previewable");
    const age = await run<{ expired: boolean }>("select created_at < pg_catalog.now() - interval '24 hours' as expired from public.follower_manifest_imports where id=$1", [importId]);
    if (age[0]?.expired) throw new Error("import_preview_expired");
    if (header.malformed_records) throw new Error("import_has_incomplete_records");
    if (header.missing_timestamps && !approveMissingTimestamps) throw new Error("missing_timestamps_need_review");
    if (header.summary.legacyIdentityConflicts) throw new Error("legacy_identity_review_required");
    if (header.late_historical_records && !approveLateHistorical) throw new Error("late_followers_need_approval");
    await run("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('nightline.follower_import'))");
    const rows = await run<{
      normalized_username: string;
      profile_url: string | null;
      followed_at: string | null;
      source_order: number;
      disposition: string;
      existing_passenger_id: string | null;
    }>(
      `select * from public.follower_import_preview_rows where import_id=$1
       order by case when disposition='late_review' then 1 else 0 end, followed_at nulls last, source_order for update`,
      [importId],
    );
    const [last] = await run<{ rank: string }>("select coalesce(max(follower_rank),0)::text as rank from public.passengers");
    let rank = Number(last.rank);
    const appliedAt = new Date().toISOString();
    await run("update public.follower_records set present_in_latest_snapshot=false, updated_at=pg_catalog.now()");
    let created = 0;
    for (const row of rows) {
      if (row.disposition === "existing") {
        await run(
          `update public.follower_records set last_seen_at=pg_catalog.now(), present_in_latest_snapshot=true,
             source_import_id=$2, updated_at=pg_catalog.now(), profile_url=coalesce($3,profile_url),
             followed_at=coalesce(followed_at,$4) where normalized_username=$1`,
          [row.normalized_username, importId, row.profile_url, row.followed_at],
        );
        continue;
      }
      rank += 1;
      await run(
        `select public.assign_follower_identity($1,$2,$3,$4,$5,$6)`,
        [importId, row.normalized_username, row.followed_at, row.profile_url, rank, 99 + rank],
      );
      if (row.disposition === "late_review") {
        await run("update public.follower_records set late_review_required=true where normalized_username=$1", [row.normalized_username]);
      }
      created += 1;
    }
    await run(`insert into public.follower_import_records(import_id,normalized_username,passenger_id,followed_at,source_order,
        follower_rank,permanent_number,original_entitlement,assignment_status)
      select $1,r.normalized_username,p.id,r.followed_at,r.source_order,p.follower_rank,p.permanent_number,p.original_entitlement,
        case when r.disposition='existing' then 'existing' when r.disposition='late_review' then 'late_review' else 'new' end
      from public.follower_import_preview_rows r
      join public.follower_records fr on fr.normalized_username=r.normalized_username
      join public.passengers p on p.id=fr.passenger_id
      where r.import_id=$1`, [importId]);
    await run(
      `update public.follower_manifest_imports set status='confirmed', confirmed_at=$2,
        summary=summary || jsonb_build_object('allocatedPassengers',$3::integer,'lateRecordsApproved',$4::boolean,'missingTimestampsApproved',$5::boolean,'missingTimestampOrdering','source_file_first_observed','confirmedBy',$6::uuid)
       where id=$1`,
      [importId, appliedAt, created, approveLateHistorical, approveMissingTimestamps, actorId],
    );
    await run("delete from public.follower_import_preview_rows where import_id=$1", [importId]);
    return {
      importId,
      allocated: created,
      existingRetained: rows.filter((row) => row.disposition === "existing").length,
      skippedDuplicates: header.duplicate_records,
      requiresReview: 0,
      lastPermanentNumber: rank ? 99 + rank : null,
    };
  });
}

export async function readFollowerImportHistory() {
  return query<{
    id: string;
    file_names: string[];
    status: string;
    total_records: number;
    unique_records: number;
    duplicate_records: number;
    malformed_records: number;
    missing_timestamps: number;
    late_historical_records: number;
    summary: Record<string, unknown>;
    created_at: string;
    confirmed_at: string | null;
  }>(`select id,file_names,status,total_records,unique_records,duplicate_records,malformed_records,
      missing_timestamps,late_historical_records,summary,created_at::text as created_at,confirmed_at::text as confirmed_at
      from public.follower_manifest_imports order by created_at desc limit 25`);
}

export function entitlementFor(permanentNumber: number) {
  if (permanentNumber <= 199) return "luxury";
  if (permanentNumber <= 499) return "silver";
  if (permanentNumber <= 999) return "bronze";
  return "regular";
}
