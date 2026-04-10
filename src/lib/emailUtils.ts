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

export function buildEmailDocument(logoUrl: string, title: string, reportBodyHtml: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #111827; background: #fff; font-size: 12px; line-height: 1.45; margin: 0; padding: 24px 16px; }
    .shell { max-width: 700px; margin: 0 auto; }
    .logo-wrap { text-align: center; padding: 0 0 20px; }
    .logo-wrap img { max-width: 200px; width: 100%; height: auto; }
    h1 { font-size: 20px; margin: 0 0 6px; }
    h2 { font-size: 15px; margin: 0 0 8px; }
    h3 { font-size: 13px; margin: 16px 0 6px; color: #374151; }
    p { margin: 0 0 10px; color: #374151; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 7px 10px; font-size: 11px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 600; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; margin: 14px 0; }
    .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 10px; }
    .card strong { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 5px; }
    .metric { font-size: 20px; font-weight: 700; line-height: 1.1; }
    .muted { color: #6b7280; font-size: 10px; }
    .right { text-align: right; }
    .report-grid { display: grid; grid-template-columns: minmax(0,1.4fr) minmax(220px,0.9fr); gap: 14px; margin-top: 14px; }
    .compact-table th, .compact-table td { padding-top: 5px; padding-bottom: 5px; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="logo-wrap">
      <img src="${logoUrl}" alt="Logo" />
    </div>
    ${reportBodyHtml}
  </div>
</body>
</html>`
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
