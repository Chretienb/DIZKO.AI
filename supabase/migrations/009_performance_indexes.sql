-- Performance indexes identified from load testing
-- These cover the hot query paths in analytics, billing, and file listing.

-- stems: most queries filter or count by uploader
create index if not exists idx_stems_uploaded_by
  on stems (uploaded_by);

-- stems: billing/status recomputes storage live from stems per user
create index if not exists idx_stems_uploaded_by_size
  on stems (uploaded_by, file_size);

-- stems: track-level grouping (analytics sharedFiles count)
create index if not exists idx_stems_track_id
  on stems (track_id);

-- projects: all project list and analytics queries filter by owner
create index if not exists idx_projects_owner_id
  on projects (owner_id);

-- tracks: analytics now filters tracks by project_id (was full scan before)
create index if not exists idx_tracks_project_id
  on tracks (project_id);

-- collaborators: analytics counts collabs per project set
create index if not exists idx_collaborators_project_id
  on collaborators (project_id);

-- folders: folder listing always filters by project
create index if not exists idx_folders_project_id
  on folders (project_id);
