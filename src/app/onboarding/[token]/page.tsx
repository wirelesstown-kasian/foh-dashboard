import { OnboardingPortal } from '@/components/onboarding/OnboardingPortal'

export default async function OnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <OnboardingPortal token={token} />
}
