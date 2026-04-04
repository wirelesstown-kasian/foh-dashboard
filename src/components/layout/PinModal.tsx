'use client'

import { useState, useEffect, useRef, type KeyboardEvent } from 'react'
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
  const [allowHardwareKeyboard, setAllowHardwareKeyboard] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setAllowHardwareKeyboard(!window.matchMedia('(pointer: coarse)').matches)
  }, [])

  useEffect(() => {
    if (open) {
      setPin('')
      setLocalError(null)
      if (allowHardwareKeyboard) {
        window.setTimeout(() => inputRef.current?.focus(), 50)
      }
    }
  }, [allowHardwareKeyboard, open])

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

  const handleInputChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 4)
    setPin(digitsOnly)
    setLocalError(null)
    if (digitsOnly.length === 4) {
      submit(digitsOnly)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && pin.length === 4) {
      event.preventDefault()
      void submit(pin)
      return
    }

    if (event.key === 'Backspace') {
      setLocalError(null)
      return
    }

    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      handleInputChange(pin + event.key)
      return
    }

    if (event.key !== 'Tab') {
      event.preventDefault()
    }
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

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value={pin}
          onChange={event => handleInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className="sr-only"
          aria-label="PIN input"
          tabIndex={allowHardwareKeyboard ? 0 : -1}
          readOnly={!allowHardwareKeyboard}
        />

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
