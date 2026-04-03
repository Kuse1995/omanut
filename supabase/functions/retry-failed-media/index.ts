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

    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured');
    }

    // Find all failed deliveries that need retry
    const now = new Date().toISOString();
    const { data: failedDeliveries, error: fetchError } = await supabase
      .from('media_delivery_status')
      .select('*, companies(whatsapp_number)')
      .in('status', ['failed', 'undelivered'])
      .lt('retry_count', supabase.rpc('max_retries'))
      .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
      .limit(50); // Process 50 at a time

    if (fetchError) {
      console.error('Error fetching failed deliveries:', fetchError);
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!failedDeliveries || failedDeliveries.length === 0) {
      console.log('No failed deliveries to retry');
      return new Response(JSON.stringify({ 
        message: 'No failed deliveries to retry',
        processed: 0
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing ${failedDeliveries.length} failed deliveries`);

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (const delivery of failedDeliveries) {
      try {
        // Check if max retries reached
        if (delivery.retry_count >= delivery.max_retries) {
          console.log(`Max retries reached for delivery ${delivery.id}`);
          skippedCount++;
          continue;
        }

        // Get company WhatsApp number
        const company = delivery.companies;
        if (!company || !company.whatsapp_number) {
          console.error(`No WhatsApp number for delivery ${delivery.id}`);
          skippedCount++;
          continue;
        }

        const fromNumber = company.whatsapp_number.startsWith('whatsapp:') 
          ? company.whatsapp_number 
          : `whatsapp:${company.whatsapp_number}`;

        // Generate new signed URL (valid for 1 hour)
        const urlParts = delivery.media_url.split('/storage/v1/object/');
        if (urlParts.length !== 2) {
          console.error(`Invalid media URL format: ${delivery.media_url}`);
          skippedCount++;
          continue;
        }

        const pathWithBucket = urlParts[1];
        const filePath = pathWithBucket.replace('company-media/', '').replace('public/', '');

        const { data: signedData, error: signError } = await supabase
          .storage
          .from('company-media')
          .createSignedUrl(filePath, 3600);

        if (signError || !signedData?.signedUrl) {
          console.error(`Error generating signed URL for ${delivery.id}:`, signError);
          failCount++;
          continue;
        }

        // Retry sending via Twilio
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
        const statusCallbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-status-webhook`;

        const formData = new URLSearchParams();
        formData.append('From', fromNumber);
        formData.append('To', `whatsapp:${delivery.customer_phone}`);
        formData.append('Body', `Retry ${delivery.retry_count + 1}/${delivery.max_retries}`);
        formData.append('MediaUrl', signedData.signedUrl);
        formData.append('StatusCallback', statusCallbackUrl);

        const twilioResponse = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        });

        if (twilioResponse.ok) {
          const twilioData = await twilioResponse.json();
          const newRetryCount = delivery.retry_count + 1;
          
          // Update delivery record
          await supabase
            .from('media_delivery_status')
            .update({
              twilio_message_sid: twilioData.sid,
              status: 'queued',
              retry_count: newRetryCount,
              last_retry_at: new Date().toISOString(),
              next_retry_at: null, // Clear next retry time
              updated_at: new Date().toISOString()
            })
            .eq('id', delivery.id);

          console.log(`Successfully retried delivery ${delivery.id}, attempt ${newRetryCount}`);
          successCount++;
        } else {
          const errorText = await twilioResponse.text();
          console.error(`Twilio error for ${delivery.id}:`, twilioResponse.status, errorText);
          
          // Calculate next retry time with exponential backoff
          const newRetryCount = delivery.retry_count + 1;
          const backoffMinutes = Math.pow(2, newRetryCount); // 1, 2, 4, 8, 16 minutes
          const nextRetry = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

          await supabase
            .from('media_delivery_status')
            .update({
              retry_count: newRetryCount,
              last_retry_at: new Date().toISOString(),
              next_retry_at: nextRetry,
              error_message: `Retry ${newRetryCount} failed: ${errorText}`,
              updated_at: new Date().toISOString()
            })
            .eq('id', delivery.id);

          failCount++;
        }

        // Small delay between retries
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error processing delivery ${delivery.id}:`, error);
        failCount++;
      }
    }

    console.log(`Retry processing complete: ${successCount} success, ${failCount} failed, ${skippedCount} skipped`);

    return new Response(JSON.stringify({
      message: 'Retry processing complete',
      processed: failedDeliveries.length,
      success: successCount,
      failed: failCount,
      skipped: skippedCount
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in retry-failed-media:', error);
    return new Response(JSON.stringify({ 
      error: 'An error occurred processing your request' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
