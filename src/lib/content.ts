import "server-only";
import { connection } from "next/server";
import { query } from "@/lib/db";

export type TrainStatus = {
  state: string;
  headline: string;
  detail: string | null;
  updated_at: string;
};

export type Transmission = {
  id: string;
  title: string;
  body: string;
  published_at: string | null;
};

export type Episode = {
  id: string;
  number: number | null;
  title: string;
  summary: string;
  published_at: string | null;
};

export type ArchiveEntry = {
  id: string;
  kind: string;
  title: string;
  body: string;
  occurred_on: string | null;
  created_at: string;
};

export type Discovery = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

export type Product = {
  key: string;
  label: string;
  price_inr: number;
  seat_class: string | null;
  special_role: string | null;
  quantity: number | null;
  enabled: boolean;
  note: string | null;
};

export type PollOption = { id: string; label: string; position: number };
export type PollResult = { option_id: string; label: string; votes: number };

export type Poll = {
  id: string;
  title: string;
  story: string;
  opens_at: string;
  closes_at: string;
  show_results: "live" | "after_close" | "hidden";
  options: PollOption[];
  myVote: string | null;
  results: PollResult[];
  state: "upcoming" | "open" | "closed";
};

async function live() {
  await connection();
}

export async function readTrain() {
  await live();
  const [row] = await query<TrainStatus>("select state, headline, detail, updated_at from public.train_status where id = 1");
  return row ?? null;
}

export async function readLatestTransmission() {
  await live();
  const [row] = await query<Transmission>(
    `select id, title, body, published_at from public.transmissions
     where published order by published_at desc nulls last limit 1`,
  );
  return row ?? null;
}

export async function readCurrentEpisode() {
  await live();
  const [row] = await query<Episode>(
    `select id, number, title, summary, published_at from public.episodes
     where published order by number desc nulls last limit 1`,
  );
  return row ?? null;
}

export async function readDiscoveries() {
  await live();
  return query<Discovery>(
    `select id, title, body, created_at from public.discoveries
     where published order by created_at desc limit 12`,
  );
}

export async function readAnnouncements() {
  await live();
  return query<{ id: string; title: string; body: string }>(
    `select id, title, body from public.announcements where active order by created_at desc limit 5`,
  );
}

export async function readArchive(kind?: string) {
  await live();
  return query<ArchiveEntry>(
    `select id, kind, title, body, occurred_on::text, created_at
     from public.archive_entries
     where published and ($1::text is null or kind = $1)
     order by occurred_on desc nulls last, created_at desc`,
    [kind || null],
  );
}

export async function readProducts() {
  await live();
  return query<Product>(
    `select key, label, price_inr, seat_class, special_role, quantity, enabled, note
     from public.products order by price_inr, label`,
  );
}

export async function readPremiumLuxurySeats() {
  await live();
  return query<{ seat_code: string; price_inr: number | null; status: string; sale_approved: boolean }>(
    `select seat_code,price_inr,status,sale_approved from public.luxury_seat_inventory
     where pool='premium' order by seat_number`,
  );
}

export async function readJourney(userId: string) {
  await live();
  return query<{ id: string; title: string; body: string | null; occurred_at: string }>(
    `select e.id, e.title, e.body, e.occurred_at
     from public.journey_events e
     join public.passengers p on p.id = e.passenger_id
     where coalesce(p.account_user_id,p.user_id) = $1
     order by e.occurred_at desc`,
    [userId],
  );
}

export async function readStamps(userId: string) {
  await live();
  return query<{ id: string; label: string; note: string | null; stamped_at: string }>(
    `select s.id, s.label, s.note, s.stamped_at
     from public.stamps s
     join public.passengers p on p.id = s.passenger_id
     where coalesce(p.account_user_id,p.user_id) = $1
     order by s.stamped_at desc`,
    [userId],
  );
}

export async function readOwnAchievements(userId: string) {
  await live();
  return query<{ key: string; label: string; description: string | null; awarded_at: string }>(
    `select a.key, a.label, a.description, pa.awarded_at
     from public.passenger_achievements pa
     join public.achievements a on a.key = pa.achievement_key
     join public.passengers p on p.id = pa.passenger_id
     where coalesce(p.account_user_id,p.user_id) = $1
     order by pa.awarded_at desc`,
    [userId],
  );
}

export async function readPolls(userId: string | null) {
  await live();
  const polls = await query<{
    id: string;
    title: string;
    story: string;
    opens_at: string;
    closes_at: string;
    show_results: "live" | "after_close" | "hidden";
  }>(
    `select id, title, story, opens_at, closes_at, show_results
     from public.polls where published order by opens_at desc`,
  );
  const now = Date.now();
  const detailed: Poll[] = [];
  for (const poll of polls) {
    const options = await query<PollOption>(
      `select id, label, position from public.poll_options where poll_id = $1 order by position, label`,
      [poll.id],
    );
    let myVote: string | null = null;
    if (userId) {
      const [vote] = await query<{ option_id: string }>(
        `select v.option_id from public.votes v
         join public.passengers p on p.user_id=v.user_id
         where v.poll_id = $1 and coalesce(p.account_user_id,p.user_id) = $2`,
        [poll.id, userId],
      );
      myVote = vote?.option_id ?? null;
    }
    const results = await query<{ option_id: string; label: string; votes: string }>(
      `select option_id, label, votes from public.poll_results($1)`,
      [poll.id],
    );
    const opens = new Date(poll.opens_at).getTime();
    const closes = new Date(poll.closes_at).getTime();
    const state = now < opens ? "upcoming" : now >= closes ? "closed" : "open";
    detailed.push({
      ...poll,
      options,
      myVote,
      results: results.map((row) => ({ ...row, votes: Number(row.votes) })),
      state,
    });
  }
  return detailed;
}
