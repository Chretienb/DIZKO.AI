-- 018_comment_replies.sql
-- Threaded replies on showcase comments (one level deep, IG-style). A reply is a
-- showcase_comments row with parent_id set. Additive & backward-compatible.

alter table showcase_comments add column if not exists parent_id uuid references showcase_comments(id) on delete cascade;
create index if not exists showcase_comments_parent on showcase_comments (parent_id);
