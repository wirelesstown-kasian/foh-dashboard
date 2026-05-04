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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Employee, GoogleReview } from '@/lib/types'

interface AssignReviewDialogProps {
  open: boolean
  review: GoogleReview | null
  employees: Employee[]
  submitting: boolean
  onClose: () => void
  onSubmit: (employeeId: string | null, note: string) => Promise<void> | void
}

export function AssignReviewDialog({
  open,
  review,
  employees,
  submitting,
  onClose,
  onSubmit,
}: AssignReviewDialogProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(review?.matched_employee_id ?? 'unassigned')
  const [note, setNote] = useState(review?.reason ?? '')
  const selectedEmployeeName = selectedEmployeeId === 'unassigned'
    ? 'Unassigned'
    : employees.find(employee => employee.id === selectedEmployeeId)?.name ?? 'Select staff member'

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
            <Select value={selectedEmployeeId} onValueChange={value => setSelectedEmployeeId(value ?? 'unassigned')}>
              <SelectTrigger className="h-11 w-full text-sm">
                <SelectValue>{selectedEmployeeName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {employees.map(employee => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            onClick={() => onSubmit(selectedEmployeeId === 'unassigned' ? null : selectedEmployeeId, note)}
            disabled={submitting}
          >
            {submitting ? 'Saving...' : 'Save Assignment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
