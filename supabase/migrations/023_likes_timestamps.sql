-- 023_likes_timestamps.sql
-- Like/delete on DMs and likes on track comments. (Timestamps already exist via
-- created_at — this just adds the like/delete data.) Additive & safe.

-- DM message reactions (iMessage-style tapback: either participant can like).
alter table messages add column if not exists liked boolean not null default false;

-- Comment likes — per-user, with a trigger-maintained count on the comment.
alter table showcase_comments add column if not exists like_count int not null default 0;

create table if not exists comment_likes (
  comment_id uuid        not null references showcase_comments(id) on delete cascade,
  user_id    uuid        not null references auth.users(id)        on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_likes_comment on comment_likes (comment_id);

create or replace function comment_likes_count() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update showcase_comments set like_count = like_count + 1 where id = NEW.comment_id;
  elsif tg_op = 'DELETE' then
    update showcase_comments set like_count = greatest(0, like_count - 1) where id = OLD.comment_id;
  end if;
  return null;
end; $$;

drop trigger if exists comment_likes_count on comment_likes;
create trigger comment_likes_count after insert or delete on comment_likes
  for each row execute function comment_likes_count();

alter table comment_likes enable row level security;
do $$ begin
  create policy "comment_likes_service" on comment_likes for all using (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;
