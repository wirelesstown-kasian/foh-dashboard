-- REVIEW DRAFT ONLY. Do not apply until the updated dashboard server routes
-- are deployed and verified in a staging environment. Running this against
-- the currently deployed app breaks workflows.
-- Existing employee PINs and data are not changed by this script.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Abort if the public table inventory changed since this cutover was reviewed.
do $$
declare actual text[];
begin
  select array_agg(c.relname order by c.relname) into actual
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';
  if actual is distinct from array[
    'app_settings', 'cash_balance_entries', 'daily_sessions', 'employees',
    'eod_reports', 'google_reviews', 'payroll_run_items', 'payroll_runs',
    'review_assignments', 'reward_catalog', 'reward_redemptions',
    'schedule_draft_weeks', 'schedule_drafts', 'schedule_publications',
    'schedules', 'shift_clocks', 'task_categories', 'task_completions',
    'tasks', 'tip_distributions'
  ]::text[] then
    raise exception 'Public table inventory changed; review the security cutover again';
  end if;
end;
$$;

-- This application has no Supabase Auth users. Its signed dashboard cookies
-- are verified by Next.js routes, which access these tables with a private
-- server credential. No browser role needs direct table or sequence access.
alter table public.app_settings enable row level security;
alter table public.cash_balance_entries enable row level security;
alter table public.daily_sessions enable row level security;
alter table public.employees enable row level security;
alter table public.eod_reports enable row level security;
alter table public.google_reviews enable row level security;
alter table public.payroll_run_items enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.review_assignments enable row level security;
alter table public.reward_catalog enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.schedule_draft_weeks enable row level security;
alter table public.schedule_drafts enable row level security;
alter table public.schedule_publications enable row level security;
alter table public.schedules enable row level security;
alter table public.shift_clocks enable row level security;
alter table public.task_categories enable row level security;
alter table public.task_completions enable row level security;
alter table public.tasks enable row level security;
alter table public.tip_distributions enable row level security;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

-- Also remove privileges inherited from PUBLIC or automatically granted on
-- future application objects owned by postgres. Existing supabase_admin
-- default privileges cannot be changed by the postgres migration role; new
-- application migrations must explicitly enable RLS and revoke client grants.
revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, public;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, public;
-- Fail the transaction if a service-only access path would be removed.
do $$
declare table_name text;
begin
  for table_name in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    if not has_table_privilege('service_role', format('public.%I', table_name), 'SELECT') then
      raise exception 'service_role lost SELECT on public.%', table_name;
    end if;
  end loop;
end;
$$;

commit;
