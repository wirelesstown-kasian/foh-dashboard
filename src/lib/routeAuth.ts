import { cookies } from 'next/headers'
import { APP_SESSION_COOKIE, parseAppSessionValue } from '@/lib/appAuth'
import { ADMIN_SESSION_COOKIE, getAdminSessionEmployeeId, hasManagerAccess } from '@/lib/adminSession'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export type DashboardViewer = { employeeId: string; role: string; isManager: boolean }

export async function getDashboardViewer(): Promise<DashboardViewer | null> {
  const cookieStore = await cookies()
  const managerToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value
  const managerId = getAdminSessionEmployeeId(managerToken)
  if (managerId && await hasManagerAccess(managerToken)) {
    return { employeeId: managerId, role: 'manager', isManager: true }
  }

  const appSession = parseAppSessionValue(cookieStore.get(APP_SESSION_COOKIE)?.value)
  if (!appSession) return null
  const { data, error } = await supabaseAdmin
    .from('employees')
    .select('id, role')
    .eq('id', appSession.employeeId)
    .eq('is_active', true)
    .eq('login_enabled', true)
    .maybeSingle()
  if (error || !data) return null
  return { employeeId: data.id, role: data.role, isManager: data.role === 'manager' }
}
