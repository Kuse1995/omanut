import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Handle Facebook verification handshake (GET request)
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    console.log('Facebook verification request received:', { mode, token: token ? '[REDACTED]' : null, challenge });

    const verifyToken = Deno.env.get('META_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Verification successful, returning challenge');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    } else {
      console.error('Verification failed: token mismatch or invalid mode');
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  // Handle incoming webhook events (POST request)
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      console.log('Facebook webhook event received:', JSON.stringify(body, null, 2));

      // Process messaging events
      if (body.object === 'page' && body.entry) {
        for (const entry of body.entry) {
          const pageId = entry.id;
          const messaging = entry.messaging || [];

          for (const event of messaging) {
            const senderPsid = event.sender?.id;
            const messageText = event.message?.text;

            if (senderPsid && messageText) {
              console.log(`Message from ${senderPsid}: ${messageText}`);
              
              // Try to store in database, but don't fail if it doesn't work
              try {
                const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
                const supabase = createClient(
                  Deno.env.get('SUPABASE_URL') ?? '',
                  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
                );

                const { error: insertError } = await supabase
                  .from('facebook_messages')
                  .insert({
                    sender_psid: senderPsid,
                    page_id: pageId,
                    message_text: messageText,
                    is_processed: false
                  });

                if (insertError) {
                  console.error('Database insert error:', insertError);
                } else {
                  console.log('Message stored successfully');
                }
              } catch (dbError) {
                console.error('Database operation failed:', dbError);
                // Continue processing - don't fail the webhook
              }
            }
          }
        }
      }
    } catch (parseError) {
      console.error('Error parsing webhook body:', parseError);
      // Still return 200 to Facebook
    }

    // Always return 200 OK to Facebook to acknowledge receipt
    return new Response('EVENT_RECEIVED', {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  }

  // For other methods, return method not allowed
  return new Response('Method not allowed', {
    status: 405,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
  });
});
