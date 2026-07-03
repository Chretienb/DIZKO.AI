-- 025_fix_signup_trigger.sql
-- CRITICAL: migration 021 added a follows insert to handle_new_user() that is
-- blocked by the follows RLS policy (only service_role is allowed), which aborted
-- EVERY signup ("Database error creating new user"). Make the welcome-follow
-- best-effort so it can never block account creation.

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
