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

    // Find queue items that have breached SLA
    const { data: breachedItems, error: fetchError } = await supabase
      .from('agent_queue')
      .select('*, support_tickets(ticket_number)')
      .in('status', ['waiting', 'assigned'])
      .not('sla_deadline', 'is', null)
      .lt('sla_deadline', new Date().toISOString())

    if (fetchError) throw fetchError

    const escalated: string[] = []

    for (const item of breachedItems || []) {
      // Bump priority
      const priorityOrder = ['low', 'medium', 'high', 'urgent']
      const currentIdx = priorityOrder.indexOf(item.priority)
      const newPriority = currentIdx < priorityOrder.length - 1 
        ? priorityOrder[currentIdx + 1] 
        : 'urgent'

      if (newPriority !== item.priority) {
        await supabase
          .from('agent_queue')
          .update({ priority: newPriority })
          .eq('id', item.id)

        // Also update the support ticket priority
        if (item.ticket_id) {
          await supabase
            .from('support_tickets')
            .update({ priority: newPriority })
            .eq('id', item.ticket_id)
        }
      }

      // Notify boss via WhatsApp
      const { data: company } = await supabase
        .from('companies')
        .select('boss_phone, whatsapp_number, name')
        .eq('id', item.company_id)
        .single()

      if (company?.boss_phone) {
        const ticketNum = item.support_tickets?.ticket_number || 'N/A'
        const message = `⚠️ *SLA BREACH - ${company.name}*\n\n` +
          `Ticket: ${ticketNum}\n` +
          `Customer: ${item.customer_name || 'Unknown'}\n` +
          `Priority: ${item.priority} → ${newPriority}\n` +
          `Status: ${item.status}\n` +
          `Summary: ${item.ai_summary || 'No summary'}\n\n` +
          `This ticket has exceeded its SLA deadline and needs immediate attention.`

        try {
          await supabase.functions.invoke('send-whatsapp-message', {
            body: { 
              to: company.boss_phone, 
              message,
              from: company.whatsapp_number 
            }
          })
        } catch (e) {
          console.error('Failed to notify boss:', e)
        }
      }

      escalated.push(item.id)
    }

    // Update wait_time_seconds for all waiting items
    const { data: waitingItems } = await supabase
      .from('agent_queue')
      .select('id, created_at')
      .eq('status', 'waiting')

    for (const item of waitingItems || []) {
      const waitSeconds = Math.floor((Date.now() - new Date(item.created_at).getTime()) / 1000)
      await supabase
        .from('agent_queue')
        .update({ wait_time_seconds: waitSeconds })
        .eq('id', item.id)
    }

    return new Response(
      JSON.stringify({ 
        escalated: escalated.length, 
        checked: (breachedItems || []).length,
        wait_times_updated: (waitingItems || []).length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('SLA escalation error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
