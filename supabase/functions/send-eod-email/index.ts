// Supabase Edge Function (alternative deployment)
// Deploy with: supabase functions deploy send-eod-email
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type TipDistributionRow = {
  hours_worked: number
  net_tip: number
  employee?: {
    name?: string
  } | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const { eod_report_id, recipient_email } = await req.json()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: report } = await supabase
    .from('eod_reports')
    .select('*, closed_by:employees(*), tip_distributions(*, employee:employees(*))')
    .eq('id', eod_report_id)
    .single()

  if (!report) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders })

  const tipRows = ((report.tip_distributions ?? []) as TipDistributionRow[])
    .map((d) => `<tr><td>${d.employee?.name}</td><td>${d.hours_worked}h</td><td>$${Number(d.net_tip).toFixed(2)}</td></tr>`)
    .join('')

  const html = `
    <h2>FOH End of Day Report — ${report.session_date}</h2>
    <p>Closed by: ${report.closed_by?.name ?? 'N/A'}</p>
    <table border="1" cellpadding="6">
      <tr><td>Revenue Total</td><td>$${Number(report.revenue_total).toFixed(2)}</td></tr>
      <tr><td>Tip Total</td><td>$${Number(report.tip_total).toFixed(2)}</td></tr>
      <tr><td>Cash Deposit</td><td>$${Number(report.cash_deposit).toFixed(2)}</td></tr>
    </table>
    <h3>Tip Distribution</h3>
    <table border="1" cellpadding="6"><tr><th>Name</th><th>Hours</th><th>Tip</th></tr>${tipRows}</table>
  `

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'FOH Dashboard <noreply@mail.newvillagepub.com>',
      to: [recipient_email ?? Deno.env.get('EOD_REPORT_EMAIL')],
      subject: `EOD Report — ${report.session_date}`,
      html,
    }),
  })

  return new Response(JSON.stringify({ ok: resendRes.ok }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
