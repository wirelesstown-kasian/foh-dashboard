import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { EmployeeTable } from '@/components/staffing/EmployeeTable'

export default async function StaffingPage({ searchParams }: { searchParams: Promise<{ employee?: string }> }) {
  const { employee } = await searchParams
  return (
    <div className="p-6">
      <AdminSubpageHeader title="Staffing" subtitle="Manage employee profiles, roles, PINs, and legal documents." />
      <EmployeeTable initialEmployeeId={typeof employee === 'string' ? employee : undefined} />
    </div>
  )
}
