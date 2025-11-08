import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Parse Twilio status callback payload
    const formData = await req.formData();
    const messageSid = formData.get('MessageSid') as string;
    const messageStatus = formData.get('MessageStatus') as string;
    const errorCode = formData.get('ErrorCode') as string | null;
    const errorMessage = formData.get('ErrorMessage') as string | null;

    console.log('Twilio status callback received:', {
      messageSid,
      messageStatus,
      errorCode,
      errorMessage
    });

    if (!messageSid) {
      return new Response('Missing MessageSid', { status: 400, headers: corsHeaders });
    }

    // Update delivery status in database
    const updateData: any = {
      status: messageStatus,
      updated_at: new Date().toISOString()
    };

    if (messageStatus === 'delivered') {
      updateData.delivered_at = new Date().toISOString();
    } else if (messageStatus === 'failed' || messageStatus === 'undelivered') {
      updateData.failed_at = new Date().toISOString();
      if (errorCode) updateData.error_code = errorCode;
      if (errorMessage) updateData.error_message = errorMessage;
    }

    const { error } = await supabase
      .from('media_delivery_status')
      .update(updateData)
      .eq('twilio_message_sid', messageSid);

    if (error) {
      console.error('Error updating delivery status:', error);
      return new Response('Database error', { status: 500, headers: corsHeaders });
    }

    console.log(`Media delivery status updated: ${messageSid} -> ${messageStatus}`);

    // Return TwiML response (Twilio expects 200 OK)
    return new Response('OK', { status: 200, headers: corsHeaders });

  } catch (error) {
    console.error('Error in twilio-status-webhook:', error);
    return new Response('Internal error', { status: 500, headers: corsHeaders });
  }
});
