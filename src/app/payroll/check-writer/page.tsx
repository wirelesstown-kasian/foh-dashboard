import { redirect } from 'next/navigation'
import { getDashboardViewer } from '@/lib/routeAuth'
import { CheckWriter } from './check-writer'

export default async function CheckWriterPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const [viewer, { run }] = await Promise.all([getDashboardViewer(), searchParams])
  if (!viewer?.isManager) redirect('/')
  return <CheckWriter initialRunId={typeof run === 'string' ? run : ''} />
}
