# EOD and connected-report audit — October 14, 2026

Local corrections are ready for review. Production data has not been repaired or recalculated, and these corrections have not been pushed.

## Production checks

- October 1–13: 11 EOD records and 11 distinct session dates.
- Tip components, gross/payment totals, and cash deposits: zero mismatches above $0.03.
- Ten completed EOD distributions reconcile to the 85% employee pool within $0.01; existing historical results were preserved.
- October 13 has an EOD total but no saved employee distributions. It still needs review and an explicit save after deployment.
- October 1–14: five payroll runs checked; run net totals and payout totals reconcile with their items within $0.03.
- Vercel reported no grouped runtime errors in the three-day window. Handled HTTP errors, including the previously reproduced Invalid JSON response, are not ruled out by that result.

## Findings and local corrections

| Area | Finding and resulting behavior |
| --- | --- |
| EOD save and EOD History | Previously committed fix accepts Supabase's bodyless DELETE requests while preserving authentication, ownership, and business-day checks. |
| Wage Report, Payroll Worksheet, performance, email summaries | Shared daily tip resolution preserves saved allocations when participants/hours match; otherwise it calculates eligible approved clock hours using the existing house cut and hourly caps. Calculations are read-only until an explicit save. |
| Reporting Dashboard | Gross/net revenue includes the EOD financial record. Tips Paid Out continues to use saved payroll payouts and their pay dates. Missing distributions are visibly flagged. |
| Payroll Worksheet | Refreshing/adding one employee now calculates the entire pool before selecting that employee. Paid employee-days are excluded after allocation, preventing them from being redistributed to unpaid staff or included again. |
| Daily guarantees | James selected the daily rule: sum each day's positive shortfall. Worksheet drafts and wage-sheet exports now agree with Wage Report. A high-tip day does not offset another day's shortfall. Existing paid snapshots are preserved. |
| Paid payroll corrections | Clock edits adjust guarantee pay for the affected days. Missing distributions use the same previous clock estimate when calculating the tip difference. Multi-department clock details include only the department worked. |
| Manual aggregate payroll edits | Period-level hours/tips do not identify which day's guarantee changed. Existing daily top-up is retained; the worksheet explains the need to review it, and the paid-payout editor exposes an explicit Daily Guarantee Top-Up field. |
| Tip Distribution Editor | Existing employee allocations and hourly caps are preserved. An entirely capped pool shows any unallocated remainder separately. A cash-tip correction also updates cash variance. |
| Email/API paths | Wage and performance server rebuilds, weekly summaries, and EOD weekly/monthly totals include missing-row clock estimates. A failed EOD clock/schedule read stops sending instead of silently omitting employee tips. |

## Verification

- All 57 automated tests passed. Production build and TypeScript checks passed. Lint reported zero errors and the three pre-existing warnings.
- Regression tests execute actual browser-client/gateway and page save handlers with an in-memory database.
- Calculation tests execute actual report helpers, worksheet handlers, paid-clock corrections, email route handlers, and wage-sheet export with synthetic data and mocked delivery.
- Coverage includes missing distributions, saved manual allocations, hourly caps, break deductions, pending/open clocks, date/month boundaries, paid exclusions, daily guarantees, department filtering, revenue/payout reconciliation, XLSX exports, and session/role authorization.
- Automated email tests capture content locally; they do not establish live provider delivery. Google Sheets export tests capture rows locally and do not establish live sheet writes.
- Automatic approval review rejected exporting detailed production compensation/attendance data into a local fixture. Verification used aggregate production queries and synthetic fixtures instead.
- No new database migration or RLS change is required. Unrelated local files remain outside the corrective commits.

## Release follow-up

Push only when James explicitly requests it, as required by AGENTS.md. After deployment, review October 13 in Tip Distribution Editor and save its employee distributions. EOD email timing is currently Manual; use Send Report for the missed report after confirming its saved tips.
