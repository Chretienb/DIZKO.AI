-- 014_social_showcase.sql
-- Public "showcase" layer — a portfolio/social surface for producers.
--
-- A producer curates individual audio files (stems) from their private library
-- onto a public profile at dizko.ai/@handle. Logged-out visitors get read-only
-- discovery (browse profiles, stream previews, see counts, follow graph). Every
-- write — follow, like — requires an account.
--
-- Safety model (mirrors 013_project_public_share / publicShare.ts):
--   • Nothing is public unless explicitly opted in:
--       - profiles.profile_public must be true for a profile to resolve, AND
--       - only stems that have a showcase_items row are ever exposed.
--   • The public read route lives in the service-role backend and selects an
--     explicit allow-list of safe fields — it never reads private project tables.
--   • All new tables enable RLS with service-role-only policies; the anon key
--     can never touch them directly.

-- ── Extend the per-user profiles table with public-facing fields ──────────────
-- handle: the public @username and URL slug. Lowercased, [a-z0-9_], 3–30 chars.
alter table profiles add column if not exists handle          text;
alter table profiles add column if not exists display_name    text;
alter table profiles add column if not exists bio             text;
alter table profiles add column if not exists avatar_url      text;
alter table profiles add column if not exists links           jsonb   not null default '[]'::jsonb;
alter table profiles add column if not exists profile_public  boolean not null default false;
alter table profiles add column if not exists follower_count  integer not null default 0 check (follower_count  >= 0);
alter table profiles add column if not exists following_count integer not null default 0 check (following_count >= 0);

-- Handle format + case-insensitive uniqueness. Format enforced at the DB so a
-- bad handle can never be persisted regardless of which code path writes it.
do $$ begin
  alter table profiles add constraint profiles_handle_format
    check (handle is null or handle ~ '^[a-z0-9_]{3,30}$');
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_handle_unique on profiles (lower(handle)) where handle is not null;
create index        if not exists profiles_public_idx    on profiles (profile_public) where profile_public = true;

-- ── showcase_items: one curated audio file on a producer's public profile ─────
create table if not exists showcase_items (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  stem_id     uuid        not null references stems(id)      on delete cascade,
  caption     text        check (caption is null or char_length(caption) <= 280),
  position    integer     not null default 0,           -- manual ordering on the profile
  like_count  integer     not null default 0 check (like_count >= 0),
  play_count  bigint      not null default 0 check (play_count >= 0),
  created_at  timestamptz not null default now(),
  unique (user_id, stem_id)                             -- can't showcase the same file twice
);

create index if not exists showcase_items_user_pos on showcase_items (user_id, position, created_at desc);
create index if not exists showcase_items_stem      on showcase_items (stem_id);

-- ── follows: the social graph (follower → following) ──────────────────────────
create table if not exists follows (
  follower_id  uuid        not null references auth.users(id) on delete cascade,
  following_id uuid        not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)                   -- can't follow yourself
);

create index if not exists follows_following on follows (following_id);  -- "who follows X"
create index if not exists follows_follower  on follows (follower_id);   -- "who X follows" / feed

-- ── showcase_likes: a like on a showcased item ────────────────────────────────
create table if not exists showcase_likes (
  user_id          uuid        not null references auth.users(id)       on delete cascade,
  showcase_item_id uuid        not null references showcase_items(id)   on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (user_id, showcase_item_id)
);

create index if not exists showcase_likes_item on showcase_likes (showcase_item_id);

-- ── RLS: service-role only (backend mediates all access, like profiles) ───────
alter table showcase_items enable row level security;
alter table follows        enable row level security;
alter table showcase_likes enable row level security;

do $$ begin
  create policy "showcase_items_service_role" on showcase_items for all using (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "follows_service_role"        on follows        for all using (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "showcase_likes_service_role" on showcase_likes for all using (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;

-- ── Counter integrity via triggers ───────────────────────────────────────────
-- Denormalized counts (like_count, follower_count, following_count) power the
-- public, cacheable profile pages without a COUNT() per render. Triggers own
-- them so the numbers can never drift, regardless of which code path mutates the
-- underlying rows. (Eventually-consistent play_count is bumped via RPC instead.)

create or replace function showcase_like_count_sync() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update showcase_items set like_count = like_count + 1 where id = new.showcase_item_id;
  elsif tg_op = 'DELETE' then
    update showcase_items set like_count = greatest(like_count - 1, 0) where id = old.showcase_item_id;
  end if;
  return null;
end $$;

drop trigger if exists showcase_likes_count on showcase_likes;
create trigger showcase_likes_count
  after insert or delete on showcase_likes
  for each row execute function showcase_like_count_sync();

create or replace function follows_count_sync() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update profiles set follower_count  = follower_count  + 1 where id = new.following_id;
    update profiles set following_count = following_count + 1 where id = new.follower_id;
  elsif tg_op = 'DELETE' then
    update profiles set follower_count  = greatest(follower_count  - 1, 0) where id = old.following_id;
    update profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
  end if;
  return null;
end $$;

drop trigger if exists follows_count on follows;
create trigger follows_count
  after insert or delete on follows
  for each row execute function follows_count_sync();

-- Atomic play-count bump for the public stream endpoint (best-effort, no row read).
create or replace function increment_showcase_play(p_item uuid)
returns void language sql security definer as $$
  update showcase_items set play_count = play_count + 1 where id = p_item;
$$;
