# Check Writer categories and payroll PDFs

Apply `20261119043000_check_categories_payroll_print.sql` after the existing Check Writer migrations, before deploying this code. No live database changes are performed by the code upload.

The manager-only API and manager PIN protect category mutations. Categories have a case-insensitive unique name, an archive timestamp, RLS, and service-role-only access. Existing category strings and defaults seed the manager. Renaming a category preserves names on historical transactions; archived names remain available to register reporting but are excluded from new active selections. Inline creation preserves the mounted parent form and selects the saved category.

Payroll checks snapshot only recorded hours, base wages, tips, guarantee top-up, commission, gross pay, deductions, and net pay. The snapshot refreshes while a draft is saved or issued, then freezes. Reprints and accounting updates do not read current payroll amounts into the issued snapshot. Historical checks that predate this migration intentionally do not receive current payroll figures as a backfill. Those checks print their saved payment and period information with a notice that earnings detail was not saved.

PDF preview, download, final output and the alignment sample share `src/lib/checkPdf.ts`. Every check has one 612 × 792 point page. Coordinates use the reference PDF's top-left origin:

| Field | X | Baseline from top |
| --- | ---: | ---: |
| Date | 503.64 | 67.32 |
| Payee | 82.44 | 101.40 |
| Amount right edge | 540 | 104.52 |
| Written amount | 35.64 | 126.12 |
| Memo / payroll period | 62.52 | 212.52 |
| First stub | 39 | 287.16 |
| Second stub | 39 | 544.92 |

The top check shares placement for vendors and payroll; payroll stubs contain earnings and deductions, while vendor stubs contain remittance information. A blank-name choice suppresses names on the face, mailing area, and both stubs without changing the record or accounting CSV. No taxes, YTD, regular/OT splits, or rates are inferred. Payroll net pay and the actual check payment are separately labeled, including partial payouts.

PDF viewer preferences request no scaling. Print on Letter at **Actual size / 100%**, with fit-to-page disabled; browser and printer settings cannot be forced by JavaScript. Compare a plain-paper alignment sample against the actual stock before loading checks. Browser-local horizontal and vertical offsets adjust the entire page in points. Standard PDF fonts replace unsupported Unicode characters with `?`; verify unusual names in preview.

## Verification

- `npx tsc --noEmit`
- `npx eslint src/lib/checkPdf.ts src/lib/checkVoucher.ts src/lib/checkWriter.ts src/app/api/check-writer/route.ts src/app/payroll/check-writer/*.tsx`
- `node --test tests/check-writer.test.mjs tests/check-pdf.test.mjs tests/check-writer-db.test.mjs`

Database tests apply the Check Writer migrations in temporary PGlite Postgres and verify category create/edit/archive/restore, archived selection rejection, blank-name retention, and frozen payroll reprints. PDF tests check page boundaries, coordinates, supported payroll amounts, blank-name bulk output, and legacy checks without snapshots. The supplied private paystub is not committed. Its page size and text coordinates were inspected locally, and a synthetic generated PDF was rendered for visual comparison.

A live signed-in browser flow and a physical printer/stock test remain deployment acceptance steps. The Supabase CLI could not initialize its read-only home configuration in this sandbox; the migration was prepared using the repository convention and verified by executing it in temporary Postgres.


## November 20 alignment and authorization update

Payee and numeric amount use 11pt; written amount uses 10.5pt with width fitting for long text. The memo area places the recipient at (82.44, 192) and payroll period at (82.44, 203), moving the recipient from the mailing area. Check numbers print at the top right of the check and each stub. Contact email on check PDFs is admin@newvillagepub.com.

Vendors & Staff lists every staff member with the Check Writer default category Payroll expenses; vendor categories remain individually assigned. This is a check-category default and does not edit employee roles, wages, departments, schedules, or payroll calculations.

Printing suggests the next number from the register for the first check's bank, counting used and voided stock. Editing the first number fills a sequential batch; operators can correct subsequent numbers when needed. The existing bank/number unique constraint prevents duplicate issuance. Verify stock and bank when printing mixed-bank selections. Reprints retain original numbers.

All check actions now use Submit followed by the existing authorization keypad. PINs are verified on the server for draft saves as well as issuance. The authorized manager becomes the recorded writer for draft edits and issuance; reprints preserve the original writer and add their own audit event. PINs are never stored in browser storage.

Apply 20261120000000_check_writer_authorization.sql before deploying this update.
