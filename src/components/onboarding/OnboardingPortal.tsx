'use client'

import { useCallback, useEffect, useState } from 'react'

type Material = { id: string; kind: string; title: string; version: number; required: boolean; acknowledgment_type: string; quiz: { questions: Array<{ prompt: string; options: string[] }> } | null }
type PortalData = { case: { email: string; status: string; first_name: string | null; last_name: string | null; activation_date: string | null; selected_documents: string[]; due_date: string | null }; materials: Material[]; acknowledgments: Array<{ material_id: string; quiz_score: number | null }>; documents: Array<{ kind: string; file_name: string; manager_verified_at: string | null }> }

const fieldClass = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'

export function OnboardingPortal({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', address: '', address_city: '', address_state: '', address_postal_code: '', employment_type: '', availability: {} as Record<string, { morning: boolean; evening: boolean }>, holiday_available: false, jobs: [{ company: '', start: '', end: '' }, { company: '', start: '', end: '' }], emergency_name: '', emergency_phone: '', emergency_relationship: '', pin: '', ssn: '', filing_status: '', w4_step3_amount: '' })
  const [signedName, setSignedName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [answers, setAnswers] = useState<Record<string, number[]>>({})
  const [openMaterialId, setOpenMaterialId] = useState('')

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/onboarding/portal?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Could not load onboarding')
    setData(json)
  }, [token])

  useEffect(() => { refresh().catch(e => setError(e.message)) }, [refresh])
  useEffect(() => {
    const materialId = new URLSearchParams(window.location.search).get('material')
    if (materialId && data?.materials.some(material => material.id === materialId)) {
      setOpenMaterialId(materialId)
      document.getElementById(`material-${materialId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [data])

  async function submit(action: string, payload: Record<string, unknown>) {
    setBusy(true); setError(''); setMessage('')
    try {
      const res = await fetch('/api/onboarding/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, action, ...payload }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      await refresh()
      setMessage(json.email_error ? `Application saved, but the document email failed: ${json.email_error}. Your documents are available on this page.` : action === 'submit' ? 'Application submitted. Your assigned documents are now available below and have been emailed to you.' : action === 'change_pin' ? 'PIN updated.' : 'Acknowledgment saved.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') } finally { setBusy(false) }
  }

  async function upload(kind: string, file: File | undefined) {
    if (!file) return
    setBusy(true); setError(''); setMessage('')
    try {
      const body = new FormData()
      body.set('token', token); body.set('kind', kind); body.set('file', file)
      const res = await fetch('/api/onboarding/file', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      await refresh(); setMessage('File uploaded for manager review.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed') } finally { setBusy(false) }
  }

  async function prefill(kind: 'w4' | 'i9') {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/onboarding/prefill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, kind }) })
      if (!res.ok) { const json = await res.json(); throw new Error(json.error ?? 'Could not prepare form') }
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a'); link.href = url; link.download = `prefilled-${kind}.pdf`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare form') } finally { setBusy(false) }
  }

  if (!data) return <main className="mx-auto max-w-3xl p-8"><h1 className="text-2xl font-semibold">New Village onboarding</h1><p className="mt-4">{error || 'Loading your invitation…'}</p></main>
  const fullName = `${data.case.first_name ?? ''} ${data.case.last_name ?? ''}`.trim()
  return <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
    <header><img src="/new-village-foh-logo.svg" alt="New Village" className="mb-3 h-16 w-auto" /><h1 className="text-3xl font-semibold">Employee onboarding</h1><p className="mt-2 text-sm text-slate-600">Invitation for {data.case.email}. Your application and documents are available through this private link. {data.case.due_date && `Please complete assigned items by ${data.case.due_date}.`}</p></header>
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-md bg-green-50 p-3 text-green-700">{message}</p>}
    {data.case.status === 'invited' ? <section className="space-y-4 rounded-lg border bg-white p-5">
      <div><h2 className="text-xl font-semibold">Initial application</h2><p className="text-sm text-slate-600">Name, phone, address, email, SSN, and a unique four-digit PIN are required. Your SSN is encrypted for tax and work authorization forms and omitted from the application PDF and email.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['first_name','last_name','phone','address','address_city','address_state','address_postal_code'] as const).map(key => <label key={key} className="text-sm capitalize">{key.replaceAll('_',' ')}<input className={fieldClass} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}
        <label className="text-sm">Four-digit PIN<input className={fieldClass} inputMode="numeric" maxLength={4} value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value })} /></label>
        <label className="text-sm">Social Security number<input type="password" className={fieldClass} inputMode="numeric" autoComplete="off" maxLength={11} value={form.ssn} onChange={e => setForm({ ...form, ssn: e.target.value })} /></label>
      </div>
      <label className="block text-sm">Employment sought<select className={fieldClass} value={form.employment_type} onChange={e => setForm({ ...form, employment_type: e.target.value })}><option value="">Not specified</option><option value="full_time">Full time</option><option value="part_time">Part time</option></select></label>
      <div className="space-y-2 text-sm"><p className="font-medium">Available days and shifts</p>{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day => <div key={day} className="flex items-center gap-5"><span className="w-24">{day}</span>{(['morning','evening'] as const).map(shift => <label key={shift}><input type="checkbox" checked={form.availability[day]?.[shift] ?? false} onChange={e => setForm({ ...form, availability: { ...form.availability, [day]: { morning: form.availability[day]?.morning ?? false, evening: form.availability[day]?.evening ?? false, [shift]: e.target.checked } } })} /> {shift}</label>)}</div>)}<label><input type="checkbox" checked={form.holiday_available} onChange={e => setForm({ ...form, holiday_available: e.target.checked })} /> Available on holidays</label></div>
      <div className="space-y-2"><p className="text-sm font-medium">Previous employment (last two jobs)</p>{form.jobs.map((job, index) => <div key={index} className="grid gap-2 sm:grid-cols-3"><label className="text-sm">Company {index + 1}<input className={fieldClass} value={job.company} onChange={e => setForm({ ...form, jobs: form.jobs.map((item, i) => i === index ? { ...item, company: e.target.value } : item) })} /></label>{(['start','end'] as const).map(key => <label key={key} className="text-sm capitalize">{key} date<input type="month" className={fieldClass} value={job[key]} onChange={e => setForm({ ...form, jobs: form.jobs.map((item, i) => i === index ? { ...item, [key]: e.target.value } : item) })} /></label>)}</div>)}</div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">W-4 filing status<select className={fieldClass} value={form.filing_status} onChange={e => setForm({ ...form, filing_status: e.target.value })}><option value="">Choose later</option><option value="single">Single or married filing separately</option><option value="married_joint">Married filing jointly or qualifying surviving spouse</option><option value="head_of_household">Head of household</option></select></label><label className="text-sm">W-4 Step 3 credit amount (optional)<input type="number" min="0" step="1" className={fieldClass} value={form.w4_step3_amount} onChange={e => setForm({ ...form, w4_step3_amount: e.target.value })} /></label></div><p className="text-xs text-slate-600">The current W-4 does not use a claim or allowance number. Step 3 is a dollar amount for eligible dependent and other credits. Use the <a className="text-blue-700 underline" href="https://www.irs.gov/individuals/tax-withholding-estimator" target="_blank" rel="noreferrer">IRS Tax Withholding Estimator</a> or the W-4 instructions to decide what to enter.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['emergency_name','emergency_phone','emergency_relationship'] as const).map(key => <label key={key} className="text-sm capitalize">{key.replace('emergency_','Emergency ')}<input className={fieldClass} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}
      </div>
      <button disabled={busy} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={() => submit('submit', { ...form, availability: { days: form.availability, holidays: form.holiday_available }, employment_history: JSON.stringify(form.jobs), emergency_contact: { name: form.emergency_name, phone: form.emergency_phone, relationship: form.emergency_relationship } })}>Submit application</button>
    </section> : <section className="rounded-lg border bg-white p-5"><h2 className="text-xl font-semibold">Application received</h2><p className="text-sm text-slate-600">Status: {data.case.status}. {data.case.activation_date ? `Staff app access is scheduled for ${data.case.activation_date}.` : 'Your manager will set your activation date.'}</p></section>}
    {['submitted','approved'].includes(data.case.status) && <section className="rounded-lg border bg-white p-5"><h2 className="text-lg font-semibold">PIN</h2><p className="text-sm text-slate-600">If your PIN conflicts with another employee before activation, choose a new one here.</p><div className="mt-2 flex gap-2"><input className={fieldClass} inputMode="numeric" maxLength={4} placeholder="New four-digit PIN" value={newPin} onChange={e => setNewPin(e.target.value)} /><button disabled={busy} className="rounded-md border px-3 text-sm" onClick={async () => { await submit('change_pin', { pin: newPin }); setNewPin('') }}>Change PIN</button></div></section>}
    {data.case.status !== 'invited' && <>
      <section className="space-y-4 rounded-lg border bg-white p-5"><h2 className="text-xl font-semibold">Handbook and training</h2>
        {data.materials.length === 0 && <p className="text-sm text-slate-600">Your manager has not published materials yet.</p>}
        {data.materials.map(material => { const done = data.acknowledgments.some(a => a.material_id === material.id); return <div key={material.id} id={`material-${material.id}`} className="scroll-mt-6 space-y-3 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{material.title} <span className="text-xs text-slate-500">v{material.version}</span></h3><p className="text-xs text-slate-500">{material.kind} · {material.acknowledgment_type.replace('_',' ')} {material.required ? '· required' : ''}</p></div><button className="text-sm text-blue-700 underline" onClick={() => setOpenMaterialId(openMaterialId === material.id ? '' : material.id)}>{openMaterialId === material.id ? 'Close document' : 'Read document'}</button></div>
          {openMaterialId === material.id && <iframe title={`${material.title} document`} className="h-[36rem] w-full rounded border" src={`/api/onboarding/file?token=${encodeURIComponent(token)}&material_id=${material.id}&preview=1`} />}
          {done ? <p className="text-sm text-green-700">Completed</p> : material.acknowledgment_type === 'manager_demo' ? <p className="text-sm text-slate-600">Ask your manager to verify this practical training.</p> : <>
            {material.quiz?.questions.map((q, index) => <label key={index} className="block text-sm">{q.prompt}<select className={fieldClass} value={answers[material.id]?.[index] ?? ''} onChange={e => setAnswers(prev => { const next = [...(prev[material.id] ?? [])]; next[index] = Number(e.target.value); return { ...prev, [material.id]: next } })}><option value="">Select answer</option>{q.options.map((option, i) => <option key={i} value={i}>{option}</option>)}</select></label>)}
            <label className="block text-sm">Type your full name to sign ({fullName})<input className={fieldClass} value={signedName} onChange={e => setSignedName(e.target.value)} /></label>
            <button disabled={busy} className="rounded-md bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => submit('acknowledge', { material_id: material.id, signed_name: signedName, answers: answers[material.id] ?? [] })}>Confirm I reviewed this material</button>
          </>}
        </div> })}
      </section>
      {data.case.status !== 'active' && <section className="space-y-3 rounded-lg border bg-white p-5"><h2 className="text-xl font-semibold">Tax and work authorization forms</h2><p className="text-sm text-slate-600">Review the prefilled official forms, finish remaining fields, sign your section, then upload them. Your SSN is encrypted and used only for these forms. See the official I-9 list for acceptable identity documents.</p>
        <div className="flex flex-wrap gap-2">{data.case.selected_documents.includes('w4') && <button disabled={busy} className="rounded-md border px-3 py-2 text-sm" onClick={() => prefill('w4')}>Download prefilled W-4</button>}{data.case.selected_documents.includes('i9') && <button disabled={busy} className="rounded-md border px-3 py-2 text-sm" onClick={() => prefill('i9')}>Download prefilled I-9</button>}</div>
        <div className="flex gap-4 text-sm"><a className="text-blue-700 underline" target="_blank" rel="noreferrer" href="https://www.irs.gov/pub/irs-pdf/fw4.pdf">Latest IRS W-4</a><a className="text-blue-700 underline" target="_blank" rel="noreferrer" href="https://www.uscis.gov/i-9">I-9 instructions and document list</a></div>
        {(['w4','i9','i9_id'] as const).filter(kind => data.case.selected_documents.includes(kind === 'i9_id' ? 'i9' : kind)).map(kind => <label key={kind} className="block text-sm font-medium uppercase">{kind === 'i9_id' ? 'Optional I-9 document copy' : kind}<input type="file" className="mt-1 block w-full text-sm" accept=".pdf,.jpg,.jpeg,.png" disabled={busy} onChange={e => upload(kind, e.target.files?.[0])} /></label>)}
        {data.documents.map((doc, i) => <p key={i} className="text-xs text-slate-600">{doc.kind.toUpperCase()}: {doc.file_name} {doc.manager_verified_at ? '· manager reviewed' : '· pending review'}</p>)}
      </section>}
    </>}
  </main>
}
