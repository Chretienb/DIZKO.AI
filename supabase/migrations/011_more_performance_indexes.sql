-- More hot-path indexes (M3 #16 — DB index + N+1 audit).
-- 009 covered analytics/billing/file-listing; these cover the
-- notification bell, DM threads, stem comments, access requests, and the
-- "projects I collaborate on" lookups, all of which were sequential scans.

-- notifications: the bell lists newest-first per user, and read-all / unread
-- counts filter by (user_id, read). Composite covers both.
create index if not exists idx_notifications_user_created
  on notifications (user_id, created_at desc);
create index if not exists idx_notifications_user_read
  on notifications (user_id, read);

-- messages: a DM thread reads both directions (from→to and to→from), and
-- read-receipts filter (to_user_id, from_user_id). One index per direction.
create index if not exists idx_messages_from_to
  on messages (from_user_id, to_user_id, created_at);
create index if not exists idx_messages_to_from
  on messages (to_user_id, from_user_id);

-- stem_comments: always fetched by stem, ordered by timestamp.
create index if not exists idx_stem_comments_stem_id
  on stem_comments (stem_id);

-- collaborators: 009 indexed (project_id); the "all projects I collaborate on"
-- path (collaborators/all, venues) filters by user_id alone.
create index if not exists idx_collaborators_user_id
  on collaborators (user_id);

-- access_requests: the owner lists pending requests for a project.
create index if not exists idx_access_requests_project_id
  on access_requests (project_id);
