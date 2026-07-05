-- 029_dizko_crew.sql
-- Dizko Crew ambassador program: Stripe Connect onboarding + referral attribution
-- + a commission ledger. Additive & backward-compatible. (Commission accrual and
-- payouts are driven by the backend; this is the schema they read/write.)

-- ── Ambassadors ──────────────────────────────────────────────────────────────
create table if not exists ambassadors (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references auth.users(id) on delete cascade,
  code                  text unique,                         -- e.g. "MO20" (also the Stripe promo code name)
  stripe_account_id     text,                                -- Connect (Express) account
  onboarding_status     text not null default 'not_started', -- not_started | pending | verified
  payouts_enabled       boolean not null default false,
  charges_enabled       boolean not null default false,
  status                text not null default 'active',      -- active | suspended
  created_at            timestamptz not null default now()
);
create index if not exists ambassadors_code on ambassadors (lower(code));

-- Permanent referral attribution: which ambassador referred this user (first touch).
alter table profiles add column if not exists referred_by uuid references ambassadors(id) on delete set null;
alter table profiles add column if not exists referred_at timestamptz;

-- ── Referrals — one row per attributed customer ──────────────────────────────
create table if not exists referrals (
  id                    uuid primary key default gen_random_uuid(),
  ambassador_id         uuid not null references ambassadors(id) on delete cascade,
  user_id               uuid not null unique references auth.users(id) on delete cascade,  -- one attribution per user
  stripe_customer_id    text,
  first_paid_at         timestamptz,                         -- starts the 12-month commission window
  status                text not null default 'trialing',   -- trialing | active | past_due | canceled | refunded
  created_at            timestamptz not null default now()
);
create index if not exists referrals_ambassador on referrals (ambassador_id);

-- ── Commission ledger — one line per invoice (audit-grade, reversible) ───────
create table if not exists commission_ledger (
  id                    uuid primary key default gen_random_uuid(),
  ambassador_id         uuid not null references ambassadors(id) on delete cascade,
  referral_id           uuid not null references referrals(id) on delete cascade,
  stripe_invoice_id     text,
  stripe_charge_id      text,
  base_amount_cents     integer not null default 0,          -- what the customer actually paid (post-discount)
  rate                  numeric(5,4) not null default 0,     -- 0.1700 / 0.2250 / 0.2500
  amount_cents          integer not null default 0,          -- commission = base * rate (negative for clawbacks)
  kind                  text not null default 'commission',  -- commission | clawback
  status                text not null default 'pending',     -- pending | paid | reversed
  payout_id             uuid,
  created_at            timestamptz not null default now()
);
create unique index if not exists commission_ledger_invoice
  on commission_ledger (stripe_invoice_id, kind) where stripe_invoice_id is not null;
create index if not exists commission_ledger_ambassador on commission_ledger (ambassador_id, status);

-- ── Payouts — one Connect transfer per ambassador per run ────────────────────
create table if not exists payouts (
  id                    uuid primary key default gen_random_uuid(),
  ambassador_id         uuid not null references ambassadors(id) on delete cascade,
  stripe_transfer_id    text,
  amount_cents          integer not null default 0,
  status                text not null default 'pending',     -- pending | paid | failed
  period                text,                                -- e.g. "2026-06"
  created_at            timestamptz not null default now()
);
create index if not exists payouts_ambassador on payouts (ambassador_id);

-- Service-role only (all writes go through the backend service role).
do $$ begin
  alter table ambassadors        enable row level security;
  alter table referrals          enable row level security;
  alter table commission_ledger  enable row level security;
  alter table payouts            enable row level security;
exception when others then null; end $$;
do $$ begin create policy "crew_service_ambassadors"  on ambassadors       for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end $$;
do $$ begin create policy "crew_service_referrals"    on referrals         for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end $$;
do $$ begin create policy "crew_service_ledger"       on commission_ledger for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end $$;
do $$ begin create policy "crew_service_payouts"      on payouts           for all using (auth.role() = 'service_role'); exception when duplicate_object then null; end $$;
