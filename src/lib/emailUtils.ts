/** Escape user-supplied strings before embedding in HTML email bodies. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function formatTime(time: string): string {
  if (!time) return ''
  const [h, m] = time.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

export function calcHours(startTime: string, endTime: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const start = toMinutes(startTime)
  let end = toMinutes(endTime)
  if (end <= start) end += 24 * 60
  return Math.round(((end - start) / 60) * 100) / 100
}

export function formatHours(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function formatDisplayDate(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatCalendarDay(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
}

export function renderEmailShell(logoUrl: string, content: string, maxWidth = 520) {
  return `
    <div style="font-family:sans-serif;max-width:${maxWidth}px">
      <div style="padding:8px 0 18px;text-align:center">
        <img
          src="${logoUrl}"
          alt="New Village Pub logo"
          style="display:inline-block;max-width:220px;width:100%;height:auto;object-fit:contain"
        />
      </div>
      ${content}
    </div>
  `
}

export async function sendEmail({
  resendKey,
  to,
  subject,
  html,
  fromName = 'FOH Dashboard',
  fromEmail = 'noreply@mail.newvillagepub.com',
  replyTo,
}: {
  resendKey: string
  to: string
  subject: string
  html: string
  fromName?: string
  fromEmail?: string
  replyTo?: string | null
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      reply_to: replyTo && replyTo.trim() ? replyTo.trim() : undefined,
      subject,
      html,
    }),
  })
  if (!res.ok) {
    const rawBody = await res.text()
    let message = rawBody

    try {
      const parsed = JSON.parse(rawBody) as { message?: string; error?: { message?: string } }
      message = parsed.error?.message ?? parsed.message ?? rawBody
    } catch {
      // Keep the raw response body when Resend does not return JSON.
    }

    throw new Error(`Email send failed (${res.status}): ${message}`)
  }
}
