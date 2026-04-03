import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Find recently completed queue items (completed in last 30 min) that haven't had CSAT sent
    // We check support_tickets.satisfaction_score IS NULL to avoid duplicate surveys
    const { data: completedItems, error } = await supabase
      .from('agent_queue')
      .select('*, support_tickets!inner(id, ticket_number, satisfaction_score, customer_phone, customer_name)')
      .eq('status', 'completed')
      .not('completed_at', 'is', null)
      .gte('completed_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())

    if (error) throw error

    let sent = 0

    for (const item of completedItems || []) {
      const ticket = item.support_tickets
      if (!ticket || ticket.satisfaction_score !== null) continue
      if (!ticket.customer_phone) continue

      const { data: company } = await supabase
        .from('companies')
        .select('whatsapp_number, name')
        .eq('id', item.company_id)
        .single()

      if (!company?.whatsapp_number) continue

      // Check service_mode - only send CSAT in human_first or hybrid
      const { data: overrides } = await supabase
        .from('company_ai_overrides')
        .select('service_mode')
        .eq('company_id', item.company_id)
        .single()

      if (!overrides || overrides.service_mode === 'autonomous') continue

      const customerName = ticket.customer_name || item.customer_name || 'there'
      const message = `Hi ${customerName} 👋\n\n` +
        `Your issue (${ticket.ticket_number}) has been resolved by our team at ${company.name}.\n\n` +
        `How would you rate your experience? Please reply with a number:\n` +
        `1 ⭐ - Poor\n` +
        `2 ⭐⭐ - Fair\n` +
        `3 ⭐⭐⭐ - Good\n` +
        `4 ⭐⭐⭐⭐ - Very Good\n` +
        `5 ⭐⭐⭐⭐⭐ - Excellent\n\n` +
        `Thank you for your feedback! 🙏`

      try {
        await supabase.functions.invoke('send-whatsapp-message', {
          body: {
            to: ticket.customer_phone,
            message,
            from: company.whatsapp_number
          }
        })

        // Mark with score -1 to indicate survey sent (will be updated when customer replies)
        await supabase
          .from('support_tickets')
          .update({ satisfaction_score: -1 })
          .eq('id', ticket.id)

        sent++
      } catch (e) {
        console.error('Failed to send CSAT for ticket:', ticket.ticket_number, e)
      }
    }

    return new Response(
      JSON.stringify({ surveys_sent: sent, checked: (completedItems || []).length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('CSAT followup error:', error)
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
