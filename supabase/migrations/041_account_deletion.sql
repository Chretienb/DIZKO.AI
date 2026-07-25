-- 041_account_deletion.sql
-- Self-service account deletion (Apple Guideline 5.1.1(v) requires this to be
-- initiable in-app, not just via emailing support). Soft-delete with a grace
-- period: setting deletion_requested_at starts the clock, the user can still
-- log in to cancel it, and a daily job (see cleanupJob.ts) hard-deletes the
-- auth user — and everything cascading from 026_user_delete_cascade.sql —
-- once the grace period elapses.
alter table profiles add column if not exists deletion_requested_at timestamptz;

create index if not exists idx_profiles_deletion_requested
  on profiles (deletion_requested_at)
  where deletion_requested_at is not null;
