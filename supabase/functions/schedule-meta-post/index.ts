import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Auth: use user's JWT for RLS
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { post_id } = await req.json();
    if (!post_id) {
      return new Response(JSON.stringify({ error: 'post_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load scheduled post (RLS ensures user has access)
    const { data: post, error: postError } = await supabaseUser
      .from('scheduled_posts')
      .select('*')
      .eq('id', post_id)
      .single();

    if (postError || !post) {
      return new Response(JSON.stringify({ error: 'Post not found or access denied' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (post.status !== 'draft') {
      return new Response(JSON.stringify({ error: `Post is already ${post.status}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate scheduled_time is 10min–75days from now
    const scheduledDate = new Date(post.scheduled_time);
    const now = new Date();
    const minTime = new Date(now.getTime() + 10 * 60 * 1000); // +10 minutes
    const maxTime = new Date(now.getTime() + 75 * 24 * 60 * 60 * 1000); // +75 days

    if (scheduledDate < minTime) {
      return new Response(JSON.stringify({ error: 'Scheduled time must be at least 10 minutes from now' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (scheduledDate > maxTime) {
      return new Response(JSON.stringify({ error: 'Scheduled time must be within 75 days from now' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Look up access token from meta_credentials
    const { data: cred, error: credError } = await supabaseService
      .from('meta_credentials')
      .select('access_token')
      .eq('page_id', post.page_id)
      .eq('company_id', post.company_id)
      .limit(1)
      .maybeSingle();

    if (credError || !cred) {
      await supabaseService.from('scheduled_posts').update({
        status: 'failed',
        error_message: 'No Meta credentials found for this page',
        updated_at: new Date().toISOString(),
      }).eq('id', post_id);

      return new Response(JSON.stringify({ error: 'No Meta credentials found for this page' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Convert to Unix timestamp
    const unixTimestamp = Math.floor(scheduledDate.getTime() / 1000);

    // Schedule on Facebook – branch based on image
    let fbResponse: Response;

    if (post.image_url) {
      // Photo post via /photos endpoint
      fbResponse = await fetch(
        `https://graph.facebook.com/v25.0/${post.page_id}/photos`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cred.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: post.image_url,
            caption: post.content,
            published: false,
            scheduled_publish_time: unixTimestamp,
          }),
        }
      );
    } else {
      // Text-only post via /feed endpoint
      fbResponse = await fetch(
        `https://graph.facebook.com/v25.0/${post.page_id}/feed`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cred.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: post.content,
            published: false,
            scheduled_publish_time: unixTimestamp,
          }),
        }
      );
    }

    const fbResult = await fbResponse.json();

    if (!fbResponse.ok) {
      const errMsg = fbResult.error?.message || 'Facebook API error';
      console.error(`Facebook scheduling error for post ${post_id}:`, fbResult);

      await supabaseService.from('scheduled_posts').update({
        status: 'failed',
        error_message: errMsg,
        updated_at: new Date().toISOString(),
      }).eq('id', post_id);

      return new Response(JSON.stringify({ error: errMsg }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Success – update post
    await supabaseService.from('scheduled_posts').update({
      status: 'scheduled',
      meta_post_id: fbResult.id,
      updated_at: new Date().toISOString(),
    }).eq('id', post_id);

    console.log(`Post ${post_id} scheduled on Facebook. Meta post ID: ${fbResult.id}`);

    return new Response(JSON.stringify({
      success: true,
      meta_post_id: fbResult.id,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in schedule-meta-post:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
