# September 2026 Wage Report reconciliation

## Production findings (read-only)

September's 26 EOD reports reconcile exactly:

- Collected tips: **$31,467.07**.
- Saved staff allocations: **$26,747.02**.
- Saved house deductions: **$4,720.05**.
- Difference: **$0.00**.

The old cards recomputed house tips as 15% of the month ($4,720.06 after display rounding), rather than summing the saved rounded house deductions. They then combined that restaurant-wide amount with staff tips from the filtered payroll table. This caused a misleading distribution subtotal on Cook/Kitchen views.

Server payroll snapshots overlapping September contain **$31,544.11** in tips. The saved distributions for August 31 through October 4 sum to that exact amount. Of that, **$4,797.09** belongs to August 31 / October 1–4, outside September. Thus $26,747.02 + $4,797.09 = $31,544.11; this is a date-scope difference, not missing tips.

| Full saved periods overlapping September | Net earnings | Recorded payout | Net-to-payout rounding |
| --- | ---: | ---: | ---: |
| Server | $39,140.51 | $39,127.81 | $12.70 |
| Cook | $25,610.69 | $25,606.04 | $4.65 |
| Kitchen | $14,887.64 | $14,883.00 | $4.64 |

These are full saved pay-period totals, not prorated calendar-month earnings. The server boundary periods are August 31–September 6 and September 28–October 4. Cook and Kitchen periods are contained within September.

One approved Cook clock is unmatched: September 18, 5.48 hours at $20/hour, **$109.60** in base earnings. The employee is James Shin. No saved payout for that employee and worked department covers that date. A same-named payout elsewhere in September does not cover that workday. The application cannot establish whether it was paid externally or entered by mistake; it must be reviewed rather than automatically treated as money owed.

## Application changes

- Restaurant tip cards use the same selected EOD work dates and all staff on every department/employee view. Saved house and staff allocations remain intact; unsaved distributions use the existing full-pool preview, with a visible unallocated difference.
- Filtered saved payroll cards and the table use the same employee/department scope. Recorded payouts are distinguished from pre-rounding earnings.
- Unmatched worked earnings remain visible in the summary table even when other employees or dates already have saved payouts. Previously the presence of any saved items caused calculated-only rows to disappear from that table.
- The reconciliation equation explicitly shows table earnings = recorded payouts + rounding/payout adjustment + unmatched earnings + any legacy estimates.
- A review dialog identifies unmatched work by employee, work date, department, hours, tips, base wages, guarantee top-up, and earnings.
- Matching uses the employee, worked department, and covered work dates. A run's pay date alone no longer marks that day's new work paid. Synthetic snapshot-only history rows match by source run ID.
- Saved pay periods are preserved in full. A boundary notice explains when they extend outside the selected range. The application does not invent daily allocations for saved salary, commission, or manual adjustments.
- Daily-history, PDF/email, and Excel metadata distinguish clock/EOD detail from full saved snapshots. Existing daily guarantee calculations and saved payroll values are not recalculated or overwritten.

## Scope and validation

Production checks returned aggregate totals and the one unmatched work source. No production payroll, employee, schedule, clock, EOD, or tip records were changed. No emails were sent. No SQL or RLS migration is required.

Regression fixtures exercise actual Wage Report rendering for Server, Cook, Kitchen, All, and an individual employee. They check fixed restaurant tip reconciliation, cash rounding, preservation of commissions and full saved boundary periods, inclusion and review of unmatched work, department-aware work-date coverage, and capped/manual tip allocations. Existing Excel, daily guarantee, paid snapshots, dashboard, tip, clock, EOD, staffing, and email tests are also run.

All 80 automated tests and the production build pass. ESLint has no errors and three existing unused-variable warnings outside the changed code. Google Sheet sync remains the existing server-generated work-date calculation; its values are not full saved payout snapshots. No live email or sheet-sync operation was triggered.

Changes remain local until James requests a push.
