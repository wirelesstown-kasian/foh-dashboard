'use client'

import { MtdLeaderboard } from '@/components/dashboard/MtdLeaderboard'

export default function LeaderboardPage() {
  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-950">MTD Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only KPI leaderboard with the same performance report popup used in employee performance.
        </p>
      </div>
      <div className="max-w-5xl">
        <MtdLeaderboard />
      </div>
    </div>
  )
}
