-- 030_crew_promo_invite.sql
-- Dizko Crew: store the Stripe promotion code we auto-create per ambassador, and
-- record how/when they enrolled (via the reusable invite link). Additive.

alter table ambassadors add column if not exists promotion_code_id text;      -- Stripe promo code (promo_...)
alter table ambassadors add column if not exists enrolled_at      timestamptz; -- when they accepted the invite
alter table ambassadors add column if not exists invited_via      text;        -- which invite token they used
