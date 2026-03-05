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

    const authHeader = req.headers.get('Authorization') || '';
    const supabaseService = createClient(supabaseUrl, supabaseServiceKey);
    
    const token = authHeader.replace('Bearer ', '');
    const isServiceRole = token === supabaseServiceKey;
    
    let postClient;
    if (isServiceRole) {
      postClient = supabaseService;
    } else {
      const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      postClient = supabaseUser;
    }

    const { post_id } = await req.json();
    if (!post_id) {
      return new Response(JSON.stringify({ error: 'post_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load scheduled post
    const { data: post, error: postError } = await postClient
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
    const minTime = new Date(now.getTime() + 10 * 60 * 1000);
    const maxTime = new Date(now.getTime() + 75 * 24 * 60 * 60 * 1000);

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

    // Look up credentials
    const { data: cred, error: credError } = await supabaseService
      .from('meta_credentials')
      .select('access_token, ig_user_id')
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

    const unixTimestamp = Math.floor(scheduledDate.getTime() / 1000);
    const targetPlatform = post.target_platform || 'facebook';
    
    const results: { facebook?: any; instagram?: any } = {};
    const errors: string[] = [];

    // ── Facebook Publishing ──
    if (targetPlatform === 'facebook' || targetPlatform === 'both') {
      try {
        let fbResponse: Response;

        if (post.image_url) {
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
          errors.push(`Facebook: ${fbResult.error?.message || 'API error'}`);
          console.error(`Facebook scheduling error:`, fbResult);
        } else {
          results.facebook = fbResult;
          console.log(`Post ${post_id} scheduled on Facebook. Meta post ID: ${fbResult.id}`);
        }
      } catch (fbErr: any) {
        errors.push(`Facebook: ${fbErr.message}`);
      }
    }

    // ── Instagram Publishing (two-step) ──
    if (targetPlatform === 'instagram' || targetPlatform === 'both') {
      if (!cred.ig_user_id) {
        errors.push('Instagram: No Instagram Business Account ID configured');
      } else if (!post.image_url) {
        errors.push('Instagram: An image is required for Instagram posts');
      } else {
        try {
          // Step 1: Create media container
          const containerRes = await fetch(
            `https://graph.facebook.com/v25.0/${cred.ig_user_id}/media`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${cred.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                image_url: post.image_url,
                caption: post.content,
              }),
            }
          );

          const containerResult = await containerRes.json();
          if (!containerRes.ok) {
            errors.push(`Instagram container: ${containerResult.error?.message || 'API error'}`);
            console.error('IG container error:', containerResult);
          } else {
            const creationId = containerResult.id;
            console.log(`IG media container created: ${creationId}`);

            // Step 2: Publish the container
            const publishRes = await fetch(
              `https://graph.facebook.com/v25.0/${cred.ig_user_id}/media_publish`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${cred.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  creation_id: creationId,
                }),
              }
            );

            const publishResult = await publishRes.json();
            if (!publishRes.ok) {
              errors.push(`Instagram publish: ${publishResult.error?.message || 'API error'}`);
              console.error('IG publish error:', publishResult);
            } else {
              results.instagram = publishResult;
              console.log(`Post ${post_id} published on Instagram. Media ID: ${publishResult.id}`);
            }
          }
        } catch (igErr: any) {
          errors.push(`Instagram: ${igErr.message}`);
        }
      }
    }

    // Determine final status
    const hasAnySuccess = results.facebook || results.instagram;
    const hasAnyError = errors.length > 0;

    if (!hasAnySuccess) {
      // Complete failure
      await supabaseService.from('scheduled_posts').update({
        status: 'failed',
        error_message: errors.join('; '),
        updated_at: new Date().toISOString(),
      }).eq('id', post_id);

      return new Response(JSON.stringify({ error: errors.join('; ') }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // At least partial success
    const metaPostId = results.facebook?.id || results.instagram?.id || null;
    await supabaseService.from('scheduled_posts').update({
      status: 'scheduled',
      meta_post_id: metaPostId,
      error_message: hasAnyError ? errors.join('; ') : null,
      updated_at: new Date().toISOString(),
    }).eq('id', post_id);

    return new Response(JSON.stringify({
      success: true,
      meta_post_id: metaPostId,
      platforms: {
        facebook: results.facebook ? 'success' : (targetPlatform === 'facebook' || targetPlatform === 'both' ? 'failed' : 'skipped'),
        instagram: results.instagram ? 'success' : (targetPlatform === 'instagram' || targetPlatform === 'both' ? 'failed' : 'skipped'),
      },
      errors: hasAnyError ? errors : undefined,
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
