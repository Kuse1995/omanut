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

    // Get current delivery record to check retry count
    const { data: currentRecord, error: fetchError } = await supabase
      .from('media_delivery_status')
      .select('*')
      .eq('twilio_message_sid', messageSid)
      .single();

    if (fetchError || !currentRecord) {
      console.error('Delivery record not found:', messageSid);
      return new Response('Record not found', { status: 404, headers: corsHeaders });
    }

    // Update delivery status in database
    const updateData: any = {
      status: messageStatus,
      updated_at: new Date().toISOString()
    };

    if (messageStatus === 'delivered') {
      updateData.delivered_at = new Date().toISOString();
      // Clear retry schedule on successful delivery
      updateData.next_retry_at = null;
    } else if (messageStatus === 'failed' || messageStatus === 'undelivered') {
      updateData.failed_at = new Date().toISOString();
      if (errorCode) updateData.error_code = errorCode;
      if (errorMessage) updateData.error_message = errorMessage;
      
      // Schedule retry with exponential backoff if under max retries
      if (currentRecord.retry_count < currentRecord.max_retries) {
        const backoffMinutes = Math.pow(2, currentRecord.retry_count + 1); // 2, 4, 8, 16, 32 minutes
        const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
        updateData.next_retry_at = nextRetry;
        
        console.log(`Scheduled retry ${currentRecord.retry_count + 1}/${currentRecord.max_retries} in ${backoffMinutes} minutes for ${messageSid}`);
      } else {
        console.log(`Max retries (${currentRecord.max_retries}) reached for ${messageSid}, no more retries scheduled`);
      }
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
