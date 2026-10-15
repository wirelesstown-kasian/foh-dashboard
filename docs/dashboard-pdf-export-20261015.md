# Reporting Dashboard PDF export

The dashboard's Export PDF button opens the existing browser print / Save as PDF flow. It captures the displayed values and SVG charts rather than recalculating financial data. The export includes the selected date range, previous comparison range, closed-day settings, and selected yearly trend. Weekly, monthly, yearly, and normalized custom ranges are supported.

The landscape report groups the overview and trend, revenue mix and payroll ratios, and detailed cards with department totals. Filter controls, navigation, and interaction hints are excluded. Missing-data and overlapping-import warnings remain visible. Extra pages can be added when notices or unusually long content require them. The original dashboard DOM remains intact.

Export waits for EOD, payroll, cash, and imported-total reads to finish. EOD and cash loading failures are displayed rather than silently exporting unqualified zero totals. Existing payroll and historical warnings are retained. The common print helper has an opt-in flowing layout for this dashboard; other reports retain their existing layout. Print document titles use the requested report name and restore after the dialog closes.

Verification: all 74 automated tests pass, including date/filter handoff, loading guards, print pagination mode, cleanup, title restoration, and existing reporting/email/staffing regressions. The production build passes. ESLint reports no errors and three pre-existing warnings in unrelated files.

Monthly and yearly sample dashboards were rendered in isolated headless Chrome profiles using synthetic data, actual dashboard markup, built application CSS, and the real export helpers. Both snapshots passed DOM checks for unchanged source markup, retained SVGs and totals, removed controls, and all three report sections. Both final PDFs contain three pages. All six pages were rendered to PNGs with PDFKit and visually inspected for complete sections, readable charts, and card/page boundaries. No production database changes, emails, or signed-in browser sessions were used.

No SQL or RLS update is required. Changes remain local until James requests a push.
