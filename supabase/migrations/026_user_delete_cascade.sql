-- 026_user_delete_cascade.sql
-- Deleting an auth user failed ("Database error deleting user") because some
-- foreign keys referencing auth.users use NO ACTION / RESTRICT, which blocks the
-- delete. Convert every *blocking* single-column FK on auth.users to ON DELETE
-- CASCADE so a user (and their owned rows) can be removed cleanly. Only touches
-- confdeltype 'a' (no action) / 'r' (restrict) — leaves intentional SET NULL /
-- CASCADE alone. Changes delete behavior only; deletes no data now.

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
      and con.confrelid = 'auth.users'::regclass
      and array_length(con.conkey, 1) = 1          -- single-column FKs only
      and con.confdeltype in ('a', 'r')            -- only the ones that BLOCK deletes
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
      r.tbl, r.conname, r.col
    );
  end loop;
end $$;
