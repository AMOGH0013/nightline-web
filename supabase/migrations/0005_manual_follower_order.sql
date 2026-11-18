-- Preserve source-file order for followers without export timestamps. This is the
-- explicit review order only; it must never be presented as historical follow order.
alter table public.follower_import_preview_rows
  add column if not exists source_order integer not null default 0 check (source_order >= 0);
