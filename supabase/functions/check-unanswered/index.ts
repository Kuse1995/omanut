import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return new Response(JSON.stringify({ error: 'Missing Twilio credentials' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Find conversations where the last message is from 'user', older than 3 minutes,
    // with no subsequent 'assistant' message, and not already in human takeover
    const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();

    const { data: unanswered, error } = await supabase.rpc('find_unanswered_conversations', {
      cutoff_time: threeMinAgo
    });

    if (error) {
      console.error('[CHECK-UNANSWERED] RPC error, falling back to direct query:', error);
      // Fallback: direct query approach
      const { data: recentConvos } = await supabase
        .from('conversations')
        .select('id, company_id, phone, customer_name, last_message_at')
        .eq('status', 'active')
        .eq('human_takeover', false)
        .lt('last_message_at', threeMinAgo)
        .gt('last_message_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()) // Only last 30 min
        .limit(50);

      if (!recentConvos || recentConvos.length === 0) {
        return new Response(JSON.stringify({ checked: 0, recovered: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let recovered = 0;
      for (const conv of recentConvos) {
        // Check if last message is from user (no assistant reply after it)
        const { data: lastMsg } = await supabase
          .from('messages')
          .select('role, created_at')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (lastMsg?.role !== 'user') continue;

        // This conversation has an unanswered user message
        recovered += await recoverConversation(supabase, conv, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      }

      return new Response(JSON.stringify({ checked: recentConvos.length, recovered }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let recovered = 0;
    if (unanswered && unanswered.length > 0) {
      for (const conv of unanswered) {
        recovered += await recoverConversation(supabase, conv, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      }
    }

    console.log(`[CHECK-UNANSWERED] Checked. Found ${unanswered?.length || 0} unanswered, recovered ${recovered}`);

    return new Response(JSON.stringify({ 
      checked: unanswered?.length || 0, 
      recovered 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[CHECK-UNANSWERED] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function recoverConversation(
  supabase: any,
  conv: any,
  twilioSid: string,
  twilioToken: string
): Promise<number> {
  try {
    const companyId = conv.company_id;
    const customerPhone = conv.phone;

    if (!customerPhone) return 0;

    // Get company info
    const { data: company } = await supabase
      .from('companies')
      .select('whatsapp_number, boss_phone, name')
      .eq('id', companyId)
      .single();

    if (!company?.whatsapp_number) return 0;

    // Get fallback message
    const { data: aiOverrides } = await supabase
      .from('company_ai_overrides')
      .select('fallback_message')
      .eq('company_id', companyId)
      .single();

    const fallbackMsg = aiOverrides?.fallback_message ||
      "Sorry for the delay! I'm here now — how can I help you?";

    // Send fallback to customer
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const fromNumber = company.whatsapp_number.startsWith('whatsapp:')
      ? company.whatsapp_number
      : `whatsapp:${company.whatsapp_number}`;

    const cleanPhone = customerPhone.replace(/^whatsapp:/, '');
    const toNumber = cleanPhone.startsWith('+') ? `whatsapp:${cleanPhone}` : `whatsapp:+${cleanPhone}`;

    const formData = new URLSearchParams();
    formData.append('From', fromNumber);
    formData.append('To', toNumber);
    formData.append('Body', fallbackMsg);

    const twilioResp = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!twilioResp.ok) {
      console.error(`[RECOVER] Twilio error for ${conv.id}:`, await twilioResp.text());
      return 0;
    }

    // Save message
    await supabase.from('messages').insert({
      conversation_id: conv.id,
      role: 'assistant',
      content: fallbackMsg
    });

    // Log the recovery
    await supabase.from('ai_error_logs').insert({
      company_id: companyId,
      conversation_id: conv.id,
      error_type: 'unanswered_message',
      severity: 'high',
      original_message: `Customer ${customerPhone} waited >3min with no response`,
      ai_response: fallbackMsg,
      status: 'auto_recovered'
    });

    // Mark for human attention
    await supabase.from('conversations').update({
      human_takeover: true,
      takeover_at: new Date().toISOString()
    }).eq('id', conv.id);

    // Notify boss
    if (company.boss_phone) {
      const bossMsg = `⚠️ Unanswered Message Detected\n\nCustomer: ${customerPhone}\nCompany: ${company.name}\n\nThe AI failed to respond within 3 minutes. A fallback message was sent and the conversation is marked for takeover.`;
      const bossForm = new URLSearchParams();
      bossForm.append('From', fromNumber);
      bossForm.append('To', company.boss_phone.startsWith('whatsapp:') ? company.boss_phone : `whatsapp:${company.boss_phone}`);
      bossForm.append('Body', bossMsg);

      await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioToken}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bossForm.toString(),
      });
    }

    console.log(`[RECOVER] Recovered conversation ${conv.id} for ${customerPhone}`);
    return 1;
  } catch (e) {
    console.error(`[RECOVER] Error recovering ${conv.id}:`, e);
    return 0;
  }
}
