-- 020_showcase_links_download_image.sql
-- Showcase tracks get: multiple external links (Spotify / Apple Music / YouTube
-- / …), an owner switch to disable downloads, and a default cover image pulled
-- from the source project. Additive & backward-compatible.

alter table showcase_items add column if not exists links          jsonb   not null default '[]'::jsonb;
alter table showcase_items add column if not exists allow_download boolean not null default true;
alter table showcase_items add column if not exists image_url      text;

-- Fold any existing single link into the new array form.
update showcase_items
   set links = jsonb_build_array(jsonb_build_object('label', 'Link', 'url', link))
 where link is not null and link <> '' and (links is null or links = '[]'::jsonb);
