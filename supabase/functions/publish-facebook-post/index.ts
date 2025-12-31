import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Publish Facebook Post Edge Function
 * 
 * Security:
 * - Requires authenticated user with contributor+ role
 * - Verifies company context from the scheduled post record
 * - Uses tenant isolation via loadTenantFromRecord pattern
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Get auth header from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create client with user's auth for RLS
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Create service client for backend operations
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    const { scheduled_post_id, company_id: requestCompanyId } = await req.json();

    if (!scheduled_post_id) {
      return new Response(JSON.stringify({ error: 'scheduled_post_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load scheduled post - RLS will ensure user has access
    const { data: scheduledPost, error: postError } = await supabaseUser
      .from('facebook_scheduled_posts')
      .select(`
        *,
        facebook_pages (
          id,
          company_id,
          page_id,
          page_name,
          page_access_token
        )
      `)
      .eq('id', scheduled_post_id)
      .maybeSingle();

    if (postError || !scheduledPost) {
      console.error('Error fetching scheduled post:', postError);
      return new Response(JSON.stringify({ error: 'Scheduled post not found or access denied' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // CRITICAL: Derive company_id from the database record, not from user input
    const companyId = scheduledPost.company_id;
    if (!companyId) {
      console.error('Tenant isolation violation: scheduled post has no company_id');
      return new Response(JSON.stringify({ error: 'Invalid post configuration' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify the request company_id matches (if provided)
    if (requestCompanyId && requestCompanyId !== companyId) {
      console.error('Tenant mismatch: request company_id does not match post company_id');
      return new Response(JSON.stringify({ error: 'Company context mismatch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user has contributor role for this company
    const { data: roleCheck, error: roleError } = await supabaseUser
      .rpc('has_company_role', { 
        company_uuid: companyId, 
        required_role: 'contributor' 
      });

    if (roleError || !roleCheck) {
      console.error('Role check failed:', roleError);
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const facebookPage = scheduledPost.facebook_pages;
    if (!facebookPage?.page_access_token) {
      return new Response(JSON.stringify({ error: 'Facebook page not properly configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Publish to Facebook
    const facebookResponse = await fetch(
      `https://graph.facebook.com/v18.0/${facebookPage.page_id}/feed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: scheduledPost.content,
          access_token: facebookPage.page_access_token,
        }),
      }
    );

    const facebookResult = await facebookResponse.json();

    if (!facebookResponse.ok) {
      console.error('Facebook API error:', facebookResult);
      
      // Update post status to failed
      await supabaseService
        .from('facebook_scheduled_posts')
        .update({
          status: 'failed',
          error_message: facebookResult.error?.message || 'Unknown Facebook error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', scheduled_post_id);

      return new Response(JSON.stringify({ 
        error: 'Failed to publish to Facebook',
        details: facebookResult.error?.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update post status to published
    await supabaseService
      .from('facebook_scheduled_posts')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        facebook_post_id: facebookResult.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', scheduled_post_id);

    console.log('Successfully published Facebook post:', {
      scheduled_post_id,
      facebook_post_id: facebookResult.id,
      company_id: companyId,
    });

    return new Response(JSON.stringify({ 
      success: true, 
      facebook_post_id: facebookResult.id 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error publishing Facebook post:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
