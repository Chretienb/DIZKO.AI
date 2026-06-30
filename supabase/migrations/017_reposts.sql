-- 017_reposts.sql
-- Reposts (SoundCloud/LinkedIn-style). A repost is a REFERENCE to someone else's
-- showcased track — never a copy. It appears on the reposter's profile (in a
-- "Reposts" tab) and credits the original author; all plays/likes/comments still
-- accrue to the original. We only track a repost_count on the original for social
-- proof. Additive & backward-compatible.

create table if not exists reposts (
  user_id          uuid        not null references auth.users(id)     on delete cascade,
  showcase_item_id uuid        not null references showcase_items(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (user_id, showcase_item_id)
);

create index if not exists reposts_item on reposts (showcase_item_id);
create index if not exists reposts_user on reposts (user_id, created_at desc);

-- Denormalized repost count on the original (social proof).
alter table showcase_items add column if not exists repost_count integer not null default 0 check (repost_count >= 0);

create or replace function repost_count_sync() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update showcase_items set repost_count = repost_count + 1 where id = new.showcase_item_id;
  elsif tg_op = 'DELETE' then
    update showcase_items set repost_count = greatest(repost_count - 1, 0) where id = old.showcase_item_id;
  end if;
  return null;
end $$;

drop trigger if exists reposts_count on reposts;
create trigger reposts_count
  after insert or delete on reposts
  for each row execute function repost_count_sync();

alter table reposts enable row level security;
do $$ begin
  create policy "reposts_service_role" on reposts for all using (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;
