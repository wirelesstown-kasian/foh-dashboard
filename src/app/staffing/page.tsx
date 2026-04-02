import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { EmployeeTable } from '@/components/staffing/EmployeeTable'

export default function StaffingPage() {
  return (
    <div className="p-6">
      <AdminSubpageHeader title="Staffing" subtitle="Manage employee profiles, roles, and PINs." />
      <EmployeeTable />
    </div>
  )
}
