# claude-clockin.md — Clock In/Out System (FOH Dashboard)

## Purpose
Server-side timestamped attendance tracking with buddy punch prevention.
All times from Supabase `now()` — never client-side.

---

## Table
`shift_clocks` — see `claude-db.md` for full schema.

---

## Approval Status Flow

```
clock in → [open]
              ↓ (flag detected or manager review triggered)
       [pending_review]
          ↓           ↓
     [approved]   [adjusted]   ← manager manually corrected hours
```

- `open` — normal clocked-in or clocked-out, no issues
- `pending_review` — flagged for buddy punch or anomaly
- `approved` — manager confirmed hours are correct
- `adjusted` — manager overrode hours via `approved_hours` field
- Only `approved` and `adjusted` records count toward tip calculation

---

## Buddy Punch Prevention

Every clock-in requires a **photo** (`clock_in_photo_path`).
- Photo is uploaded to Supabase Storage before INSERT
- Path stored in `shift_clocks.clock_in_photo_path`
- If photo upload fails → block clock-in entirely
- Shift lead or manager reviews flagged photos and sets `approval_status`

### Flag triggers (set status → `pending_review`)
- Clock-in outside of scheduled shift window (±30 min buffer)
- Clock-in with no schedule found for that day
- Duplicate clock-in (already has open record for today)

---

## Clock In Flow

```
1. Staff enters PIN
2. Camera capture → upload photo to Supabase Storage
3. Check: does employee already have open shift_clocks for today?
   → YES: block, show "Already clocked in"
4. Check: does employee have a schedule for today?
   → NO schedule: flag as pending_review on insert
5. INSERT shift_clocks with clock_in_at = now()
6. Show success confirmation
```

### Insert query
```sql
INSERT INTO shift_clocks (
  session_date, employee_id, clock_in_at, clock_in_photo_path, approval_status
)
VALUES (
  CURRENT_DATE,
  $employee_id,
  now(),
  $photo_path,
  CASE WHEN $has_schedule THEN 'open' ELSE 'pending_review' END
);
```

---

## Clock Out Flow

```
1. Staff enters PIN
2. Find open shift_clocks record (clock_out_at IS NULL)
   → NONE: show "Not clocked in"
3. Optional: capture clock-out photo
4. UPDATE clock_out_at = now()
5. Calculate raw hours for display
6. Show duration summary to staff
```

### Update query
```sql
UPDATE shift_clocks
SET
  clock_out_at = now(),
  clock_out_photo_path = $photo_path,
  updated_at = now()
WHERE employee_id = $employee_id
  AND session_date = CURRENT_DATE
  AND clock_out_at IS NULL;
```

---

## Auto Clock-Out

If a shift_clocks record has `clock_in_at` but no `clock_out_at` past midnight:
- System sets `clock_out_at = midnight`, `auto_clock_out = true`
- Status → `pending_review` (manager must verify)
- Manager can adjust via `approved_hours`

---

## Manager Adjustment Flow

When manager corrects hours:
```sql
UPDATE shift_clocks
SET
  approval_status = 'adjusted',
  approved_hours = $corrected_hours,
  manager_approved_by = $manager_employee_id,
  manager_approved_at = now(),
  manager_note = $note,
  updated_at = now()
WHERE id = $shift_clock_id;
```

---

## Hours Calculation for Tip

Use only `approved` and `adjusted` records:
```sql
SELECT
  employee_id,
  CASE
    WHEN approval_status = 'adjusted' THEN approved_hours
    ELSE ROUND(
      EXTRACT(EPOCH FROM (clock_out_at - clock_in_at)) / 3600.0,
      2
    )
  END AS hours_worked
FROM shift_clocks
WHERE session_date = $date
  AND clock_out_at IS NOT NULL
  AND approval_status IN ('approved', 'adjusted');
```

---

## Permission Rules

| Action | Staff | Shift Lead | Manager |
|---|---|---|---|
| Clock in/out (own) | ✓ | ✓ | ✓ |
| View own records | ✓ | ✓ | ✓ |
| View all records | ✗ | ✓ (today) | ✓ (all) |
| Flag for review | ✗ | ✓ | ✓ |
| Approve / Adjust | ✗ | ✗ | ✓ |

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Staff forgets to clock out | Auto clock-out at midnight → pending_review |
| Double clock-in attempt | Block on duplicate check before INSERT |
| No schedule on file | Allow clock-in but flag as pending_review |
| Photo upload fails | Block clock-in entirely, show retry |
| Manager clocks in for staff | Not allowed — PIN + photo must be done by the individual |
| Clock-in/out within same minute | Allow, flag as anomaly for review |

---

## Related Files
- Schema: `claude-db.md` → `shift_clocks` table
- Tip calc: `claude-tips.md`
- UI components: `claude-ui.md`
