-- Batched profile lookup to kill the getUserById N+1 (M3 #16).
--
-- Collaborator lists, file enrichment, access-request lists, etc. were calling
-- supabase.auth.admin.getUserById() once per row — N round-trips to GoTrue,
-- which has no batch-by-ids endpoint. auth.users lives in the protected `auth`
-- schema, so we expose a minimal, read-only projection via a SECURITY DEFINER
-- function the service role can call once with an array of ids.
--
-- Only the public profile fields are returned (no password hashes, tokens, etc).
create or replace function public.users_by_ids(ids uuid[])
returns table (id uuid, email text, full_name text, avatar_url text)
language sql
security definer
set search_path = public, auth
as $$
  select u.id,
         u.email::text                            as email,
         (u.raw_user_meta_data ->> 'full_name')   as full_name,
         (u.raw_user_meta_data ->> 'avatar_url')  as avatar_url
  from auth.users u
  where u.id = any(ids)
$$;

-- Service role only — never expose user enumeration to anon/authenticated.
revoke all on function public.users_by_ids(uuid[]) from public;
revoke all on function public.users_by_ids(uuid[]) from anon;
revoke all on function public.users_by_ids(uuid[]) from authenticated;
