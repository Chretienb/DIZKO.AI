-- 032_fix_follows_count_sync_delete_race.sql
-- Deleting an auth user still fails ("Database error deleting user") even with
-- follows' FKs on cascade (031): auth.users cascades to BOTH profiles and
-- follows in the same statement, and follows_count_sync's AFTER DELETE trigger
-- tries to UPDATE the deleted user's own profiles row (to decrement
-- following_count) — the same row profiles' cascade is deleting in that same
-- command. Postgres rejects touching one row twice in one statement:
-- "tuple to be updated was already modified by an operation triggered by the
-- current command". Same fix as 025 (non-fatal welcome-follow on signup):
-- make the count updates best-effort so a delete race can never block the
-- parent user (or follows row) deletion.

create or replace function follows_count_sync() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update profiles set follower_count  = follower_count  + 1 where id = new.following_id;
    update profiles set following_count = following_count + 1 where id = new.follower_id;
  elsif tg_op = 'DELETE' then
    begin
      update profiles set follower_count  = greatest(follower_count  - 1, 0) where id = old.following_id;
      update profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    exception when others then
      null;  -- never block a cascading delete on a count sync race
    end;
  end if;
  return null;
end $$;
