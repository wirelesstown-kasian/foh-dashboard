# DB Ops Notes

운영 Supabase 상태를 빠르게 확인하기 위한 메모입니다.
전체 schema dump 대신, 실제 작업에 중요한 차이점과 실행해야 할 migration만 적습니다.

## Current Snapshot

- `employees.primary_department` 존재
- `employees.login_enabled`, `employees.login_password_hash` 존재
- `app_settings` 존재
- `shift_clocks` 존재
- `shift_clocks`는 같은 business day에 여러 record를 가질 수 있어야 함
- `tip_distributions`는 현재 환경에 따라 `start_time`, `end_time`가 없을 수 있음

## Important Behavior

### Wage Report

- 시간 계산 우선순위:
  - `shift_clocks`의 `approved` / `adjusted` 시간 합계 우선
  - 없으면 `tip_distributions.hours_worked` fallback
- 팁 금액:
  - `tip_distributions.net_tip`

### Tip Distribution

- 기준 시간:
  - `shift_clocks`의 승인된 시간 합계
- 같은 날 여러 번 clock in/out 한 경우:
  - 같은 직원의 여러 `shift_clocks` 시간 합산

### Clock Records Edit

- `Clock Records -> Edit Times -> Save`
  - `shift_clocks` 업데이트
  - 같은 날짜 `tip_distributions` 재계산
  - `Wage Report` refresh 시 최신 값 반영

## Migrations To Check

### Must Exist

- [010_add_shift_clocks.sql](/Users/jamesshin/foh-dashboard/supabase/migrations/010_add_shift_clocks.sql)
  - `shift_clocks` 테이블

- [011_add_employee_logins_and_app_settings.sql](/Users/jamesshin/foh-dashboard/supabase/migrations/011_add_employee_logins_and_app_settings.sql)
  - `login_enabled`
  - `login_password_hash`
  - `app_settings`

- [012_add_primary_department_and_role_settings.sql](/Users/jamesshin/foh-dashboard/supabase/migrations/012_add_primary_department_and_role_settings.sql)
  - `employees.primary_department`
  - role / department settings seed

- [013_allow_multiple_shift_clocks_per_day.sql](/Users/jamesshin/foh-dashboard/supabase/migrations/013_allow_multiple_shift_clocks_per_day.sql)
  - removes `shift_clocks_session_date_employee_id_key`
  - enables re-clock-in / double shift records

### Strongly Recommended

- [003_add_tip_distribution_shift_times.sql](/Users/jamesshin/foh-dashboard/supabase/migrations/003_add_tip_distribution_shift_times.sql)
  - adds `tip_distributions.start_time`
  - adds `tip_distributions.end_time`
  - 앱은 fallback이 있어서 없어도 저장은 되지만, 있으면 shift time도 같이 저장됨

## Quick SQL Checks

### 1. Check tip distribution time columns

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'tip_distributions'
order by column_name;
```

기대:
- `start_time`
- `end_time`

### 2. Check shift clocks unique constraint removal

```sql
select conname
from pg_constraint
where conrelid = 'public.shift_clocks'::regclass
order by conname;
```

여기서 없어야 하는 것:
- `shift_clocks_session_date_employee_id_key`

### 3. Check primary department exists

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'employees'
  and column_name = 'primary_department';
```

## SQL To Run If Missing

### Add tip distribution shift times

```sql
alter table public.tip_distributions
add column if not exists start_time time,
add column if not exists end_time time;
```

### Allow multiple clock records per day

```sql
alter table public.shift_clocks
drop constraint if exists shift_clocks_session_date_employee_id_key;
```

## Notes

- `003`이 아직 적용 안 된 환경에서는 앱이 자동 fallback으로 `start_time/end_time` 없이 `tip_distributions`를 저장합니다.
- 하지만 운영에서 clock-based tip 흐름을 더 정확히 남기려면 `003` 적용이 좋습니다.
- `013`이 안 되어 있으면 같은 날 재-clocking이 안 됩니다.
- 현재 migration 파일 목록에 `011` prefix가 두 개 있습니다:
  - `011_add_employee_logins_and_app_settings.sql`
  - `011_add_task_completion_status.sql`
  이건 파일 정렬/추적 시 혼동될 수 있으니 나중에 정리하는 게 좋습니다.
