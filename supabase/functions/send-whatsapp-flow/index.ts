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
    const { flow_type, header_text, button_text, prefill_data, customer_phone, company_id } = await req.json();
    
    console.log('[SEND-FLOW] Request:', { flow_type, customer_phone, company_id });

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch company data to get flow IDs and WhatsApp number
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('whatsapp_reservation_flow_id, whatsapp_payment_flow_id, whatsapp_number')
      .eq('id', company_id)
      .single();

    if (companyError || !company) {
      console.error('[SEND-FLOW] Company fetch error:', companyError);
      return new Response(
        JSON.stringify({ 
          error: 'Company not found or flow not configured',
          details: companyError?.message 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the appropriate flow ID based on type
    let flowId: string | null = null;
    if (flow_type === 'reservation') {
      flowId = company.whatsapp_reservation_flow_id;
    } else if (flow_type === 'payment') {
      flowId = company.whatsapp_payment_flow_id;
    }

    if (!flowId) {
      console.error('[SEND-FLOW] Flow ID not configured for type:', flow_type);
      return new Response(
        JSON.stringify({ 
          error: `WhatsApp Flow not configured for ${flow_type}. Please configure in company settings.`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send WhatsApp Flow via Twilio
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured');
    }

    const fromNumber = company.whatsapp_number?.startsWith('whatsapp:') 
      ? company.whatsapp_number 
      : `whatsapp:${company.whatsapp_number}`;
    const toNumber = customer_phone.startsWith('whatsapp:') 
      ? customer_phone 
      : `whatsapp:${customer_phone}`;

    // Prepare content variables for pre-filling
    const contentVariables: Record<string, string> = {};
    if (prefill_data) {
      Object.keys(prefill_data).forEach(key => {
        contentVariables[key] = String(prefill_data[key]);
      });
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const formData = new URLSearchParams();
    formData.append('From', fromNumber);
    formData.append('To', toNumber);
    formData.append('ContentSid', flowId);
    
    // Add content variables if any
    if (Object.keys(contentVariables).length > 0) {
      formData.append('ContentVariables', JSON.stringify(contentVariables));
    }

    console.log('[SEND-FLOW] Sending Twilio request:', {
      from: fromNumber,
      to: toNumber,
      contentSid: flowId,
      hasVariables: Object.keys(contentVariables).length > 0
    });

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const twilioData = await twilioResponse.json();
    
    if (!twilioResponse.ok) {
      console.error('[SEND-FLOW] Twilio error:', twilioData);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to send WhatsApp Flow',
          twilioError: twilioData 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[SEND-FLOW] Flow sent successfully:', twilioData.sid);

    return new Response(
      JSON.stringify({ 
        success: true,
        message_sid: twilioData.sid,
        flow_type 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SEND-FLOW] Error:', error);
    const errorMessage = 'An error occurred processing your request';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
