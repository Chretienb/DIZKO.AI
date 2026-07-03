-- 027_profile_delete_cascade.sql
-- Deleting an auth user cascades to its profiles row, but some tables reference
-- public.profiles with NO ACTION / RESTRICT, which then blocks the delete.
-- Convert every *blocking* single-column FK that references auth.users OR
-- public.profiles to ON DELETE CASCADE, so removing a user cleanly removes all
-- of their owned rows. Changes delete behavior only; deletes no data now.

do $$
declare r record;
begin
  for r in
    select con.conname            as conname,
           con.conrelid::regclass as tbl,
           con.confrelid::regclass as ref,
           src.attname            as col,
           tgt.attname            as refcol
    from pg_constraint con
    join pg_attribute  src on src.attrelid = con.conrelid  and src.attnum = con.conkey[1]
    join pg_attribute  tgt on tgt.attrelid = con.confrelid and tgt.attnum = con.confkey[1]
    where con.contype = 'f'
      and con.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
      and array_length(con.conkey, 1) = 1
      and con.confdeltype in ('a', 'r')   -- only the ones that BLOCK deletes
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references %s(%I) on delete cascade',
      r.tbl, r.conname, r.col, r.ref, r.refcol
    );
  end loop;
end $$;
