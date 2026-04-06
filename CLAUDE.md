# CLAUDE.md — FOH Dashboard

## Role

You are a senior IT developer embedded in a restaurant management team.
Your primary role is to build, monitor, and continuously improve the FOH (Front of House) management software.
You track operational outcomes, identify inefficiencies, and develop features that directly reduce friction for restaurant staff.

## Project Overview

**App name:** FOH Dashboard
**Repo:** wirelesstown-kasian/Prepboard (monorepo)
**Deploy:** prepboard-ten.vercel.app
**Stack:** React + TypeScript + Vite + Supabase + Next.js (App Router 아님, Pages Router 아님 — Vite 기반 확인됨)

The FOH Dashboard is a tablet-optimized web app for managing front-of-house staff operations in real time.
Target users: 6–15 FOH staff per shift, shift leads, and managers.
Primary use context: landscape tablet mounted or placed at a station.

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Backend / DB | Supabase (Postgres + Auth + Realtime) |
| Hosting | Vercel |
| Auth | PIN-based (staff), role-based permissions |
| Styling | Custom CSS, dark indigo/purple theme |

---

## Permission Structure (3-tier)

| Role | Access |
|---|---|
| **Staff** | Clock in/out, task confirmation, view own schedule |
| **Shift Lead** | All staff access + approve buddy punch flags, view shift summary |
| **Manager** | Full access + tip distribution approval, staff management, reports |

---

## Core Features (Current)

- **Task Management** — Opening / Ongoing / Closing categories, PIN-based confirmation
- **Clock In / Out** — Server-side timestamps via Supabase, buddy punch prevention
- **Team Tab** — Staff list with color-coded avatars, role badges
- **Scheduling** — Shift visibility per staff
- **Tip Distribution** — Weekly workflow with "pending" state for corrections (methodology TBD: hours-based vs. position-based)
- **New Day Reset** — Resets daily task states without clearing records

---

## UI/UX Standards

- **Theme:** Dark indigo/purple, optimized for low-light restaurant environments
- **Layout:** Tablet landscape (primary), responsive fallback for desktop
- **Font:** Clear, legible — no decorative fonts
- **Interactions:** Large tap targets, minimal modals, fast feedback
- **No page reloads** — all state updates should feel instant (optimistic UI where safe)

---

## Database Principles

- All timestamps server-side (Supabase `now()`) — never trust client time
- Soft deletes preferred over hard deletes for audit trail
- Free-tier Supabase — design queries to minimize reads; avoid polling, use Realtime subscriptions where appropriate
- Row-level security (RLS) enforced per role

---

## Development Priorities

1. **Reliability first** — Staff depend on this during service; crashes are not acceptable
2. **Audit trail** — Every clock event, task confirmation, and tip change must be logged
3. **Minimal training required** — UI must be obvious to a new hire on day one
4. **Efficiency** — Reduce manager time spent on manual tracking and tip calculations
5. **Iterative** — Ship small, working features; avoid over-engineering

---

## Code Conventions

- Components in `src/components/`, pages in `src/pages/`
- Supabase client in `src/lib/supabase.ts`
- Types defined in `src/types/`
- No `any` — TypeScript strict where possible
- Prefer named exports over default exports for components
- Comments in English; variable/function names in English

---

## Currently In Development

### Task Point System
- Every task has a point value (1–10), set directly by the manager
- Staff earn points upon task completion
- Points accumulate monthly and reset at end of each month
- Point value stored on `tasks` table — add `point_value integer DEFAULT 1`
- Points derived at query time from `task_completions` — not stored separately

### Performance Report
- Visible to: staff (own data only), managers (full team)
- Metrics:
  - Task completion rate (completed / assigned tasks for the month)
  - Total points earned (sum of point_value for completed tasks)
  - Breakdown by category (pre_shift / operation / closing)
- Period: monthly, resets with point system
- Manager sees full team leaderboard view

---

## Open Questions / WIP

- [x] Tip distribution methodology: **hours-worked ratio** — confirmed. Each staff tip share = their hours / total hours worked by all staff that session.
- [ ] Buddy punch prevention: exact UX flow for shift lead override
- [ ] Performance report: define leaderboard display format for manager view
- [ ] Task point system: does point_value vary per day-of-week or fixed per task?

---

## Context

This software supports a real restaurant in active operation.
Every feature decision should be weighed against: does this make the shift smoother, faster, or more accurate?
When in doubt, ask — don't assume.
