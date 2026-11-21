import { redirect } from 'next/navigation'
import { AdminSubpageHeader } from '@/components/layout/AdminSubpageHeader'
import { OnboardingManager } from '@/components/onboarding/OnboardingManager'
import { managerId } from '@/lib/onboarding'

export default async function OnboardingPage() {
  if (!(await managerId())) redirect('/admin')

  return <div className="p-6">
    <AdminSubpageHeader title="Onboarding" subtitle="Track new hires from invitation to activation." />
    <OnboardingManager />
  </div>
}
