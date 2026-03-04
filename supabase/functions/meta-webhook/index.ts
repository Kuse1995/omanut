import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Tenant-safe Meta Webhook Handler
 * 
 * Routes Facebook/WhatsApp messages to the correct company by:
 * 1. Looking up the page_id in facebook_pages to find company_id
 * 2. Storing all messages with company_id for tenant isolation
 * 3. Using loadTenantFromRecord pattern for background processing
 */

interface FacebookEntry {
  id: string; // Page ID
  time: number;
  messaging?: FacebookMessaging[];
  changes?: FacebookChange[];
}

interface FacebookMessaging {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{ type: string; payload: { url: string } }>;
  };
}

interface FacebookChange {
  field: string;
  value: {
    item?: string;
    comment_id?: string;
    parent_id?: string;
    post_id?: string;
    from?: { id: string; name?: string };
    message?: string;
    created_time?: number;
    verb?: string;
  };
}

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

  // Handle POST requests (actual webhook events)
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      console.log('Received webhook payload:', JSON.stringify(body, null, 2));

      // Initialize Supabase client with service role for backend operations
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Process each entry
      if (body.object === 'page' && body.entry) {
        for (const entry of body.entry as FacebookEntry[]) {
          const pageId = entry.id;
          
          // Look up the company that owns this page (tenant context from DB)
          const { data: facebookPage, error: pageError } = await supabase
            .from('facebook_pages')
            .select('id, company_id, page_name')
            .eq('page_id', pageId)
            .eq('is_active', true)
            .maybeSingle();

          if (pageError) {
            console.error('Error looking up Facebook page:', pageError);
            continue;
          }

          if (!facebookPage) {
            console.warn(`No active Facebook page found for page_id: ${pageId}. Message will be stored without company context.`);
          }

          const companyId = facebookPage?.company_id;
          const facebookPageDbId = facebookPage?.id;

          // Process messaging events (direct messages)
          if (entry.messaging) {
            for (const messagingEvent of entry.messaging) {
              if (messagingEvent.message) {
                const { data, error } = await supabase
                  .from('facebook_messages')
                  .insert({
                    sender_psid: messagingEvent.sender.id,
                    page_id: pageId,
                    message_text: messagingEvent.message.text || null,
                    is_processed: false,
                    company_id: companyId,
                    facebook_page_id: facebookPageDbId,
                  });

                if (error) {
                  console.error('Error inserting Facebook message:', error);
                } else {
                  console.log('Facebook message stored:', { 
                    sender: messagingEvent.sender.id, 
                    company_id: companyId,
                    hasText: !!messagingEvent.message.text 
                  });
                }
              }
            }
          }

          // Process feed changes (comments on posts)
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.field === 'feed' && change.value?.item === 'comment') {
                const commentValue = change.value;
                
                // Only process if we have company context
                if (!companyId || !facebookPageDbId) {
                  console.warn('Skipping comment storage - no company context for page:', pageId);
                  continue;
                }

                // Check for add verb (new comment)
                if (commentValue.verb === 'add' && commentValue.comment_id) {
                  const { error } = await supabase
                    .from('facebook_comments')
                    .insert({
                      company_id: companyId,
                      facebook_page_id: facebookPageDbId,
                      post_id: commentValue.post_id || '',
                      comment_id: commentValue.comment_id,
                      parent_comment_id: commentValue.parent_id || null,
                      commenter_id: commentValue.from?.id || '',
                      commenter_name: commentValue.from?.name || null,
                      content: commentValue.message || null,
                      is_processed: false,
                      metadata: { raw_event: commentValue },
                    });

                  if (error) {
                    // Handle duplicate comment gracefully
                    if (error.code === '23505') {
                      console.log('Duplicate comment ignored:', commentValue.comment_id);
                    } else {
                      console.error('Error inserting Facebook comment:', error);
                    }
                  } else {
                    console.log('Facebook comment stored:', {
                      comment_id: commentValue.comment_id,
                      company_id: companyId,
                    });
                  }
                }
              }
            }
          }
        }
      }

      // Always return 200 to acknowledge receipt
      return new Response(JSON.stringify({ status: 'received' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Error processing webhook:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Still return 200 to prevent Facebook from retrying
      return new Response(JSON.stringify({ status: 'error', message: errorMessage }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // For other methods, return method not allowed
  return new Response('Method not allowed', {
    status: 405,
    headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
  });
});
