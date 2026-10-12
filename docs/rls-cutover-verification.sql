-- Read-only verification queries for the cutover. A clean result is zero rows
-- from the first two queries, followed by twenty rows with RLS enabled.

select c.relname as table_name, r.rolname as client_role,
       has_table_privilege(r.rolname, c.oid, 'SELECT') as can_select,
       has_table_privilege(r.rolname, c.oid, 'INSERT') as can_insert,
       has_table_privilege(r.rolname, c.oid, 'UPDATE') as can_update,
       has_table_privilege(r.rolname, c.oid, 'DELETE') as can_delete,
       has_table_privilege(r.rolname, c.oid, 'TRUNCATE') as can_truncate
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join pg_roles r
where n.nspname = 'public' and c.relkind = 'r'
  and r.rolname in ('anon', 'authenticated')
  and (has_table_privilege(r.rolname, c.oid, 'SELECT')
    or has_table_privilege(r.rolname, c.oid, 'INSERT')
    or has_table_privilege(r.rolname, c.oid, 'UPDATE')
    or has_table_privilege(r.rolname, c.oid, 'DELETE')
    or has_table_privilege(r.rolname, c.oid, 'TRUNCATE'));

select c.relname as table_name, a.attname as column_name,
       r.rolname as client_role
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
cross join pg_roles r
where n.nspname = 'public' and c.relkind = 'r'
  and r.rolname in ('anon', 'authenticated')
  and has_column_privilege(r.rolname, c.oid, a.attnum, 'SELECT');

select c.relname as table_name, c.relrowsecurity as rls_enabled,
       has_table_privilege('service_role', c.oid, 'SELECT') as server_can_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
