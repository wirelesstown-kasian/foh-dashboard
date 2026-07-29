import { employeeMatchesScheduleDepartment } from '@/lib/organization'
import { Employee } from '@/lib/types'

type ReviewEmployee = Pick<Employee, 'name' | 'role' | 'primary_department' | 'is_active'> & {
  email?: string | null
}

function isReviewSystemAccount(employee: ReviewEmployee) {
  const name = employee.name.trim().toLowerCase()
  const email = employee.email?.trim().toLowerCase() ?? ''
  const role = employee.role.trim().toLowerCase()

  return (
    name.includes('admin') ||
    name === 'default admin' ||
    name === 'new village admin' ||
    email.startsWith('admin@') ||
    role.includes('admin')
  )
}

export function isReviewAssignableEmployee(employee: ReviewEmployee) {
  return (
    employee.is_active &&
    employeeMatchesScheduleDepartment(employee as Employee, 'foh') &&
    !isReviewSystemAccount(employee)
  )
}

export function getReviewAssignableEmployees<T extends ReviewEmployee>(employees: T[]) {
  return employees.filter(isReviewAssignableEmployee)
}
