-- 039_reapply_signup_trigger_fix.sql
-- `supabase migration list` shows no migrations tracked as applied on the
-- remote (they've been run by pasting SQL into the dashboard, not `db push`),
-- so we can't confirm 025_fix_signup_trigger.sql's fix actually landed. Users
-- are still hitting "Database error creating new user" on signup, which is
-- the exact symptom 025 targeted (a follows insert blocked by RLS aborting
-- the whole auth.users insert). CREATE OR REPLACE is idempotent — safe to
-- re-run whether or not 025 already applied.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare dizko_id uuid;
begin
  insert into public.profiles (id) values (NEW.id) on conflict (id) do nothing;

  begin
    select id into dizko_id from public.profiles where handle = 'dizko' limit 1;
    if dizko_id is not null and dizko_id <> NEW.id then
      insert into public.follows (follower_id, following_id)
      values (NEW.id, dizko_id) on conflict do nothing;
    end if;
  exception when others then
    null;  -- never block signup on the welcome-follow
  end;

  return NEW;
end;
$$;

-- Confirm the trigger itself still points at this function (belt-and-braces —
-- if the trigger was ever dropped or renamed, this restores it).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
