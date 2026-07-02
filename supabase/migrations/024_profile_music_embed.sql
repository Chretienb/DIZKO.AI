-- 024_profile_music_embed.sql
-- Generalize the profile music embed to any provider. Stored as
-- "<provider>:<payload>", e.g. "spotify:album/ID", "apple:us/album/slug/ID",
-- "youtube:VIDEOID" or "youtube:list/PLID". Backfills the old spotify_embed.
-- Additive & backward-compatible.

alter table profiles add column if not exists music_embed text;

update profiles
   set music_embed = 'spotify:' || spotify_embed
 where spotify_embed is not null and spotify_embed <> '' and music_embed is null;
