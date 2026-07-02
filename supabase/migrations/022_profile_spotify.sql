-- 022_profile_spotify.sql
-- Optional Spotify embed on a public profile. Stored as "<type>/<id>"
-- (e.g. "album/7ik4rjxOnmwnAWWzjj5ni3"), rendered via Spotify's embed iframe.
-- Additive & backward-compatible.

alter table profiles add column if not exists spotify_embed text;
