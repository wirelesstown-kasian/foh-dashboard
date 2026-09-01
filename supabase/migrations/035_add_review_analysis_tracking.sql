alter table public.google_reviews
  add column if not exists last_analyzed_at timestamptz null,
  add column if not exists analysis_error text null;

create index if not exists google_reviews_last_analyzed_idx
  on public.google_reviews(last_analyzed_at, review_date desc);

insert into public.app_settings (key, value, updated_at)
values ('review_analysis_state', '{"status":"idle"}'::jsonb, now())
on conflict (key) do nothing;
