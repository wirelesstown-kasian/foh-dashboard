# claude-db.md — Database Context (FOH Dashboard)

## Supabase Project
- **Project ID:** gnaubgccxjbgxrtmffhp
- **Schema:** public
- **Client:** `src/lib/supabase.ts`
- **Timestamps:** Always server-side via `now()` — never trust client time

---

## Tables Overview

| Table | Purpose |
|---|---|
| `employees` | Staff profiles, PINs, roles, wage info |
| `daily_sessions` | One row per operational day, tracks shift phase |
| `shift_clocks` | Clock in/out records with approval workflow |
| `eod_reports` | End-of-day financials (revenue, tips, cash) |
| `tip_distributions` | Per-employee tip breakdown linked to EOD report |
| `tasks` | Task definitions (reusable) |
| `task_categories` | Groups tasks by phase (pre_shift / operation / closing) |
| `task_completions` | Daily record of who completed what |
| `schedules` | Published shift schedules |
| `schedule_drafts` | Draft schedules before publication |
| `schedule_draft_weeks` | Tracks which weeks have drafts |
| `schedule_publications` | Publication log with email send tracking |

---

## Table Schemas

### `employees`
```sql
id uuid PK
name text NOT NULL
phone text
email text
role text CHECK (manager | server | busser | runner | kitchen_staff)
birth_date date
pin_hash text NOT NULL          -- PIN stored as hash, never plaintext
is_active boolean DEFAULT true
hourly_wage numeric
guaranteed_hourly numeric
created_at timestamptz
```
> `is_active = false` for soft deletes — never hard delete employees.

---

### `daily_sessions`
```sql
id uuid PK
session_date date UNIQUE NOT NULL
current_phase text CHECK (pre_shift | operation | closing | complete)
notes text
completed_at timestamptz
```
> One row per day. Phase drives which tasks are visible in the UI.

---

### `shift_clocks`
```sql
id uuid PK
session_date date NOT NULL
employee_id uuid FK → employees.id
clock_in_at timestamptz NOT NULL       -- server-side timestamp
clock_out_at timestamptz               -- null until clocked out
clock_in_photo_path text NOT NULL      -- buddy punch prevention
clock_out_photo_path text
auto_clock_out boolean DEFAULT false   -- flagged if system auto-closed
approval_status text CHECK (open | pending_review | approved | adjusted)
approved_hours numeric                 -- manager override if needed
manager_approved_by uuid FK → employees.id
manager_approved_at timestamptz
manager_note text
created_at timestamptz
updated_at timestamptz
```
> `approval_status` flow: `open` → `pending_review` → `approved` or `adjusted`
> `adjusted` = manager manually corrected hours

---

### `eod_reports`
```sql
id uuid PK
session_date date UNIQUE NOT NULL
closed_by_employee_id uuid FK → employees.id
cash_total numeric DEFAULT 0
batch_total numeric DEFAULT 0
revenue_total numeric DEFAULT 0
cc_tip numeric DEFAULT 0
cash_tip numeric DEFAULT 0
tip_total numeric DEFAULT 0           -- cc_tip + cash_tip
cash_deposit numeric DEFAULT 0
memo text
created_at timestamptz
updated_at timestamptz
```

---

### `tip_distributions`
```sql
id uuid PK
eod_report_id uuid FK → eod_reports.id
employee_id uuid FK → employees.id
hours_worked numeric DEFAULT 0        -- pulled from shift_clocks
tip_share numeric DEFAULT 0           -- calculated share before deduction
house_deduction numeric DEFAULT 0
net_tip numeric DEFAULT 0             -- tip_share - house_deduction
```

> **Tip calculation formula:**
> ```
> hours_worked = sum of approved clock durations for that session_date
> tip_share = tip_total × (employee hours_worked / total hours all staff)
> net_tip = tip_share - house_deduction
> ```
> Source of truth for hours: `shift_clocks` where `approval_status IN ('approved', 'adjusted')`

---

### `tasks`
```sql
id uuid PK
category_id uuid FK → task_categories.id
title text NOT NULL
deadline_time time
display_order integer DEFAULT 0
is_active boolean DEFAULT true
days_of_week ARRAY                    -- which days this task appears
```

### `task_categories`
```sql
id uuid PK
name text NOT NULL
type text CHECK (pre_shift | operation | closing | custom)
deadline_time time
display_order integer DEFAULT 0
is_active boolean DEFAULT true
```

### `task_completions`
```sql
id uuid PK
task_id uuid FK → tasks.id
employee_id uuid FK → employees.id
session_date date NOT NULL
completed_at timestamptz DEFAULT now()
status text CHECK (complete | incomplete)
```

---

### `schedules` (published)
```sql
id uuid PK
employee_id uuid FK → employees.id
date date NOT NULL
start_time time NOT NULL
end_time time NOT NULL
department text CHECK (foh | boh) DEFAULT 'foh'
created_at timestamptz
```

### `schedule_drafts`
```sql
id uuid PK
week_start date FK → schedule_draft_weeks.week_start
employee_id uuid FK → employees.id
date date NOT NULL
start_time time NOT NULL
end_time time NOT NULL
is_off boolean DEFAULT false
department text DEFAULT 'foh'
display_order integer DEFAULT 0
updated_at timestamptz
```

### `schedule_draft_weeks`
```sql
week_start date PK
updated_at timestamptz
```

### `schedule_publications`
```sql
week_start date PK
week_end date NOT NULL
scheduled_send_date date NOT NULL
published_at timestamptz
email_sent_at timestamptz
```

---

## Key Query Patterns

### Clock in
```sql
INSERT INTO shift_clocks (session_date, employee_id, clock_in_at, clock_in_photo_path)
VALUES (CURRENT_DATE, $employee_id, now(), $photo_path);
```

### Clock out
```sql
UPDATE shift_clocks
SET clock_out_at = now(), updated_at = now()
WHERE employee_id = $employee_id
  AND session_date = CURRENT_DATE
  AND clock_out_at IS NULL;
```

### Hours worked per employee for a session (for tip calc)
```sql
SELECT
  employee_id,
  ROUND(
    EXTRACT(EPOCH FROM SUM(clock_out_at - clock_in_at)) / 3600.0,
    2
  ) AS hours_worked
FROM shift_clocks
WHERE session_date = $date
  AND clock_out_at IS NOT NULL
  AND approval_status IN ('approved', 'adjusted')
GROUP BY employee_id;
```

### Tip distribution calculation
```sql
WITH hours AS (
  SELECT
    employee_id,
    EXTRACT(EPOCH FROM SUM(clock_out_at - clock_in_at)) / 3600.0 AS hours_worked
  FROM shift_clocks
  WHERE session_date = $date
    AND clock_out_at IS NOT NULL
    AND approval_status IN ('approved', 'adjusted')
  GROUP BY employee_id
),
total AS (
  SELECT SUM(hours_worked) AS total_hours FROM hours
)
SELECT
  h.employee_id,
  h.hours_worked,
  ROUND($tip_total * (h.hours_worked / t.total_hours), 2) AS tip_share
FROM hours h, total t;
```

---

## Important Rules

- **Never hard delete** employees — use `is_active = false`
- **Never delete** `shift_clocks` — adjust via `approval_status = 'adjusted'` + `approved_hours`
- **Never delete** `eod_reports` — use `memo` for corrections
- `tip_distributions` rows are **regenerated** when manager re-approves, not updated in place
- All INSERT/UPDATE timestamps use server `now()` — no client timestamps
- RLS should enforce: staff can only read own `shift_clocks`, managers can read all
