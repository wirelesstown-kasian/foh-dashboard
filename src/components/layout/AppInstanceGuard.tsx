'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

const LOCK_KEY = 'foh-dashboard-active-instance'
const CHANNEL_NAME = 'foh-dashboard-instance-lock'
const HEARTBEAT_MS = 2_000
const STALE_AFTER_MS = 12_000

type LockRecord = {
  id: string
  updatedAt: number
}

type GuardState = 'checking' | 'active' | 'blocked'

function readLock() {
  try {
    const raw = window.localStorage.getItem(LOCK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LockRecord>
    if (typeof parsed.id !== 'string' || typeof parsed.updatedAt !== 'number') return null
    return parsed as LockRecord
  } catch {
    return null
  }
}

function writeLock(id: string) {
  window.localStorage.setItem(LOCK_KEY, JSON.stringify({ id, updatedAt: Date.now() }))
}

function isStale(lock: LockRecord | null) {
  return !lock || Date.now() - lock.updatedAt > STALE_AFTER_MS
}

export function AppInstanceGuard({ children }: { children: React.ReactNode }) {
  const [instanceId, setInstanceId] = useState('')
  const [state, setState] = useState<GuardState>('checking')
  const [activeSince, setActiveSince] = useState<Date | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => setInstanceId(
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `instance-${Date.now()}-${Math.random().toString(36).slice(2)}`
    ), 0)
    return () => window.clearTimeout(id)
  }, [])

  const becomeActive = useCallback(() => {
    writeLock(instanceId)
    setActiveSince(new Date())
    setState('active')
  }, [instanceId])

  const checkLock = useCallback((takeover = false) => {
    const lock = readLock()
    if (takeover || !lock || lock.id === instanceId || isStale(lock)) {
      becomeActive()
      return
    }
    setState('blocked')
  }, [becomeActive, instanceId])

  useEffect(() => {
    if (!instanceId) return
    const initialCheckId = window.setTimeout(() => checkLock(), 0)

    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null
    const heartbeatId = window.setInterval(() => {
      const lock = readLock()
      if (!lock || lock.id === instanceId || isStale(lock)) {
        writeLock(instanceId)
        setState('active')
      } else {
        setState('blocked')
      }
    }, HEARTBEAT_MS)

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LOCK_KEY) return
      const lock = readLock()
      if (lock && lock.id !== instanceId && !isStale(lock)) setState('blocked')
    }

    const releaseLock = () => {
      const lock = readLock()
      if (lock?.id === instanceId) window.localStorage.removeItem(LOCK_KEY)
      channel?.postMessage({ type: 'released', id: instanceId })
    }

    channel?.addEventListener('message', event => {
      const message = event.data as { type?: string; id?: string }
      if (message.type === 'released' && message.id !== instanceId) checkLock()
      if (message.type === 'takeover' && message.id !== instanceId) setState('blocked')
    })
    window.addEventListener('storage', handleStorage)
    window.addEventListener('pagehide', releaseLock)
    window.addEventListener('beforeunload', releaseLock)

    return () => {
      window.clearInterval(heartbeatId)
      window.clearTimeout(initialCheckId)
      releaseLock()
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('pagehide', releaseLock)
      window.removeEventListener('beforeunload', releaseLock)
      channel?.close()
    }
  }, [checkLock, instanceId])

  const takeOverDevice = () => {
    if (!instanceId) return
    writeLock(instanceId)
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL_NAME)
      channel.postMessage({ type: 'takeover', id: instanceId })
      channel.close()
    }
    setActiveSince(new Date())
    setState('active')
  }

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="rounded-lg border bg-white px-5 py-4 text-sm font-medium text-muted-foreground shadow-sm">
          Opening FOH Dashboard...
        </div>
      </div>
    )
  }

  if (state === 'blocked') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-lg border bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-600">Already Open</div>
          <h1 className="mt-2 text-xl font-bold text-slate-950">FOH Dashboard is active on this device.</h1>
          <p className="mt-2 text-sm text-slate-600">
            Close the other dashboard window or take over this device if the old app window is stuck.
          </p>
          <Button className="mt-4 w-full" onClick={takeOverDevice}>
            Take Over This Device
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      {children}
      <span className="sr-only">
        Dashboard instance active{activeSince ? ` since ${activeSince.toISOString()}` : ''}
      </span>
    </>
  )
}
