'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Employee, GoogleReview } from '@/lib/types'

interface AssignReviewDialogProps {
  open: boolean
  review: GoogleReview | null
  employees: Employee[]
  submitting: boolean
  onClose: () => void
  onSubmit: (employeeIds: string[], note: string) => Promise<void> | void
}

export function AssignReviewDialog({
  open,
  review,
  employees,
  submitting,
  onClose,
  onSubmit,
}: AssignReviewDialogProps) {
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>(() => {
    if ((review?.matched_employee_ids ?? []).length > 0) return review!.matched_employee_ids
    return review?.matched_employee_id ? [review.matched_employee_id] : []
  })
  const [note, setNote] = useState(review?.reason ?? '')
  const selectedEmployeeNames = selectedEmployeeIds
    .map(employeeId => employees.find(employee => employee.id === employeeId)?.name ?? null)
    .filter((name): name is string => name !== null)

  const toggleEmployee = (employeeId: string) => {
    setSelectedEmployeeIds(current => (
      current.includes(employeeId)
        ? current.filter(id => id !== employeeId)
        : [...current, employeeId]
    ))
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Review</DialogTitle>
          <DialogDescription>
            Choose the staff member who should own this review and save the manager note.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">{review?.author_name ?? 'Review'}</div>
            <div className="mt-1 line-clamp-4 whitespace-pre-wrap">{review?.review_text ?? ''}</div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Assigned Staff</label>
            <div className="rounded-xl border border-slate-200 p-2">
              <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {selectedEmployeeNames.length > 0 ? selectedEmployeeNames.join(', ') : 'Unassigned'}
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {employees.map(employee => (
                  <label
                    key={employee.id}
                    className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmployeeIds.includes(employee.id)}
                      onChange={() => toggleEmployee(employee.id)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span>{employee.name}</span>
                  </label>
                ))}
              </div>
              {selectedEmployeeIds.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 h-9 text-sm"
                  onClick={() => setSelectedEmployeeIds([])}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Manager Note</label>
            <Input
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder="Why this assignment was chosen"
              className="h-11 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 min-w-28" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            className="h-11 min-w-28"
            onClick={() => onSubmit(selectedEmployeeIds, note)}
            disabled={submitting}
          >
            {submitting ? 'Saving...' : 'Save Assignment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
