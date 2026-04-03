import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Background Job: Process Scheduled Facebook Posts
 * 
 * CRITICAL SECURITY:
 * - This is a background worker that should be called by a scheduler
 * - Company context is ALWAYS derived from the database record
 * - NEVER accepts company_id from external input
 * - Uses loadTenantFromRecord pattern for tenant isolation
 * - Logs all tenant violations to security_events table
 */

// Tenant isolation utilities (inline to avoid import issues in edge functions)
class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

function assertTenantContext(
  companyId: string | null | undefined,
  context: string
): asserts companyId is string {
  if (!companyId) {
    throw new TenantContextError(
      `Tenant isolation violation in ${context}: No company_id found on record.`
    );
  }
}

// Security event logging
async function logSecurityEvent(
  supabase: SupabaseClient,
  eventType: string,
  severity: string,
  source: string,
  message: string,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('security_events').insert({
      event_type: eventType,
      severity,
      source,
      message,
      details: details || {},
    });
  } catch (err) {
    console.error('Failed to log security event:', err);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // This function should be called by a scheduler or admin
  // Verify authorization
  const authHeader = req.headers.get('Authorization');
  const cronSecret = req.headers.get('X-Cron-Secret');
  const expectedCronSecret = Deno.env.get('CRON_SECRET');

  // Allow either valid cron secret or service role key
  const isAuthorized = 
    (cronSecret && expectedCronSecret && cronSecret === expectedCronSecret) ||
    (authHeader && authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''));

  if (!isAuthorized) {
    console.log('Unauthorized scheduler access attempt');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date().toISOString();

    // Fetch all pending posts that are due
    const { data: pendingPosts, error: fetchError } = await supabase
      .from('facebook_scheduled_posts')
      .select(`
        *,
        facebook_pages (
          id,
          company_id,
          page_id,
          page_name,
          page_access_token,
          is_active
        )
      `)
      .eq('status', 'pending')
      .lte('scheduled_for', now)
      .limit(50); // Process in batches

    if (fetchError) {
      console.error('Error fetching pending posts:', fetchError);
      return new Response(JSON.stringify({ error: 'Failed to fetch pending posts' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!pendingPosts || pendingPosts.length === 0) {
      console.log('No pending posts to process');
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing ${pendingPosts.length} scheduled posts`);

    const results = {
      processed: 0,
      published: 0,
      failed: 0,
      skipped: 0,
    };

    for (const post of pendingPosts) {
      results.processed++;

      try {
        // CRITICAL: Load company_id from the database record, not from input
        assertTenantContext(post.company_id, `processing scheduled post ${post.id}`);
        const companyId = post.company_id;

        const facebookPage = post.facebook_pages;

        // Validate page is still active and properly configured
        if (!facebookPage || !facebookPage.is_active) {
          console.warn(`Skipping post ${post.id}: Facebook page inactive or missing`);
          await supabase
            .from('facebook_scheduled_posts')
            .update({
              status: 'failed',
              error_message: 'Facebook page is inactive or disconnected',
              updated_at: new Date().toISOString(),
            })
            .eq('id', post.id);
          results.failed++;
          continue;
        }

        // Verify tenant consistency between post and page
        if (facebookPage.company_id !== companyId) {
          const violationMessage = `Post company_id (${companyId}) does not match page company_id (${facebookPage.company_id})`;
          console.error(`SECURITY: Tenant isolation violation: ${violationMessage}`);
          
          // Log to security_events table
          await logSecurityEvent(
            supabase,
            'tenant_mismatch',
            'critical',
            'process-scheduled-posts',
            violationMessage,
            {
              post_id: post.id,
              post_company_id: companyId,
              page_company_id: facebookPage.company_id,
            }
          );
          
          await supabase
            .from('facebook_scheduled_posts')
            .update({
              status: 'failed',
              error_message: 'Tenant isolation error',
              updated_at: new Date().toISOString(),
            })
            .eq('id', post.id);
          results.failed++;
          continue;
        }

        if (!facebookPage.page_access_token) {
          console.warn(`Skipping post ${post.id}: No access token for page`);
          await supabase
            .from('facebook_scheduled_posts')
            .update({
              status: 'failed',
              error_message: 'Facebook page access token missing',
              updated_at: new Date().toISOString(),
            })
            .eq('id', post.id);
          results.failed++;
          continue;
        }

        // Publish to Facebook
        const facebookResponse = await fetch(
          `https://graph.facebook.com/v18.0/${facebookPage.page_id}/feed`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: post.content,
              access_token: facebookPage.page_access_token,
            }),
          }
        );

        const facebookResult = await facebookResponse.json();

        if (!facebookResponse.ok) {
          console.error(`Failed to publish post ${post.id}:`, facebookResult);
          await supabase
            .from('facebook_scheduled_posts')
            .update({
              status: 'failed',
              error_message: facebookResult.error?.message || 'Unknown Facebook error',
              updated_at: new Date().toISOString(),
            })
            .eq('id', post.id);
          results.failed++;
          continue;
        }

        // Success - update post status
        await supabase
          .from('facebook_scheduled_posts')
          .update({
            status: 'published',
            published_at: new Date().toISOString(),
            facebook_post_id: facebookResult.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', post.id);

        console.log(`Published post ${post.id} for company ${companyId}:`, {
          facebook_post_id: facebookResult.id,
        });
        results.published++;

      } catch (error) {
        console.error(`Error processing post ${post.id}:`, error);
        
        if (error instanceof TenantContextError) {
          // Log tenant isolation violations to security_events
          await logSecurityEvent(
            supabase,
            'tenant_violation',
            'critical',
            'process-scheduled-posts',
            error.message,
            { post_id: post.id }
          );
        }

        const errorMessage = 'An error occurred processing your request';
        await supabase
          .from('facebook_scheduled_posts')
          .update({
            status: 'failed',
            error_message: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq('id', post.id);
        results.failed++;
      }
    }

    console.log('Scheduled posts processing complete:', results);

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in scheduled posts processor:', error);
    const errorMessage = 'An error occurred processing your request';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
