import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { From, Body, ProfileName } = await req.formData().then(data => ({
      From: data.get('From') as string,
      Body: data.get('Body') as string,
      ProfileName: data.get('ProfileName')
    }));

    console.log('Management message received:', { From, Body, ProfileName });

    // Normalize phone numbers for comparison
    const normalizePhone = (phone: string) => {
      return phone.replace(/^whatsapp:/i, '').replace(/\+/g, '').replace(/\s/g, '');
    };
    
    const normalizedFrom = normalizePhone(From || '');

    // Find company by management phone
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('*, company_ai_overrides(*), company_documents(*)')
      .ilike('boss_phone', `%${normalizedFrom}%`)
      .single();

    if (companyError || !company) {
      console.error('Management phone not found:', From);
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
      });
    }

    console.log('Management company found:', company.name);

    // Get recent conversation stats
    const { data: recentConvs } = await supabase
      .from('conversations')
      .select('id, customer_name, phone, started_at, ended_at, status, quality_flag')
      .eq('company_id', company.id)
      .order('started_at', { ascending: false })
      .limit(10);

    // Get recent reservations
    const { data: recentReservations } = await supabase
      .from('reservations')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Specifically get demo bookings
    const { data: demoBookings } = await supabase
      .from('reservations')
      .select('*')
      .eq('company_id', company.id)
      .ilike('occasion', '%demo%')
      .order('created_at', { ascending: false })
      .limit(10);

    console.log('Demo bookings found:', demoBookings?.length || 0, demoBookings);

    // Get action items
    const { data: actionItems } = await supabase
      .from('action_items')
      .select('*')
      .eq('company_id', company.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5);

    // Get client insights
    const { data: clientInfo } = await supabase
      .from('client_information')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Build context for AI
    const knowledgeBase = company.company_documents
      ?.map((doc: any) => doc.parsed_content)
      .filter(Boolean)
      .join('\n\n') || '';

    const aiOverrides = company.company_ai_overrides?.[0];

    // Format data concisely for AI
    const conversationsSummary = recentConvs?.length 
      ? `${recentConvs.length} recent conversations:\n${recentConvs.map((c: any) => 
          `• ${c.customer_name || 'Unknown'} - ${c.status}${c.quality_flag ? `, Quality: ${c.quality_flag}` : ''}`
        ).join('\n')}`
      : 'No recent conversations';

    const demoBookingsSummary = demoBookings?.length
      ? `${demoBookings.length} demo bookings:\n${demoBookings.map((r: any) =>
          `• ${r.name} - ${r.date} at ${r.time} (${r.status})`
        ).join('\n')}`
      : 'No demo bookings';

    const reservationsSummary = recentReservations?.length
      ? `${recentReservations.length} recent reservations:\n${recentReservations.map((r: any) =>
          `• ${r.name} - ${r.guests} guests on ${r.date} at ${r.time} (${r.status})`
        ).join('\n')}`
      : 'No recent reservations';

    const actionItemsSummary = actionItems?.length
      ? `${actionItems.length} pending actions:\n${actionItems.map((a: any) =>
          `• [${a.priority}] ${a.action_type}: ${a.description}`
        ).join('\n')}`
      : 'No pending actions';

    const clientInsightsSummary = clientInfo?.length
      ? `${clientInfo.length} client insights:\n${clientInfo.map((i: any) =>
          `• ${i.customer_name || 'Unknown'}: ${i.information}`
        ).join('\n')}`
      : 'No client insights';

    const systemPrompt = `You are a business intelligence assistant for ${company.name}, a ${company.business_type}.

BUSINESS INFO:
Hours: ${company.hours}
Services: ${company.services}
${aiOverrides?.system_instructions ? `\nSpecial Instructions: ${aiOverrides.system_instructions}` : ''}

CURRENT DATA:
${conversationsSummary}

${demoBookingsSummary}

${reservationsSummary}

${actionItemsSummary}

${clientInsightsSummary}

${knowledgeBase ? `\nKNOWLEDGE BASE:\n${knowledgeBase}` : ''}

Provide clear, actionable insights. Be concise but thorough. Focus on what matters most for business operations.`;

    // Call Kimi AI (Moonshot)
    const KIMI_API_KEY = Deno.env.get('KIMI_API_KEY');
    
    console.log('Boss chat request:', { companyName: company.name, question: Body });
    
    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIMI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshot-v1-32k',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: Body }
        ],
        temperature: 0.3,
        max_tokens: 1000
      }),
    });

    const data = await response.json();
    
    if (!response.ok || !data.choices?.[0]?.message?.content) {
      console.error('Kimi AI API error:', data);
      throw new Error(`Kimi AI error: ${data.error?.message || 'Unknown error'}`);
    }
    
    const aiResponse = data.choices[0].message.content;
    console.log('AI response generated:', aiResponse.substring(0, 100) + '...');

    // Log management conversation
    await supabase
      .from('boss_conversations')
      .insert({
        company_id: company.id,
        message_from: 'management',
        message_content: Body,
        response: aiResponse
      });

    // Return TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${aiResponse}</Message>
</Response>`;

    return new Response(twiml, {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
    });

  } catch (error) {
    console.error("Error in management-chat:", error);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error processing your request.</Message></Response>',
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
    );
  }
});
