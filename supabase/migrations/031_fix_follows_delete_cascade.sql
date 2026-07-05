-- 031_fix_follows_delete_cascade.sql
-- Deleting an auth user fails ("Database error deleting user") whenever a
-- `follows` row references them (follower_id or following_id) — and since
-- 021_dizko_official.sql makes every signup auto-insert a welcome-follow row,
-- this blocks deleting almost any account. 014_social_showcase.sql declares
-- these FKs as ON DELETE CASCADE, but the live constraints are still
-- NO ACTION/RESTRICT (026/027 should have caught this but evidently didn't
-- apply here). Re-run the same blocking-FK-to-cascade fix, scoped to follows.
-- Changes delete behavior only; deletes no data now.

do $$
declare r record;
begin
  for r in
    select con.conname                              as conname,
           con.conrelid::regclass                    as tbl,
           att.attname                               as col
    from pg_constraint con
    join pg_attribute  att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.conrelid = 'public.follows'::regclass
      and con.confrelid = 'auth.users'::regclass
      and array_length(con.conkey, 1) = 1
      and con.confdeltype in ('a', 'r')            -- only the ones that BLOCK deletes
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
      r.tbl, r.conname, r.col
    );
  end loop;
end $$;
