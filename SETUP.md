# FOH Dashboard — Setup Guide

## 1. Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. After creation, go to **Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Go to **SQL Editor** and run the contents of `supabase/migrations/001_initial_schema.sql`

## 2. Environment Variables

Copy `.env.local.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
RESEND_API_KEY=your-resend-api-key
EOD_REPORT_EMAIL=manager@yourrestaurant.com
```

## 3. Resend (Email)

1. Sign up at [resend.com](https://resend.com) (free tier available)
2. Create an API key → paste into `RESEND_API_KEY`
3. Set `EOD_REPORT_EMAIL` to the email that should receive EOD reports

## 4. Run Locally

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## 5. First-Time Setup Workflow

1. If no manager exists yet, the app auto-creates a default manager:
   - Name: `Default Admin`
   - PIN: `1234`
   - Change it from **Staffing** after first login
2. **Staffing tab** → Add employees
   - Each employee gets a unique 4-digit PIN
   - Managers need role = `manager` to access Reporting tab
3. **Task Admin tab** → Add task categories and tasks
   - Pre-Shift, Operations, Closing categories are pre-created
4. **Schedule Planning tab** → Build this week's schedule → Click "Publish"
5. Open **Dashboard** — staff and tasks will appear

## 6. Daily Workflow

1. Open **Dashboard** on the tablet
2. Staff complete tasks by tapping → entering their PIN
3. Work through Pre-Shift → Operations → Closing phases
4. Click **Save & Review** → **Confirm & Move to EOD**
5. **EOD tab** → Enter revenue figures from Toast POS
6. Verify tip distribution → **Save EOD** → **Send Email Report**

## Onboarding setup

1. Apply `supabase/migrations/20261115000000_add_onboarding.sql` after the existing migrations. It creates private applicant, document, material, and company tables plus the private storage bucket.
2. Configure `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, and `CRON_SECRET`. Set `ONBOARDING_RECORD_KEY` to a stable random secret of at least 32 characters. Back up this key securely: changing or losing it makes old emailed `.nvrecord` attachments unreadable.
3. In **Staffing → Onboarding**, review and complete the legal employer details, especially current mailing address, postal code, EIN, and records email. The 2021 election supplied for initial data does not establish that these are still current.
4. The supplied handbook is imported as a private draft on the first manager view. Review its policies, especially the service mistake tip deduction language, then publish it. Upload, preview, and publish future versions from the same section. Existing signed acknowledgments remain tied to their original version. Managers can reissue a published version to active staff by email.
5. The prefilled PDF templates bundled here are the 2026 W-4 and USCIS I-9 expiring May 2027. The employee must complete and sign their own fields; a manager must review the uploaded forms and I-9 documents. Update the bundled government forms and field mapping when official versions change. The app blocks outdated prefill templates.
6. The onboarding cron runs hourly. The app login route also activates an approved hire on or after the scheduled date when the required handbook acknowledgment is present. New employees use manual check as the payment method. Do not switch them to payroll until the documents and I-9 review are complete.
7. Completed records are emailed to the configured records inbox in AES-256-GCM encrypted `.nvrecord` format. A manager can open the attachment in **Staffing → Onboarding → Open an emailed record**.

This release uses signed paper or externally completed W-4 and I-9 files uploaded to the portal. It does not claim to provide a compliant electronic W-4 or I-9 signature system.

## 7. Tablet Setup

- Recommended: iPad in landscape mode, add to Home Screen as PWA
- Minimum: 1024×768 display
- Tested on: Chrome, Safari

## Tab Summary

| Tab | Purpose |
|-----|---------|
| Dashboard | Daily task flow + staff overview (main screen) |
| Schedule | Read-only weekly schedule view |
| EOD | End-of-day revenue + tip settlement |
| Task Admin | Create/edit task categories and tasks |
| Staffing | Manage employee profiles and PINs |
| Schedule Plan | Build and publish weekly schedules |
| Reporting | Manager-only: performance + tip reports + Excel export |
