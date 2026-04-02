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
