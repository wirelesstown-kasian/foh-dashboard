alter table public.google_reviews
  add column if not exists matched_employee_ids uuid[] not null default '{}';

update public.google_reviews
set matched_employee_ids = array[matched_employee_id]
where matched_employee_id is not null
  and matched_employee_ids = '{}';

create index if not exists google_reviews_matched_employee_ids_gin_idx
  on public.google_reviews using gin (matched_employee_ids);

alter table public.review_assignments
  add column if not exists previous_employee_ids uuid[] not null default '{}',
  add column if not exists next_employee_ids uuid[] not null default '{}';

update public.review_assignments
set previous_employee_ids = array[previous_employee_id]
where previous_employee_id is not null
  and previous_employee_ids = '{}';

update public.review_assignments
set next_employee_ids = array[next_employee_id]
where next_employee_id is not null
  and next_employee_ids = '{}';
