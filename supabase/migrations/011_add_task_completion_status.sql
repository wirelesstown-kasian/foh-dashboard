alter table public.task_completions
add column if not exists status text not null default 'complete';

alter table public.task_completions
drop constraint if exists task_completions_status_check;

alter table public.task_completions
add constraint task_completions_status_check
check (status in ('complete', 'incomplete'));

create index if not exists task_completions_session_status_idx
on public.task_completions(session_date, status);
