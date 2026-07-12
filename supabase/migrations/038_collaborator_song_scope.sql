-- Per-song collaborator access (Angel's permissions note, part 2): the owner
-- can limit a collaborator to specific songs (folders) in the project.
-- NULL / empty = full project access (default, backward compatible).
alter table public.collaborators add column if not exists folder_ids uuid[];
