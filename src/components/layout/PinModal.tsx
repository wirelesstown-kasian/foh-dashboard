'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Delete } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PinModalProps {
  open: boolean
  title?: string
  description?: string
  onConfirm: (pin: string) => Promise<void> | void
  onClose: () => void
  error?: string | null
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

export function PinModal({ open, title = 'Enter PIN', description, onConfirm, onClose, error }: PinModalProps) {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPin('')
      setLocalError(null)
    }
  }, [open])

  const handleKey = (key: string) => {
    if (key === 'del') {
      setPin(p => p.slice(0, -1))
      setLocalError(null)
      return
    }
    if (pin.length >= 4) return
    const next = pin + key
    setPin(next)
    setLocalError(null)
    if (next.length === 4) {
      submit(next)
    }
  }

  const submit = async (value: string) => {
    setLoading(true)
    try {
      await onConfirm(value)
    } catch {
      setLocalError('Incorrect PIN')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setPin('')
    setLocalError(null)
    onClose()
  }

  const displayError = localError || error

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xs p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </DialogHeader>

        {/* PIN dots */}
        <div className="flex justify-center gap-4 my-4">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={cn(
                'w-4 h-4 rounded-full border-2 transition-colors',
                i < pin.length ? 'bg-amber-500 border-amber-500' : 'border-gray-300'
              )}
            />
          ))}
        </div>

        {displayError && (
          <p className="text-center text-sm text-red-500 -mt-2 mb-2">{displayError}</p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((key, idx) => (
            key === '' ? (
              <div key={idx} />
            ) : (
              <Button
                key={idx}
                variant={key === 'del' ? 'ghost' : 'outline'}
                className="h-14 text-xl font-semibold"
                onClick={() => handleKey(key)}
                disabled={loading}
              >
                {key === 'del' ? <Delete className="w-5 h-5" /> : key}
              </Button>
            )
          ))}
        </div>

        <Button variant="ghost" className="w-full mt-2" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  )
}
