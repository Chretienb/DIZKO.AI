-- Clips: separates WHAT plays (a stem) from WHERE it plays on the Studio
-- timeline (a clip's track row + start offset). A stem can have many clips;
-- deleting a clip never deletes the stem.
--
-- RLS: explicitly enabled with owner/collaborator policies reusing the
-- is_project_owner/is_project_collaborator SECURITY DEFINER helpers added in
-- 034_fix_collaborators_projects_rls_recursion.sql. That migration's own
-- comment notes Supabase Realtime evaluates RLS per-subscriber to decide
-- whether to deliver a postgres_changes event — without a policy here,
-- collaborators would never receive clip move/create/delete events, silently
-- (the same class of bug 033_stems_realtime.sql fixed for stems, but at the
-- publication level rather than RLS). Mutations are still authoritatively
-- validated in the Hono backend (service role, bypasses RLS) — these policies
-- exist for correct realtime fan-out and defense-in-depth, not as the only
-- gate.

create table clips (
  id               uuid        primary key default gen_random_uuid(),
  stem_id          uuid        not null references stems(id) on delete cascade,
  project_id       uuid        not null references projects(id) on delete cascade,
  -- Denormalized from stems.folder_id at insert time (nullable — a stem can
  -- be "unsorted", no song). track_index is only meaningful scoped to one
  -- song's timeline, so overlap checks need to filter by this directly
  -- without joining back to stems on every read.
  folder_id        uuid        references folders(id) on delete set null,
  track_index      int         not null default 0,
  start_offset_ms  int         not null default 0 check (start_offset_ms >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index clips_stem_id_idx    on clips(stem_id);
create index clips_project_id_idx on clips(project_id);
create index clips_placement_idx on clips(project_id, folder_id, track_index);

alter table clips enable row level security;

create policy "Owner or collaborator can manage clips" on clips
  for all
  using (public.is_project_owner(project_id) or public.is_project_collaborator(project_id))
  with check (public.is_project_owner(project_id) or public.is_project_collaborator(project_id));

alter publication supabase_realtime add table clips;

-- Backfill: one clip per existing eligible stem, so every project looks
-- identical right after this migration runs. Mirrors mixerStems' own filter
-- (frontend/src/pages/Studio.jsx ~line 1500-1505): exclude the original
-- unprocessed upload and the smart-bounce mix, exclude take-history children
-- (notes.parent_stem_id) and archived stems (notes.archived). stems.notes is
-- a `text` column holding JSON (confirmed live via the Supabase REST OpenAPI
-- schema), not native jsonb — hence the ::jsonb cast.
--
-- track_index is partitioned per (project, song) — folder_id groups stems
-- into a "song", and the Studio timeline only ever renders one song's clips
-- at a time, so two different songs must be free to both start at row 0.
insert into clips (stem_id, project_id, folder_id, track_index, start_offset_ms)
select
  s.id,
  t.project_id,
  s.folder_id,
  row_number() over (partition by t.project_id, s.folder_id order by s.created_at asc) - 1,
  0
from stems s
join tracks t on t.id = s.track_id
where s.file_url is not null
  and s.instrument not in ('original', 'smart_bounce')
  and (nullif(s.notes, '')::jsonb->>'parent_stem_id') is null
  and (nullif(s.notes, '')::jsonb->>'archived') is distinct from 'true';
