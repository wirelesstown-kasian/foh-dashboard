'use client'

import { useEffect, useState } from 'react'

type StaffDocument = { id: string; name: string; uploadedAt: string }

export function StaffLegalDocuments({ employeeId }: { employeeId: string }) {
  const [documents, setDocuments] = useState<StaffDocument[] | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const endpoint = `/api/staff/legal-documents?employee_id=${encodeURIComponent(employeeId)}`

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Could not load legal documents.')
      if (!controller.signal.aborted) setDocuments(result.documents)
    }
    void load().catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [endpoint])

  async function upload(file: File) {
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.set('employee_id', employeeId)
      form.set('file', file)
      const response = await fetch(endpoint, { method: 'POST', body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Could not upload the legal document.')
      setDocuments(current => [result.document, ...(current ?? [])])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not upload the legal document.')
    } finally {
      setUploading(false)
    }
  }

  return <section className="space-y-2 rounded-lg border bg-slate-50 p-3 text-sm">
    <h3 className="font-medium">Legal documents</h3>
    <label className="block">
      Upload a legal document
      <input type="file" accept=".pdf,.docx,.jpg,.jpeg,.png" disabled={uploading || !documents}
        className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-white file:px-3 file:py-2"
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void upload(file)
        }} />
    </label>
    <p className="text-xs text-muted-foreground">PDF, Word, JPG, or PNG up to 4 MB. Manager access only.</p>
    {uploading && <p role="status">Uploading…</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!documents && !error && <p role="status">Loading documents…</p>}
    {documents?.length === 0 && <p className="text-muted-foreground">No legal documents uploaded here.</p>}
    {documents && documents.length > 0 && <ul className="space-y-1">
      {documents.map(document => <li key={document.id}>
        <a className="text-blue-700 underline" href={`${endpoint}&document=${encodeURIComponent(document.id)}`}>{document.name}</a>
      </li>)}
    </ul>}
  </section>
}
