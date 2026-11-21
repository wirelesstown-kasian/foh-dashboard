import { escapeHtml } from '@/lib/emailUtils'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export function onboardingEmailLogo(appUrl: string) {
  return `<img src="${escapeHtml(appUrl.replace(/\/$/, ''))}/new%20logo%20V3.jpg" alt="New Village Pub" width="96" style="display:block;width:96px;height:auto">`
}

export async function onboardingDocumentLinks(caseId: string, link: string) {
  const { data: onboarding, error } = await supabaseAdmin.from('onboarding_cases')
    .select('selected_documents').eq('id', caseId).single()
  if (error) throw new Error(error.message)
  const selected: string[] = onboarding.selected_documents ?? []
  const ids = selected.filter(id => id !== 'w4' && id !== 'i9')
  const items: { title: string; href: string }[] = []
  if (ids.length) {
    const { data, error } = await supabaseAdmin.from('onboarding_materials').select('id,title')
      .in('id', ids).eq('is_current', true).order('kind')
    if (error) throw new Error(error.message)
    for (const item of data) items.push({ title: item.title, href: `${link}?material=${encodeURIComponent(item.id)}` })
  }
  if (selected.includes('w4')) items.push({ title: 'W-4 tax withholding form', href: `${link}#tax-w4` })
  if (selected.includes('i9')) items.push({ title: 'I-9 work authorization form', href: `${link}#tax-i9` })
  return items.length
    ? `<ul>${items.map(item => `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a></li>`).join('')}</ul>`
    : ''
}
