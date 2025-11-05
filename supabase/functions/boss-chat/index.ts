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
      From: data.get('From'),
      Body: data.get('Body'),
      ProfileName: data.get('ProfileName')
    }));

    console.log('Boss message received:', { From, Body, ProfileName });

    // Find company by boss phone
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('*, company_ai_overrides(*), company_documents(*)')
      .eq('boss_phone', From)
      .single();

    if (companyError || !company) {
      console.error('Boss phone not found:', From);
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
      });
    }

    console.log('Boss company found:', company.name);

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
      .limit(5);

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

    const systemPrompt = `You are an AI assistant reporting to the boss of ${company.name}.
The boss can ask you questions about customer interactions, reservations, and business insights.

Business Context:
- Type: ${company.business_type}
- Hours: ${company.hours}
- Offerings: ${company.menu_or_offerings}

${aiOverrides?.system_instructions ? `Special Instructions: ${aiOverrides.system_instructions}` : ''}

${knowledgeBase ? `Knowledge Base:\n${knowledgeBase}` : ''}

Recent Conversation Stats (last 10):
${recentConvs?.map((c: any) => `- ${c.customer_name || 'Unknown'} (${c.phone}): ${c.status}, Quality: ${c.quality_flag || 'N/A'}`).join('\n') || 'No recent conversations'}

Recent Reservations:
${recentReservations?.map((r: any) => `- ${r.name} (${r.phone}): ${r.guests} guests on ${r.date} at ${r.time}, Status: ${r.status}`).join('\n') || 'No recent reservations'}

Pending Action Items:
${actionItems?.map((a: any) => `- ${a.action_type}: ${a.description} (${a.priority} priority)`).join('\n') || 'No pending actions'}

Client Insights:
${clientInfo?.map((i: any) => `- ${i.customer_name || 'Unknown'}: ${i.info_type} - ${i.information}`).join('\n') || 'No client insights'}

Respond professionally and provide actionable insights when asked.`;

    // Call OpenAI
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: Body }
        ],
        max_tokens: 500
      }),
    });

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    console.log('AI response for boss:', aiResponse);

    // Log boss conversation
    await supabase
      .from('boss_conversations')
      .insert({
        company_id: company.id,
        message_from: 'boss',
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
    console.error("Error in boss-chat:", error);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error processing your request.</Message></Response>',
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/xml' } }
    );
  }
});
