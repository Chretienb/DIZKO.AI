-- 019_showcase_preview_link.sql
-- Per-showcase-item controls: play a 30s preview vs the full audio publicly, and
-- attach an external link (buy/download/booking). Additive & backward-compatible.

alter table showcase_items add column if not exists preview_only boolean not null default false;
alter table showcase_items add column if not exists link         text;
