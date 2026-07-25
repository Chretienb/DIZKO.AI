-- 042_reports.sql
-- User/content reporting (Apple Guideline 1.2 — apps with user-generated
-- content need a mechanism to report objectionable content/users, distinct
-- from a reporter's own block list). Service-role only, same pattern as
-- 016_blocks.sql — the team reviews these by hand via the email notification
-- sent alongside each insert (see routes/reports.ts), not an in-app queue.
create table if not exists reports (
  id           uuid        primary key default gen_random_uuid(),
  reporter_id  uuid        not null references auth.users(id) on delete cascade,
  -- 'user' | 'message' | 'showcase_item' | 'comment'
  target_type  text        not null,
  target_id    text        not null,
  reason       text        not null,
  details      text,
  status       text        not null default 'pending',   -- pending | reviewed | actioned
  created_at   timestamptz not null default now()
);

create index if not exists reports_status on reports (status);
create index if not exists reports_target on reports (target_type, target_id);

alter table reports enable row level security;
do $$ begin
  create policy "reports_service_role" on reports for all using (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;
