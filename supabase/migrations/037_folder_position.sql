-- Songs (folders) are user-orderable — drag-to-reorder in the project
-- sidebar (Angel's Figma note). Nullable on purpose: rows without a
-- position keep falling back to created_at order, so nothing changes
-- for existing projects until someone drags.
alter table public.folders add column if not exists position integer;
