create table if not exists public.cash_balance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  entry_type text not null check (entry_type in ('cash_in', 'cash_out')),
  amount numeric(10,2) not null check (amount > 0),
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cash_balance_entries_entry_date_idx
on public.cash_balance_entries(entry_date desc, created_at desc);
