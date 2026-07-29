# claude-tips.md — Tip Distribution System (FOH Dashboard)

## Purpose
Calculate and distribute tips to FOH staff based on actual hours worked per shift.
Source of truth: `shift_clocks` timestamps → `eod_reports` totals → `tip_distributions` output.

---

## Tables
- `eod_reports` — total tip pool input (cc_tip + cash_tip)
- `shift_clocks` — hours worked per employee
- `tip_distributions` — calculated output per employee

See `claude-db.md` for full schemas.

---

## Core Formula

```
hours_worked (per employee) = sum of approved shift durations for that session_date

tip_share = tip_total × (employee_hours / total_hours_all_staff)

net_tip = tip_share - house_deduction
```

- `tip_total` comes from `eod_reports.tip_total` (= cc_tip + cash_tip)
- Only use `shift_clocks` where `approval_status IN ('approved', 'adjusted')`
- If `adjusted`: use `approved_hours`, not raw clock duration
- `house_deduction` = configurable per restaurant policy (default 0 until defined)

---

## Status / Workflow

```
EOD report created (manager enters tip totals)
        ↓
[pending] — tip_distributions rows generated, not yet finalized
        ↓  (manager reviews, makes corrections if needed)
[approved] — locked, no further edits
```

- `tip_distributions` rows are **deleted and regenerated** on recalculation — never updated in place
- Corrections go through re-running the calculation, not patching individual rows
- Once `approved`, record is immutable — create adjustment entry if needed

---

## Calculation Query

```sql
WITH clock_hours AS (
  SELECT
    employee_id,
    CASE
      WHEN approval_status = 'adjusted' THEN approved_hours
      ELSE EXTRACT(EPOCH FROM (clock_out_at - clock_in_at)) / 3600.0
    END AS hours_worked
  FROM shift_clocks
  WHERE session_date = $session_date
    AND clock_out_at IS NOT NULL
    AND approval_status IN ('approved', 'adjusted')
),
totals AS (
  SELECT SUM(hours_worked) AS total_hours FROM clock_hours
),
tip_pool AS (
  SELECT tip_total FROM eod_reports WHERE session_date = $session_date
)
SELECT
  c.employee_id,
  ROUND(c.hours_worked::numeric, 2) AS hours_worked,
  ROUND((p.tip_total * (c.hours_worked / t.total_hours))::numeric, 2) AS tip_share,
  0 AS house_deduction,
  ROUND((p.tip_total * (c.hours_worked / t.total_hours))::numeric, 2) AS net_tip
FROM clock_hours c, totals t, tip_pool p;
```

---

## Insert Tip Distributions

After calculation, delete old rows and insert fresh:

```sql
-- Clear previous calculation for this report
DELETE FROM tip_distributions WHERE eod_report_id = $eod_report_id;

-- Insert new rows
INSERT INTO tip_distributions (eod_report_id, employee_id, hours_worked, tip_share, house_deduction, net_tip)
VALUES
  ($eod_report_id, $employee_id, $hours_worked, $tip_share, $house_deduction, $net_tip),
  ...;
```

---

## EOD Report Input Fields

Manager enters these manually to create the tip pool:

| Field | Description |
|---|---|
| `cc_tip` | Credit card tips from POS |
| `cash_tip` | Cash tips collected |
| `tip_total` | Auto-calculated: cc_tip + cash_tip |
| `cash_total` | Total cash taken in |
| `batch_total` | Credit card batch total |
| `revenue_total` | Overall revenue |
| `cash_deposit` | Cash going to deposit |
| `memo` | Notes for the record |

---

## Permission Rules

| Action | Staff | Shift Lead | Manager |
|---|---|---|---|
| View own tip share | ✓ | ✓ | ✓ |
| View all tip shares | ✗ | ✓ | ✓ |
| Enter EOD report | ✗ | ✗ | ✓ |
| Run tip calculation | ✗ | ✗ | ✓ |
| Approve distribution | ✗ | ✗ | ✓ |

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Employee clocked in but not out | Exclude from tip calc (no `clock_out_at`) |
| All hours are 0 / no approved clocks | Block calculation, show error to manager |
| Manager manually adjusted hours | Use `approved_hours` field, not raw duration |
| Tip total is 0 | Allow, all tip_shares = $0.00 |
| Single employee worked the shift | Gets 100% of tip pool |
| Employee clocked in but status still `open` | Exclude — must be approved first |
| House deduction not yet defined | Default to 0, leave `house_deduction` column ready |

---

## UI Flow (Manager)

```
1. Manager opens EOD screen for session_date
2. Enters: cc_tip, cash_tip, cash_total, batch_total, revenue_total, cash_deposit
3. System auto-calculates tip_total
4. Manager clicks "Calculate Tips"
5. System queries approved shift_clocks → generates tip_distributions (pending)
6. Manager sees table: [Name | Hours | Tip Share | Deduction | Net Tip]
7. Manager reviews — if correction needed:
   a. Go to clock records, adjust hours → re-run calculation
8. Manager clicks "Approve & Lock"
9. tip_distributions status → approved (immutable)
```

---

## Related Files
- Schema: `claude-db.md` → `tip_distributions`, `eod_reports`, `shift_clocks`
- Hours source: `claude-clockin.md`
- UI: `claude-ui.md`
