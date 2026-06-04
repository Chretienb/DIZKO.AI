-- Public share for collaboration-invite links (#78).
-- When a project is public, its pitch (cover, title, owner) is readable without
-- auth at /p/:id, and signed-in users can request to join (a pending
-- collaborator row the owner approves). Private by default.
alter table projects add column if not exists is_public boolean not null default false;
