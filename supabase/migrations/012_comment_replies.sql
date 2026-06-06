-- Threaded replies on stem comments (one level deep, Instagram-style).
-- A reply points at the top-level comment it answers; deleting a parent removes
-- its replies. Replies carry timestamp_sec = 0 so they never become waveform markers.
ALTER TABLE stem_comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES stem_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS stem_comments_parent_id ON stem_comments(parent_id);
