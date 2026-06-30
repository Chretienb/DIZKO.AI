-- 015_showcase_comments.sql
-- Public, timestamped comments on showcased tracks — like the Studio's waveform
-- comments, but for the public profile. Kept SEPARATE from stem_comments so a
-- public commenter never leaks into someone's private project studio.
--
-- Read is public (anyone can see comments on a public showcase item); writing
-- requires an account (enforced in the route). Each comment can pin to a moment
-- in the track (timestamp_sec) so it renders on the waveform and replays from there.

create table if not exists showcase_comments (
  id               uuid        default gen_random_uuid() primary key,
  showcase_item_id uuid        not null references showcase_items(id) on delete cascade,
  user_id          uuid        not null references auth.users(id)     on delete cascade,
  timestamp_sec    real        not null default 0 check (timestamp_sec >= 0),
  text             text        not null check (char_length(text) between 1 and 500),
  created_at       timestamptz not null default now()
);

create index if not exists showcase_comments_item on showcase_comments (showcase_item_id, timestamp_sec);

-- Denormalized count for the public card (avoids a COUNT() per render).
alter table showcase_items add column if not exists comment_count integer not null default 0 check (comment_count >= 0);

create or replace function showcase_comment_count_sync() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update showcase_items set comment_count = comment_count + 1 where id = new.showcase_item_id;
  elsif tg_op = 'DELETE' then
    update showcase_items set comment_count = greatest(comment_count - 1, 0) where id = old.showcase_item_id;
  end if;
  return null;
end $$;

drop trigger if exists showcase_comments_count on showcase_comments;
create trigger showcase_comments_count
  after insert or delete on showcase_comments
  for each row execute function showcase_comment_count_sync();

alter table showcase_comments enable row level security;
do $$ begin
  create policy "showcase_comments_service_role" on showcase_comments for all using (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;
