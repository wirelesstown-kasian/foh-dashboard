# Email delivery audit — October 15, 2026

## Confirmed EOD failures

Staff confirmed that they clicked **Send Report** and received an error.

- The production `shift_clocks` table has two foreign keys to `employees`: the worked employee and the approving manager. The EOD email query used an unqualified employee relationship, producing HTTP 300 / `PGRST201`. This stops both owner and staff emails before Resend is called. A zero-row production request reproduced the failure; naming `shift_clocks_employee_id_fkey` succeeds with HTTP 200.
- The clock-record Google Sheets sync used the same ambiguous relationship. Both single-record sync and sheet reset now select the worked employee explicitly.
- Staff EOD email and EOD sheet-sync authorization used the server's local business date. Vercel's UTC date can disagree with the Chicago business date late at night. These routes now use the same Chicago 3 a.m. cutoff as dashboard data and clock access. Managers can still send historical reports.
- The EOD success message now says emails were **sent**. API acceptance alone does not establish inbox delivery.

No clock, staffing, payroll, or tip records were modified during this audit.

## Production delivery evidence

Read-only Resend history (latest 100 messages) showed the latest matching messages on October 12:

| Email type | Messages | Provider status |
| --- | ---: | --- |
| Owner EOD summary | 1 | Delivered |
| Staff tip summary | 4 | Delivered |
| Staffing schedules | 9 | Delivered |
| Weekly summary | 1 | Delivered |

No October 13 or 14 owner EOD or staff tip emails appeared in that history, consistent with the failure occurring before the provider call. EOD owner/staff, schedule, queued schedule, and weekly summary settings are enabled. The production Resend key, service-role key, and cron secret are configured. EOD sending is configured as manual.

Vercel's deployed cron configuration is enabled, with no undeployed or modified jobs:

- Schedule queue: `0 8 * * *` UTC, daily.
- Weekly summary: `0 14 * * 1` UTC, Monday.

The weekly summary currently corresponds to Monday 9 a.m. Chicago during daylight saving time. Cron expressions use UTC and do not automatically follow Chicago daylight saving changes. The schedule queue is checked daily, so a configured publication time is eligible at the next cron check rather than guaranteed at that exact minute. The current Hobby scheduling window can vary within the hour. No cron schedule or hosting plan was changed.

There were no overdue or future queued schedule publications at inspection time. Recent schedule delivery confirms a working sending path; no live cron or recipient email was triggered for testing. Vercel's short log retention could not establish the exact response from the previous night's request.

## Queue handling improvements

- Mark a queued schedule publication sent only after at least one recipient was sent an email and the batch succeeded.
- Keep zero-recipient or partially failed batches pending and report their unsuccessful outcome.
- Surface a database failure when recording sent status.
- Continue processing later queued weeks if one week throws an error.

The existing queue retries a whole unsuccessful week; it does not track individual recipient delivery. A partially sent batch can therefore resend to earlier successful recipients on retry. This behavior predates this patch.

## Verification and release scope

Regression tests cover the ambiguous clock relationship, owner and staff EOD sends, clock sheet sync, staff authorization after the UTC date changes, rejected historical staff access, queue authentication/settings, empty/partial batches, failure isolation, sent-status write failures, and weekly summary errors. All email and sheet writes in tests use mocks.

Verification passed: all 65 automated tests, TypeScript checking, and the production build. ESLint reported no errors and three existing unused-variable warnings outside the changed code. All four exact-projection live schema probes (EOD clock, clock sheet, EOD report, and schedule email) returned HTTP 200 with zero rows.

Live schema probes request zero rows and do not export staff records. No emails were resent. These changes require an application deployment; no Supabase SQL or RLS update is needed. Push remains subject to James's instruction in `AGENTS.md`.
