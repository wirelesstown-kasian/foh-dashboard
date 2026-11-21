import type { Metadata } from 'next'
import { OnboardingPortal } from '@/components/onboarding/OnboardingPortal'

export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } }

export default async function OnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <OnboardingPortal token={token} />
}
