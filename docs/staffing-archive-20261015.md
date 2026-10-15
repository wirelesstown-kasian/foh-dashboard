# Archived employee access and reactivation

Staffing now has Active, Archived, and All views with counts and search by name, email, or phone. Active remains the default. Managers can open archived profiles without editing them, then reactivate a returning employee from the list.

Reactivation confirms a four-digit PIN, prefilled when a visible saved PIN exists. The API checks both active visible PINs and legacy hashes for conflicts, and handles the database's active-PIN unique constraint. It updates the original employee row only, preserving the ID and all role, department, pay, tip, contact, and historical data. App login remains disabled with no saved password; a manager can configure it separately after reactivation.

The manager-only employee API accepts `status=active|archived|all`; existing consumers that omit status continue to receive active employees. Reactivation uses a dedicated PATCH action accepting only action, employee ID, and PIN. An inactive-row condition prevents overwriting a concurrent status change. Missing employees, duplicate PINs, and database failures are reported without silently treating the request as successful.

## Connected workflow review

| Workflow | Impact check |
| --- | --- |
| Tips and tip editor | Archived employees already remain available in reporting and saved distributions. ID, tip eligibility, cap, and distribution rows are preserved. |
| Wages and payouts | Wage and payout reports include archived employees. No wage, guarantee, commission, payment method, payout snapshot, or calculation changes. |
| Payroll worksheet | Active employee selection follows the restored active flag; saved payouts remain linked to the same ID. |
| Clock records | Clock history includes archived employees. PIN workflows require active employees, so duplicate PIN validation is necessary when restoring a record. No shifts or approvals are changed. |
| Tasks | Historical completion and performance reports include archived employees. Current PIN actions continue to check active status. No completion rows are changed. |
| Schedule | Active employee pickers pick up the returning employee after reload. Existing scheduled and draft rows remain intact; reactivation does not run the profile editor's department reconciliation. |
| EOD and dashboard | Current employee choices continue to use active employees. Existing report and clock relationships retain the original ID and saved financial values. |
| APIs and email | Manager-only staffing access remains enforced. Existing EOD, schedule, wage, performance, payroll, and weekly email handlers are unchanged; no messages are triggered by reactivation. |

## Verification

Six new tests exercise the actual API and component event handlers with isolated fixture data: manager permissions, status filters, full profile retrieval, unchanged financial/profile fields, visible and hash-only PIN conflicts, concurrent changes, old-schema fallback, database errors, archived search, read-only profile access, error display, and successful return to Active. All 71 project tests pass. TypeScript checking and the production build pass; ESLint has no errors and three existing warnings in unrelated files.

No production employees were reactivated or otherwise modified. No SQL or RLS migration is required. A live browser check was not completed: automatic approval review rejected direct creation of a local manager cookie as a bypass of normal sign-in. Verification used fixture-backed UI/API tests instead. A subsequent browser check should use the normal manager sign-in flow.

Changes remain local until James requests a push.
