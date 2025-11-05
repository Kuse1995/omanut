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

    const { companyId, notificationType, data } = await req.json();

    console.log('Sending boss notification:', { companyId, notificationType });

    // Get company and boss phone
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('name, boss_phone, whatsapp_number')
      .eq('id', companyId)
      .single();

    if (companyError || !company || !company.boss_phone) {
      console.log('No boss phone configured for company:', companyId);
      return new Response(JSON.stringify({ success: false, message: 'No boss phone' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let message = '';

    switch (notificationType) {
      case 'new_reservation':
        message = `🎉 New Reservation!\n\nName: ${data.name}\nPhone: ${data.phone}\nGuests: ${data.guests}\nDate: ${data.date}\nTime: ${data.time}\n${data.area_preference ? `Area: ${data.area_preference}\n` : ''}${data.occasion ? `Occasion: ${data.occasion}` : ''}`;
        break;
      
      case 'interested_client':
        message = `👀 Interested Client Alert!\n\nCustomer: ${data.customer_name || 'Unknown'}\nPhone: ${data.phone}\nInterest: ${data.information}`;
        break;
      
      case 'conversation_summary':
        message = `📊 Conversation Summary\n\nCustomer: ${data.customer_name || 'Unknown'}\nDuration: ${data.duration}s\nQuality: ${data.quality_flag || 'N/A'}\n\nKey Points:\n${data.summary}`;
        break;
      
      case 'action_required':
        message = `⚠️ Action Required!\n\nType: ${data.action_type}\nPriority: ${data.priority}\n\n${data.description}\n\nCustomer: ${data.customer_name || 'N/A'}\nPhone: ${data.customer_phone || 'N/A'}`;
        break;
      
      default:
        message = data.message || 'Notification from AI assistant';
    }

    // Send via Twilio
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && company.whatsapp_number) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      
      const formData = new URLSearchParams();
      const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
        ? company.whatsapp_number 
        : `whatsapp:${company.whatsapp_number}`;
      const toNumber = company.boss_phone.startsWith('whatsapp:')
        ? company.boss_phone
        : `whatsapp:${company.boss_phone}`;
      
      formData.append('From', fromNumber);
      formData.append('To', toNumber);
      formData.append('Body', message);

      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!twilioResponse.ok) {
        const errorText = await twilioResponse.text();
        console.error('Twilio error:', errorText);
      } else {
        console.log('Boss notification sent successfully');
      }
    }

    // Log notification
    await supabase
      .from('boss_conversations')
      .insert({
        company_id: companyId,
        message_from: 'ai',
        message_content: message,
        response: null
      });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in send-boss-notification:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
