ALTER TABLE profiles ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
CREATE INDEX IF NOT EXISTS profiles_canceled_at ON profiles(canceled_at) WHERE canceled_at IS NOT NULL;
