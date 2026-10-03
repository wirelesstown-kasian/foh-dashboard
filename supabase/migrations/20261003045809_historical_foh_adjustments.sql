-- Store imported period summaries separately from exposed operational tables.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.historical_adjustments (
  key text primary key,
  value jsonb not null,
  source_sha256 text not null,
  imported_at timestamptz not null default now()
);

alter table private.historical_adjustments enable row level security;
revoke all on private.historical_adjustments from public, anon, authenticated;
grant select on private.historical_adjustments to service_role;

-- Only the private server credential may call this read-only API function.
create function public.get_foh_historical_adjustments()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select value
  from private.historical_adjustments
  where key = 'foh_adjust_2026'
$$;

revoke all on function public.get_foh_historical_adjustments() from public, anon, authenticated;
grant execute on function public.get_foh_historical_adjustments() to service_role;

notify pgrst, 'reload schema';
