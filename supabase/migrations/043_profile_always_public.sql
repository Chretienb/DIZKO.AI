-- 043_profile_always_public.sql
-- Remove the private-profile option: every account is public now. Producers
-- still need to claim a handle before their page actually resolves (see
-- publicProfile.ts / showcase.ts), but there's no more private/public choice.

alter table profiles alter column profile_public set default true;
update profiles set profile_public = true where profile_public = false;
