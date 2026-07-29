create table if not exists public.google_reviews (
  id uuid primary key default gen_random_uuid(),
  google_review_id text not null unique,
  author_name text not null,
  reviewer_photo_url text null,
  rating integer not null check (rating between 1 and 5),
  review_text text not null,
  review_date date not null,
  language text null,
  source_payload jsonb null,
  sentiment text null check (sentiment in ('positive', 'neutral', 'negative')),
  categories text[] not null default '{}',
  staff_mentions text[] not null default '{}',
  matched_employee_id uuid null references public.employees(id) on delete set null,
  confidence integer null check (confidence between 0 and 100),
  reason text null,
  attribution_status text not null default 'unassigned'
    check (attribution_status in ('auto_match', 'ai_estimate', 'manual', 'unassigned')),
  points integer not null default 0,
  assigned_method text null,
  assigned_by_employee_id uuid null references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists google_reviews_review_date_idx on public.google_reviews(review_date desc);
create index if not exists google_reviews_matched_employee_idx on public.google_reviews(matched_employee_id, review_date desc);
create index if not exists google_reviews_attribution_status_idx on public.google_reviews(attribution_status, review_date desc);

create table if not exists public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.google_reviews(id) on delete cascade,
  previous_employee_id uuid null references public.employees(id) on delete set null,
  next_employee_id uuid null references public.employees(id) on delete set null,
  assigned_by_employee_id uuid null references public.employees(id) on delete set null,
  assignment_method text not null default 'manual',
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists review_assignments_review_idx on public.review_assignments(review_id, created_at desc);
