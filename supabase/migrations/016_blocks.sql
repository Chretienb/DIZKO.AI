-- 016_blocks.sql
-- User blocking. If either side has blocked the other, messaging is refused and
-- the conversation is hidden from both inboxes. Additive & backward-compatible.

create table if not exists blocks (
  blocker_id uuid        not null references auth.users(id) on delete cascade,
  blocked_id uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked on blocks (blocked_id);

alter table blocks enable row level security;
do $$ begin
  create policy "blocks_service_role" on blocks for all using (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;
