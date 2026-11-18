export type ImportedFollower = {
  username: string;
  profileUrl: string | null;
  followedAt: string | null;
  sourceOrder: number;
};

export type ParsedFollowerFiles = {
  records: ImportedFollower[];
  totalRecords: number;
  duplicateRecords: number;
  malformedRecords: number;
  missingTimestamps: number;
  tiedTimestampRecords: number;
  fileNames: string[];
};

type Source = { name: string; text: string };

export function normalizeInstagramUsername(input: string) {
  let username = input.trim();
  if (/^https?:\/\//i.test(username)) {
    try {
      const url = new URL(username);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      if (host !== "instagram.com") return null;
      username = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } catch {
      return null;
    }
  }
  username = username.replace(/^@/, "").trim().toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(username) ? username : null;
}

export function parseInstagramFollowerFiles(sources: Source[]): ParsedFollowerFiles {
  const byUsername = new Map<string, ImportedFollower>();
  let totalRecords = 0;
  let duplicateRecords = 0;
  let malformedRecords = 0;
  let missingTimestamps = 0;
  let sourceOrder = 0;

  for (const source of sources) {
    let root: unknown;
    try {
      root = JSON.parse(source.text) as unknown;
    } catch {
      malformedRecords += 1;
      continue;
    }
    const records = extractRecordArray(root);
    if (!records) {
      malformedRecords += 1;
      continue;
    }
    for (const entry of records) {
      const currentSourceOrder = sourceOrder++;
      totalRecords += 1;
      const candidate = recordParts(entry);
      const username = candidate.username ? normalizeInstagramUsername(candidate.username) : null;
      if (!username) {
        malformedRecords += 1;
        continue;
      }
      const followedAt = parseTimestamp(candidate.timestamp);
      if (!followedAt) missingTimestamps += 1;
      const current: ImportedFollower = {
        username,
        profileUrl: normalizeProfileUrl(candidate.profileUrl, username),
        followedAt,
        sourceOrder: currentSourceOrder,
      };
      const earlier = byUsername.get(username);
      if (earlier) {
        duplicateRecords += 1;
        const dates = [earlier.followedAt, followedAt].filter((date): date is string => Boolean(date)).sort();
        byUsername.set(username, {
          username,
          profileUrl: earlier.profileUrl ?? current.profileUrl,
          followedAt: dates[0] ?? null,
          sourceOrder: Math.min(earlier.sourceOrder, current.sourceOrder),
        });
      } else {
        byUsername.set(username, current);
      }
    }
  }
  const sorted = [...byUsername.values()].sort((a, b) => {
    if (!a.followedAt && !b.followedAt) return a.sourceOrder - b.sourceOrder;
    if (!a.followedAt) return 1;
    if (!b.followedAt) return -1;
    // Preserve order from the exported file when timestamps have equal precision.
    // Sorting ties alphabetically would invent a follower rank.
    return a.followedAt.localeCompare(b.followedAt);
  });
  const timestampCounts = new Map<string, number>();
  for (const record of sorted) if (record.followedAt) timestampCounts.set(record.followedAt, (timestampCounts.get(record.followedAt) ?? 0) + 1);
  const tiedTimestampRecords = [...timestampCounts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  return { records: sorted, totalRecords, duplicateRecords, malformedRecords, missingTimestamps, tiedTimestampRecords, fileNames: sources.map(({ name }) => name) };
}

function extractRecordArray(root: unknown): unknown[] | null {
  if (Array.isArray(root)) return root;
  if (!root || typeof root !== "object") return null;
  const object = root as Record<string, unknown>;
  for (const key of ["followers", "relationships_followers", "follower_list"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return null;
}

function recordParts(entry: unknown) {
  if (!entry || typeof entry !== "object") return { username: null, profileUrl: null, timestamp: null };
  const object = entry as Record<string, unknown>;
  const item = Array.isArray(object.string_list_data) && object.string_list_data[0] && typeof object.string_list_data[0] === "object"
    ? object.string_list_data[0] as Record<string, unknown>
    : {};
  const profileUrl = firstString(item.href, object.profile_url, object.url, object.href);
  const username = firstString(item.value, object.username, object.user_name, object.handle, object.title)
    ?? profileUsername(profileUrl);
  return { username, profileUrl, timestamp: item.timestamp ?? object.timestamp ?? object.followed_at ?? object.followedAt };
}

function firstString(...values: unknown[]): string | null {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function profileUsername(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).pathname.split("/").filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

function normalizeProfileUrl(value: string | null, username: string) {
  if (!value) return `https://www.instagram.com/${username}/`;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.hostname.toLowerCase().replace(/^www\./, "") !== "instagram.com") return null;
    return `https://www.instagram.com/${username}/`;
  } catch {
    return null;
  }
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 100_000_000_000 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}
