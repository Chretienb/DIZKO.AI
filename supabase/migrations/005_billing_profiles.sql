-- profiles table: one row per user, created automatically on signup via trigger
-- drives plan enforcement, storage limits, and Stripe integration

CREATE TABLE IF NOT EXISTS profiles (
  id                      uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id      text        UNIQUE,
  stripe_subscription_id  text        UNIQUE,
  plan                    text        NOT NULL DEFAULT 'free_trial'
                            CHECK (plan IN ('free_trial', 'pro', 'studio', 'label')),
  subscription_status     text        NOT NULL DEFAULT 'trialing'
                            CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  trial_end               timestamptz NOT NULL DEFAULT (now() + interval '60 days'),
  storage_used_bytes      bigint      NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
  storage_limit_bytes     bigint      NOT NULL DEFAULT 10737418240,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- storage limits by plan (bytes)
-- free_trial : 10  GB = 10737418240
-- pro        : 50  GB = 53687091200
-- studio     : 200 GB = 214748364800
-- label      : 1   TB = 1099511627776

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS profiles_stripe_customer_id ON profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_stripe_sub_id      ON profiles(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_plan               ON profiles(plan);
CREATE INDEX IF NOT EXISTS profiles_trial_end          ON profiles(trial_end);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_user_reads_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_service_role_writes"
  ON profiles FOR ALL
  USING (auth.role() = 'service_role');
