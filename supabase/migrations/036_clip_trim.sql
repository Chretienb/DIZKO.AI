-- Per-clip crop (drag a clip's edges on the Studio timeline) and cut/split
-- (right-click "Split" at the playhead). Both trim the WINDOW of the stem's
-- own audio this one clip instance plays — the stem file itself, and every
-- other clip instance of it, are untouched.
--
-- trim_start_ms: offset into the stem's audio where this clip starts playing.
-- trim_end_ms:   offset into the stem's audio where this clip stops playing;
--                NULL means "play to the natural end of the stem" (the
--                default for every clip today, so this migration changes
--                nothing about existing playback until someone crops/splits).
ALTER TABLE clips ADD COLUMN trim_start_ms int NOT NULL DEFAULT 0 CHECK (trim_start_ms >= 0);
ALTER TABLE clips ADD COLUMN trim_end_ms   int NULL CHECK (trim_end_ms IS NULL OR trim_end_ms > trim_start_ms);
