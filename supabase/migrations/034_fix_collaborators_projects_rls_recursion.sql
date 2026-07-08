-- Fixes "infinite recursion detected in policy for relation collaborators",
-- confirmed via pg_policies: collaborators' "Project owner can manage
-- collaborators" policy (ALL) reads projects; projects' "Owner or
-- collaborator can view project" policy (SELECT) reads collaborators. Any
-- query needing both policies evaluated together (which stems/tracks'
-- policies do, indirectly) loops forever. This was silently breaking ALL
-- non-service-role access to stems/tracks/projects/collaborators — including
-- Supabase Realtime, which evaluates RLS to decide whether to deliver a
-- postgres_changes event to a subscriber.
--
-- Fix: SECURITY DEFINER helper functions run with the function owner's
-- privileges, not the calling user's — so the internal query they run does
-- NOT re-trigger the caller's RLS on the table it reads, breaking the cycle.
-- Same access rules as before, just no longer circularly evaluated.

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from projects where id = p_project_id and owner_id = auth.uid()
  );
$$;

create or replace function public.is_project_collaborator(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from collaborators where project_id = p_project_id and user_id = auth.uid()
  );
$$;

drop policy if exists "Project owner can manage collaborators" on collaborators;
create policy "Project owner can manage collaborators" on collaborators
  for all
  using (public.is_project_owner(project_id));

drop policy if exists "Owner or collaborator can view project" on projects;
create policy "Owner or collaborator can view project" on projects
  for select
  using (auth.uid() = owner_id or public.is_project_collaborator(id));
