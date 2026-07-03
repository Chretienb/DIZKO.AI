-- 028_fix_comment_likes_fk.sql
-- BUG: showcase comment-likes were wrongly written to `comment_likes`, which is
-- the STUDIO stem-comment likes table (migration 008, FK -> stem_comments). That
-- FK rejected every showcase comment like. Give showcase comments their OWN likes
-- table, and remove the stray count trigger 023 attached to the studio table.

-- Undo 023's mistaken trigger on the studio comment_likes table.
drop trigger  if exists comment_likes_count on comment_likes;
drop function if exists comment_likes_count();

-- Dedicated likes table for SHOWCASE (public-profile) comments.
create table if not exists showcase_comment_likes (
  comment_id uuid        not null references showcase_comments(id) on delete cascade,
  user_id    uuid        not null references auth.users(id)        on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists showcase_comment_likes_comment on showcase_comment_likes (comment_id);

create or replace function showcase_comment_likes_count() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update showcase_comments set like_count = like_count + 1 where id = NEW.comment_id;
  elsif tg_op = 'DELETE' then
    update showcase_comments set like_count = greatest(0, like_count - 1) where id = OLD.comment_id;
  end if;
  return null;
end; $$;

drop trigger if exists showcase_comment_likes_count on showcase_comment_likes;
create trigger showcase_comment_likes_count after insert or delete on showcase_comment_likes
  for each row execute function showcase_comment_likes_count();

alter table showcase_comment_likes enable row level security;
do $$ begin
  create policy "showcase_comment_likes_service" on showcase_comment_likes for all using (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;
