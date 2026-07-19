-- 040_profile_music_embeds_array.sql
-- Profiles could only ever embed ONE Spotify/Apple/YouTube link
-- (music_embed, singular). Adds music_embeds — a jsonb array of the same
-- "<provider>:<payload>" strings — so a profile can show several. Backfills
-- from the existing single music_embed so nobody's current link disappears.
-- Additive & backward-compatible: music_embed/spotify_embed stay in place.

alter table profiles add column if not exists music_embeds jsonb not null default '[]'::jsonb;

update profiles
   set music_embeds = jsonb_build_array(music_embed)
 where music_embed is not null and music_embed <> '' and music_embeds = '[]'::jsonb;
