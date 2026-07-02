-- 021_dizko_official.sql
-- Verified badge + auto-follow the official Dizko account on signup.
-- Additive & backward-compatible.

alter table profiles add column if not exists verified boolean not null default false;

-- Every new user (email OR Google — both insert into auth.users) auto-follows
-- the official @dizko account, so their feed isn't empty and Dizko's follower
-- count grows. Runs inside the existing profile-provisioning trigger.
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
declare dizko_id uuid;
begin
  insert into public.profiles (id) values (NEW.id) on conflict (id) do nothing;

  select id into dizko_id from public.profiles where handle = 'dizko' limit 1;
  if dizko_id is not null and dizko_id <> NEW.id then
    insert into public.follows (follower_id, following_id)
    values (NEW.id, dizko_id)
    on conflict do nothing;
  end if;

  return NEW;
end;
$$;
