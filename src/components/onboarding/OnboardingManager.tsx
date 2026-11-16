'use client'

import { useCallback, useEffect, useState } from 'react'

type Company = { legal_name: string; dba: string; street: string; city: string; state: string; postal_code: string; ein: string; records_email: string }
type Case = { id: string; email: string; status: string; first_name: string | null; last_name: string | null; phone: string | null; role: string | null; primary_department: string | null; schedule_departments: string[] | null; hourly_wage: number | null; guaranteed_hourly: number | null; tip_pool_hourly_rate: number | null; tip_eligible: boolean | null; commission_enabled: boolean; commission_note: string | null; activation_date: string | null; application_path: string | null; employee_id: string | null; record_email_sent_at: string | null; selected_documents: string[]; last_invite_sent_at: string | null; last_invite_email: string | null }
type Material = { id: string; kind: string; title: string; version: number; file_name: string; is_current: boolean; published_at: string | null; acknowledgment_type: string; required: boolean; departments: string[] | null }
type Document = { id: string; case_id: string; kind: string; file_name: string; manager_verified_at: string | null }
type Ack = { id: string; case_id: string; material_id: string; acknowledged_at: string; quiz_score: number | null }
type Employee = { id: string; name: string; email: string; primary_department: string | null; schedule_departments: string[] | null }
type Data = { company: Company; cases: Case[]; materials: Material[]; documents: Document[]; acknowledgments: Ack[]; employees: Employee[] }
type Definition = { key: string; label: string; is_active: boolean }
const input = 'w-full rounded-md border px-3 py-2 text-sm'

export function OnboardingManager() {
  const [data, setData] = useState<Data | null>(null)
  const [roles, setRoles] = useState<Definition[]>([])
  const [departments, setDepartments] = useState<Definition[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [selectedDocuments, setSelectedDocuments] = useState<string[] | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [companyEditing, setCompanyEditing] = useState(false)
  const [companyPin, setCompanyPin] = useState('')
  const [material, setMaterial] = useState({ kind: 'handbook', title: 'Employee Handbook', acknowledgment_type: 'signature', required: true, effective_date: new Date().toISOString().slice(0, 10), departments: '', question: '', option1: '', option2: '', option3: '', correct: '0' })
  const [materialFile, setMaterialFile] = useState<File | null>(null)
  const [caseEdits, setCaseEdits] = useState<Record<string, Partial<Case>>>({})
  const [selectedCaseId, setSelectedCaseId] = useState('')
  const [reissueRecipients, setReissueRecipients] = useState<Record<string, string>>({})
  const [issueMaterials, setIssueMaterials] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    const res = await fetch('/api/onboarding', { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Could not load onboarding')
    setData(json); setCompany(json.company)
    setSelectedDocuments(previous => previous ?? ['w4', 'i9', ...json.materials.filter((item: Material) => item.is_current).map((item: Material) => item.id)])
  }, [])
  useEffect(() => {
    refresh().catch(e => setError(e.message))
    fetch('/api/app-settings').then(r => r.json()).then(j => {
      setRoles((j.settings?.role_definitions ?? []).filter((d: Definition) => d.is_active))
      setDepartments((j.settings?.primary_department_definitions ?? []).filter((d: Definition) => d.is_active))
    }).catch(() => {})
  }, [refresh])

  async function jsonRequest(method: string, body: Record<string, unknown>) {
    setBusy(true); setError(''); setMessage('')
    try {
      const res = await fetch('/api/onboarding', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Request failed')
      await refresh(); if (method === 'POST' && json.id) setSelectedCaseId(json.id)
      if (body.action === 'company') { setCompanyEditing(false); setCompanyPin('') }
      if (body.action === 'reissue_material' && typeof body.id === 'string') setReissueRecipients(old => ({ ...old, [body.id as string]: '' }))
      if (body.action === 'issue_material' && typeof body.id === 'string') setIssueMaterials(old => ({ ...old, [body.id as string]: '' }))
      if (body.action === 'cancel_invite') setSelectedCaseId('')
      setMessage(json.email_error ? `Saved, but email failed: ${json.email_error}. Use Resend link after email is configured.` : ['reissue_material','issue_material'].includes(String(body.action)) ? `Update email sent to ${json.sent_to}.` : 'Saved successfully.')
      return true
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed'); return false } finally { setBusy(false) }
  }

  async function uploadMaterial() {
    if (!materialFile) { setError('Choose a file'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const body = new FormData()
      for (const [key, value] of Object.entries(material)) body.set(key, String(value))
      body.set('file', materialFile)
      if (material.acknowledgment_type === 'quiz') body.set('quiz', JSON.stringify({ questions: [{ prompt: material.question, options: [material.option1, material.option2, material.option3].filter(Boolean), correctIndex: Number(material.correct) }] }))
      const res = await fetch('/api/onboarding/file', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      await refresh(); setMaterialFile(null); setMessage(`Uploaded ${material.title} version ${json.version} as a draft. Open it, then publish when ready.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed') } finally { setBusy(false) }
  }

  async function uploadDocument(caseId: string, kind: string, file: File | undefined) {
    if (!file) return
    setBusy(true); setError(''); setMessage('')
    try {
      const body = new FormData(); body.set('case_id', caseId); body.set('kind', kind); body.set('file', file)
      const res = await fetch('/api/onboarding/file', { method: 'POST', body })
      const json = await res.json(); if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      await refresh(); setMessage('Signed document uploaded.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed') } finally { setBusy(false) }
  }

  function edit(row: Case) { return { ...row, ...caseEdits[row.id] } }
  function setEdit(id: string, values: Partial<Case>) { setCaseEdits(old => ({ ...old, [id]: { ...old[id], ...values } })) }
  function missingForCase(row: Case) {
    if (!data || row.status === 'cancelled') return []
    const docs = data.documents.filter(item => item.case_id === row.id)
    const acks = data.acknowledgments.filter(item => item.case_id === row.id)
    return row.selected_documents.flatMap(id => {
      if (id === 'w4' || id === 'i9') return row.status === 'active' || docs.some(doc => doc.kind === id && doc.manager_verified_at) ? [] : [id.toUpperCase()]
      const material = data.materials.find(item => item.id === id)
      return material && !acks.some(ack => ack.material_id === id) ? [`${material.title} v${material.version}`] : []
    })
  }

  return <section id="onboarding" className="mt-10 scroll-mt-6 space-y-6 border-t pt-8">
    <div><h2 className="text-2xl font-semibold">Onboarding</h2><p className="text-sm text-muted-foreground">Invite new hires, maintain documents, and schedule staff access.</p></div>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-700">{message}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3 rounded-lg border p-5"><h3 className="text-lg font-semibold">Create onboarding</h3><p className="text-sm text-muted-foreground">1. Send one private application link. 2. The employee submits contact details, SSN, availability, work history, and PIN. 3. The selected documents appear for review and signature. 4. A manager reviews the case and schedules activation.</p><label className="text-sm">Employee email<input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} /></label><div className="space-y-1 text-sm"><p className="font-medium">Documents to show after application</p>{[{ id: 'w4', title: 'W-4' }, { id: 'i9', title: 'I-9' }, ...(data?.materials.filter(row => row.is_current).map(row => ({ id: row.id, title: `${row.title} v${row.version}` })) ?? [])].map(item => <label key={item.id} className="block"><input type="checkbox" checked={(selectedDocuments ?? []).includes(item.id)} onChange={e => setSelectedDocuments(old => e.target.checked ? [...(old ?? []), item.id] : (old ?? []).filter(id => id !== item.id))} /> {item.title}</label>)}</div><button disabled={busy || !email.trim()} className="rounded-md bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50" onClick={async () => { if (window.confirm(`Send one application invitation to ${email.trim()}?`) && await jsonRequest('POST', { email, selected_documents: selectedDocuments ?? [] })) setEmail('') }}>Send invitation to this employee</button></div>
      <div className="space-y-3 rounded-lg border p-5"><h3 className="text-lg font-semibold">Company information</h3><p className="text-xs text-muted-foreground">Used for onboarding paperwork. Changes are saved with history; previous signed records keep their original details.</p>
        {company && <div className="grid gap-2 sm:grid-cols-2">{(['legal_name','dba','street','city','state','postal_code','ein','records_email'] as const).map(key => <label key={key} className="text-xs capitalize">{key.replace('_',' ')}<input className={input} disabled={!companyEditing} type={key === 'ein' ? 'password' : 'text'} value={company[key]} onChange={e => setCompany({ ...company, [key]: e.target.value })} /></label>)}</div>}
        {!companyEditing ? <button className="rounded-md border px-4 py-2 text-sm" onClick={() => setCompanyEditing(true)}>Edit company details</button> : <div className="flex flex-wrap items-end gap-2"><label className="text-sm">Confirm manager PIN<input type="password" inputMode="numeric" maxLength={4} className={input} value={companyPin} onChange={e => setCompanyPin(e.target.value)} /></label><button disabled={busy || !company || !/^\d{4}$/.test(companyPin)} className="rounded-md border px-4 py-2 text-sm disabled:opacity-50" onClick={() => company && jsonRequest('PATCH', { action: 'company', ...company, manager_pin: companyPin })}>Save company details</button><button className="rounded-md border px-4 py-2 text-sm" onClick={() => { setCompanyEditing(false); setCompany(data?.company ?? null); setCompanyPin('') }}>Cancel</button></div>}
      </div>
    </div>
    <div className="space-y-4 rounded-lg border p-5"><div><h3 className="text-lg font-semibold">Handbook and training library</h3><p className="text-sm text-muted-foreground">Upload, preview, then publish a version. Earlier versions and acknowledgments remain in the record. Review the supplied handbook’s service mistake tip deduction language before publishing it.</p></div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">Type<select className={input} value={material.kind} onChange={e => setMaterial({ ...material, kind: e.target.value, title: e.target.value === 'handbook' ? 'Employee Handbook' : '' })}><option value="handbook">Handbook</option><option value="training">Training</option></select></label>
        <label className="text-sm">Title<input className={input} value={material.title} onChange={e => setMaterial({ ...material, title: e.target.value })} /></label>
        <label className="text-sm">Effective date<input className={input} type="date" value={material.effective_date} onChange={e => setMaterial({ ...material, effective_date: e.target.value })} /></label>
        <label className="text-sm">Completion<select className={input} value={material.acknowledgment_type} onChange={e => setMaterial({ ...material, acknowledgment_type: e.target.value })}><option value="signature">Typed signature</option><option value="quiz">Quiz and signature</option><option value="manager_demo">Manager demonstration</option></select></label>
        <label className="text-sm">Department keys (comma separated, blank for all)<input className={input} value={material.departments} onChange={e => setMaterial({ ...material, departments: e.target.value })} /></label>
        <label className="text-sm">PDF, Word, or text file<input type="file" className="mt-2 block w-full text-sm" accept=".pdf,.docx,.txt" onChange={e => setMaterialFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      {material.acknowledgment_type === 'quiz' && <div className="grid gap-2 md:grid-cols-2">{(['question','option1','option2','option3'] as const).map(key => <label key={key} className="text-sm capitalize">{key.replace('option','Answer ')}<input className={input} value={material[key]} onChange={e => setMaterial({ ...material, [key]: e.target.value })} /></label>)}<label className="text-sm">Correct answer<select className={input} value={material.correct} onChange={e => setMaterial({ ...material, correct: e.target.value })}><option value="0">Answer 1</option><option value="1">Answer 2</option><option value="2">Answer 3</option></select></label></div>}
      <button disabled={busy} className="rounded-md bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50" onClick={uploadMaterial}>Upload draft</button>
      <div className="space-y-1">{data?.materials.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm"><span>{row.title} v{row.version} · {row.kind} · {row.is_current ? 'current' : row.published_at ? 'archived' : 'draft'}</span><div className="flex flex-wrap items-center gap-3"><a className="text-blue-700 underline" target="_blank" rel="noreferrer" href={`/api/onboarding/file?material_id=${row.id}`}>Open</a>{!row.is_current && !row.published_at && <button className="rounded-md border px-2 py-1" disabled={busy} onClick={() => jsonRequest('PATCH', { action: 'publish_material', id: row.id })}>Publish</button>}{row.is_current && <><select aria-label={`Employee for ${row.title}`} className="max-w-64 rounded-md border px-2 py-1" value={reissueRecipients[row.id] ?? ''} onChange={e => setReissueRecipients(old => ({ ...old, [row.id]: e.target.value }))}><option value="">Select one employee</option>{data.employees.filter(employee => employee.email && (!row.departments?.length || row.departments.some(department => employee.schedule_departments?.includes(department) || employee.primary_department === department))).map(employee => <option key={employee.id} value={employee.id}>{employee.name} ({employee.email})</option>)}</select><button className="rounded-md border px-2 py-1 disabled:opacity-50" disabled={busy || !reissueRecipients[row.id]} onClick={() => { const employee = data.employees.find(item => item.id === reissueRecipients[row.id]); if (employee && window.confirm(`Send ${row.title} update to ${employee.name} (${employee.email}) only?`)) void jsonRequest('PATCH', { action: 'reissue_material', id: row.id, employee_id: employee.id }) }}>Send to selected employee</button></>}</div></div>)}</div>
    </div>
    <div className="space-y-4"><h3 className="text-lg font-semibold">Employee onboarding cases</h3>{!data?.cases.length && <p className="text-sm text-muted-foreground">No onboarding cases yet.</p>}
      {!!data?.cases.length && <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-2">Employee</th><th className="p-2">Status</th><th className="p-2">Missing documents or training</th></tr></thead><tbody>{data.cases.filter(row => row.status !== 'cancelled').map(row => <tr key={row.id} className="border-t"><td className="p-2"><button className="text-blue-700 underline" onClick={() => setSelectedCaseId(row.id)}>{[row.first_name, row.last_name].filter(Boolean).join(' ') || row.email}</button></td><td className="p-2">{row.status}</td><td className="p-2">{row.status === 'invited' ? 'Application pending' : missingForCase(row).join(', ') || 'Complete'}</td></tr>)}</tbody></table></div>}
      {!!data?.cases.length && <label className="block max-w-md text-sm">Work on one employee<select className={input} value={selectedCaseId} onChange={e => setSelectedCaseId(e.target.value)}><option value="">Select an employee</option>{data.cases.filter(row => row.status !== 'cancelled').map(row => <option key={row.id} value={row.id}>{[row.first_name, row.last_name].filter(Boolean).join(' ') || row.email} ({row.status})</option>)}</select></label>}
      {data?.cases.filter(row => row.id === selectedCaseId).map(row => { const current = edit(row); const docs = data.documents.filter(d => d.case_id === row.id); const acks = data.acknowledgments.filter(a => a.case_id === row.id); return <div key={row.id} className="space-y-3 rounded-lg border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-semibold">{[row.first_name,row.last_name].filter(Boolean).join(' ') || row.email}</h4><p className="text-xs text-muted-foreground">Sent to: {row.last_invite_email ?? row.email} · Status: {row.status} · Last email: {row.last_invite_sent_at ? new Date(row.last_invite_sent_at).toLocaleString() : 'not sent'}</p></div>{row.application_path && <a className="text-sm text-blue-700 underline" target="_blank" rel="noreferrer" href={`/api/onboarding/file?application_case_id=${row.id}`}>Initial application PDF</a>}</div>
        {['invited','submitted','approved'].includes(row.status) && <div className="flex gap-2"><button disabled={busy} className="rounded-md border px-3 py-1 text-xs disabled:opacity-50" onClick={() => { if (window.confirm(`Resend the private link to ${row.email}?`)) void jsonRequest('PATCH', { action: 'resend_invite', id: row.id }) }}>Resend private link</button><button disabled={busy} className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 disabled:opacity-50" onClick={() => { if (window.confirm(`Cancel onboarding for ${row.email}? The private link will stop working.`)) void jsonRequest('PATCH', { action: 'cancel_invite', id: row.id }) }}>Cancel invitation</button></div>}
        {row.status !== 'cancelled' && <div className="flex flex-wrap items-end gap-2 text-sm"><label>Assign handbook or training<select className={input} value={issueMaterials[row.id] ?? ''} onChange={e => setIssueMaterials(old => ({ ...old, [row.id]: e.target.value }))}><option value="">Select material</option>{data.materials.filter(item => item.is_current && !row.selected_documents.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.title} v{item.version}</option>)}</select></label><button className="rounded-md border px-3 py-2 disabled:opacity-50" disabled={busy || !issueMaterials[row.id]} onClick={() => { const item = data.materials.find(material => material.id === issueMaterials[row.id]); if (item && window.confirm(`Email ${item.title} to ${row.email} only?`)) void jsonRequest('PATCH', { action: 'issue_material', id: row.id, material_id: item.id }) }}>Assign and email</button></div>}
        {row.status === 'submitted' && <><div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">Role<select className={input} value={current.role ?? ''} onChange={e => setEdit(row.id, { role: e.target.value })}><option value="">Choose role</option>{roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
          <label className="text-sm">Primary department<select className={input} value={current.primary_department ?? ''} onChange={e => setEdit(row.id, { primary_department: e.target.value, schedule_departments: Array.from(new Set([...(current.schedule_departments ?? []), e.target.value])).filter(Boolean) })}><option value="">Choose department</option>{departments.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label>
          <label className="text-sm">Activation date<input type="date" className={input} value={current.activation_date ?? ''} onChange={e => setEdit(row.id, { activation_date: e.target.value })} /></label>
          {(['hourly_wage','guaranteed_hourly','tip_pool_hourly_rate'] as const).map(key => <label key={key} className="text-sm capitalize">{key.replaceAll('_',' ')}<input type="number" min="0" step="0.01" className={input} value={current[key] ?? ''} onChange={e => setEdit(row.id, { [key]: e.target.value } as Partial<Case>)} /></label>)}
          <label className="text-sm">Commission note<input className={input} value={current.commission_note ?? ''} onChange={e => setEdit(row.id, { commission_note: e.target.value })} /></label>
        </div><div className="space-y-1 text-sm"><p className="font-medium">Departments this employee can work in</p><div className="flex flex-wrap gap-3">{departments.map(d => <label key={d.key}><input type="checkbox" checked={(current.schedule_departments ?? []).includes(d.key)} onChange={e => { const selected = new Set(current.schedule_departments ?? []); if (e.target.checked) selected.add(d.key); else selected.delete(d.key); setEdit(row.id, { schedule_departments: [...selected] }) }} /> {d.label}</label>)}</div></div><div className="flex gap-4 text-sm"><label><input type="checkbox" checked={current.tip_eligible === true} onChange={e => setEdit(row.id, { tip_eligible: e.target.checked })} /> Tip eligible</label><label><input type="checkbox" checked={current.commission_enabled === true} onChange={e => setEdit(row.id, { commission_enabled: e.target.checked })} /> Commission enabled</label><span>Payment: manual check</span></div><button disabled={busy} className="rounded-md bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50" onClick={() => jsonRequest('PATCH', { action: 'approve', ...current, schedule_departments: current.schedule_departments ?? (current.primary_department ? [current.primary_department] : []) })}>Approve and schedule activation</button></>}
        {row.status === 'approved' && <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Activation date<input className={input} type="date" value={current.activation_date ?? ''} onChange={e => setEdit(row.id, { activation_date: e.target.value })} /></label><button disabled={busy} className="rounded-md border px-3 py-2 text-sm disabled:opacity-50" onClick={() => jsonRequest('PATCH', { action: 'update_activation', id: row.id, activation_date: current.activation_date })}>Save date</button><button disabled={busy} className="rounded-md bg-green-700 px-4 py-2 text-sm text-white disabled:opacity-50" onClick={() => jsonRequest('PATCH', { action: 'activate', id: row.id })}>Activate when date arrives</button></div>}
        <div className="text-xs text-muted-foreground">Acknowledgments: {acks.length}. {acks.map(a => { const item = data.materials.find(m => m.id === a.material_id); return `${item?.title ?? 'Document'} v${item?.version ?? '?'}${a.quiz_score == null ? '' : ` (${a.quiz_score}%)`}` }).join(', ')}</div>
        {data.materials.filter(m => m.is_current && m.acknowledgment_type === 'manager_demo' && !acks.some(a => a.material_id === m.id)).map(m => <button key={m.id} disabled={busy} className="rounded-md border px-3 py-1 text-xs disabled:opacity-50" onClick={() => jsonRequest('PATCH', { action: 'verify_training', case_id: row.id, material_id: m.id })}>Verify {m.title} demonstration</button>)}
        <div className="space-y-1">{docs.map(doc => <div key={doc.id} className="flex flex-wrap items-center gap-3 text-xs"><a className="text-blue-700 underline" target="_blank" rel="noreferrer" href={`/api/onboarding/file?document_id=${doc.id}`}>{doc.kind.toUpperCase()}: {doc.file_name}</a>{doc.manager_verified_at ? <span>Reviewed</span> : <button className="rounded border px-2 py-1" disabled={busy} onClick={() => jsonRequest('PATCH', { action: 'verify_document', id: doc.id })}>Mark reviewed</button>}</div>)}</div>
        {row.status !== 'invited' && <div className="flex flex-wrap gap-3 border-t pt-3 text-xs">{(['w4','i9','i9_id'] as const).map(kind => <label key={kind} className="rounded-md border px-3 py-2">Upload signed {kind.toUpperCase()}<input type="file" className="block max-w-48 pt-1" accept=".pdf,.jpg,.jpeg,.png" disabled={busy} onChange={e => uploadDocument(row.id, kind, e.target.files?.[0])} /></label>)}</div>}
        {row.status !== 'invited' && !row.record_email_sent_at && <button disabled={busy} className="rounded-md border px-3 py-1 text-xs disabled:opacity-50" onClick={() => jsonRequest('PATCH', { action: 'email_record', id: row.id })}>Email completed record</button>}
        {row.record_email_sent_at && <p className="text-xs text-green-700">Record email sent.</p>}
      </div> })}
    </div>
  </section>
}
