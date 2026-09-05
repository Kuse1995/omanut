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

    if (!isServiceRole) {
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
    }

    const { post_id } = await req.json();
    if (!post_id) {
      return new Response(JSON.stringify({ error: 'post_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Quick check: reject if post is pending_image (before attempting claim)
    const { data: preCheck } = await supabaseService
      .from('scheduled_posts')
      .select('status')
      .eq('id', post_id)
      .maybeSingle();

    if (preCheck?.status === 'pending_image') {
      return new Response(JSON.stringify({ error: 'Post is waiting for image generation. It will auto-publish when the image is ready.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── ATOMIC CLAIM: Prevent duplicate publishing ──
    // A single UPDATE...WHERE atomically transitions the post to 'publishing'.
    // If another process already claimed it, this returns null → we bail out.
    const { data: post, error: claimError } = await supabaseService
      .from('scheduled_posts')
      .update({ status: 'publishing', updated_at: new Date().toISOString() })
      .eq('id', post_id)
      .in('status', ['draft', 'scheduled', 'approved', 'publishing'])
      .select('*')
      .maybeSingle();

    if (claimError) {
      console.error('Claim error:', claimError);
      return new Response(JSON.stringify({ error: claimError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!post) {
      return new Response(JSON.stringify({ error: 'Post not found, already published, or claimed by another process' }), {
        status: 409,
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

    const targetPlatform = post.target_platform || 'facebook';
    const results: { facebook?: any; instagram?: any; tiktok?: any } = {};
    const errors: string[] = [];

    // ── TikTok: Content Posting API (video). Requires TIKTOK_ACCESS_TOKEN. ──
    if (targetPlatform === 'tiktok') {
      const tiktokToken = Deno.env.get('TIKTOK_ACCESS_TOKEN');
      if (!tiktokToken) {
        await supabaseService.from('scheduled_posts').update({
          status: 'failed',
          error_message: 'TikTok publishing is not configured on this project yet (missing TIKTOK_ACCESS_TOKEN). Publish to Facebook/Instagram for now.',
          updated_at: new Date().toISOString(),
        }).eq('id', post_id);
        return new Response(JSON.stringify({ error: 'TikTok publishing is not configured on this project yet.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      try {
        const ttRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + tiktokToken,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({
            post_info: {
              title: String(post.content || '').slice(0, 150),
              privacy_level: 'SELF_ONLY', // safe default until operator approves public posting
              disable_duet: false,
              disable_comment: false,
              disable_stitch: false,
            },
            source_info: {
              source: 'PULL_FROM_URL',
              video_url: post.video_url || '',
            },
          }),
        });
        const ttJson: any = await ttRes.json();
        if (!ttRes.ok || ttJson?.error?.code !== 'ok') {
          const detail = ttJson?.error?.message || 'TikTok API error';
          errors.push('TikTok: ' + detail);
          console.error('TikTok publish error:', JSON.stringify(ttJson, null, 2));
        } else {
          results.tiktok = ttJson?.data?.publish_id || ttJson.data || null;
          console.log('Post ' + post_id + ' submitted to TikTok. publish_id:', results.tiktok);
        }
      } catch (ttErr: any) {
        errors.push('TikTok: ' + ttErr.message);
      }

      if (!results.tiktok) {
        await supabaseService.from('scheduled_posts').update({
          status: 'failed',
          error_message: errors.join('; '),
          updated_at: new Date().toISOString(),
        }).eq('id', post_id);
        return new Response(JSON.stringify({ error: errors.join('; ') }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await supabaseService.from('scheduled_posts').update({
        status: 'published',
        meta_post_id: results.tiktok || null,
        error_message: null,
        updated_at: new Date().toISOString(),
      }).eq('id', post_id);
      return new Response(JSON.stringify({
        success: true,
        meta_post_id: results.tiktok || null,
        platforms: { tiktok: 'success' },
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Facebook: Publish immediately ──
    if (targetPlatform === 'facebook' || targetPlatform === 'both') {
      try {
        let fbResponse: Response;

        if (post.video_url) {
          // Video post via resumable upload or direct URL
          fbResponse = await fetch(
            `https://graph.facebook.com/v25.0/${post.page_id}/videos`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${cred.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                file_url: post.video_url,
                description: post.content,
                published: true,
              }),
            }
          );
        } else if (post.image_url) {
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
                published: true,
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
                published: true,
              }),
            }
          );
        }

        const fbResult = await fbResponse.json();
        if (!fbResponse.ok) {
          const e = fbResult.error || {};
          const detail = `${e.message || 'API error'}${e.error_subcode ? ` [subcode ${e.error_subcode}]` : ''}${e.error_user_msg ? ` — ${e.error_user_msg}` : ''}${e.fbtrace_id ? ` (fbtrace ${e.fbtrace_id})` : ''}`;
          errors.push(`Facebook: ${detail}`);
          console.error('Facebook publish error (full payload):', JSON.stringify(fbResult, null, 2));
        } else {
          results.facebook = fbResult;
          console.log(`Post ${post_id} published on Facebook. ID: ${fbResult.id}`);
        }
      } catch (fbErr: any) {
        errors.push(`Facebook: ${fbErr.message}`);
      }
    }

    // ── Instagram: two-step publish ──
    if (targetPlatform === 'instagram' || targetPlatform === 'both') {
      if (!cred.ig_user_id) {
        errors.push('Instagram: No Instagram Business Account ID configured');
      } else if (!post.image_url && !post.video_url) {
        errors.push('Instagram: An image or video is required for Instagram posts');
      } else {
        try {
          // Step 1: Create media container (video or image)
          const isVideo = !!post.video_url;
          const containerBody: any = {
            caption: post.content,
          };

          if (isVideo) {
            containerBody.media_type = 'REELS';
            containerBody.video_url = post.video_url;
            containerBody.share_to_feed = true;
          } else {
            containerBody.image_url = post.image_url;
          }

          const containerRes = await fetch(
            `https://graph.facebook.com/v25.0/${cred.ig_user_id}/media`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${cred.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(containerBody),
            }
          );

          const containerResult = await containerRes.json();
          if (!containerRes.ok) {
            const e = containerResult.error || {};
            const detail = `${e.message || 'API error'}${e.error_subcode ? ` [subcode ${e.error_subcode}]` : ''}${e.error_user_msg ? ` — ${e.error_user_msg}` : ''}${e.fbtrace_id ? ` (fbtrace ${e.fbtrace_id})` : ''}`;
            errors.push(`Instagram container: ${detail}`);
            console.error('IG container error (full payload):', JSON.stringify(containerResult, null, 2));
          } else {
            const creationId = containerResult.id;
            console.log(`IG media container created: ${creationId} (type: ${isVideo ? 'REELS' : 'IMAGE'})`);

            // Poll for container readiness (videos take longer)
            const maxPolls = isVideo ? 20 : 10;
            const pollInterval = isVideo ? 5000 : 3000;
            let containerStatus = 'IN_PROGRESS';
            for (let i = 0; i < maxPolls; i++) {
              await new Promise(resolve => setTimeout(resolve, pollInterval));
              const statusRes = await fetch(
                `https://graph.facebook.com/v25.0/${creationId}?fields=status_code&access_token=${cred.access_token}`
              );
              const statusData = await statusRes.json();
              containerStatus = statusData.status_code;
              console.log(`IG container ${creationId} status: ${containerStatus} (attempt ${i + 1})`);
              if (containerStatus === 'FINISHED' || containerStatus === 'ERROR') break;
            }

            if (containerStatus === 'ERROR') {
              errors.push('Instagram: Container processing failed');
            } else if (containerStatus !== 'FINISHED') {
              errors.push('Instagram: Container did not finish processing in time');
            } else {
              // Step 2: Publish
              const publishRes = await fetch(
                `https://graph.facebook.com/v25.0/${cred.ig_user_id}/media_publish`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${cred.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ creation_id: creationId }),
                }
              );

              const publishResult = await publishRes.json();
              if (!publishRes.ok) {
                const e = publishResult.error || {};
                const detail = `${e.message || 'API error'}${e.error_subcode ? ` [subcode ${e.error_subcode}]` : ''}${e.error_user_msg ? ` — ${e.error_user_msg}` : ''}${e.fbtrace_id ? ` (fbtrace ${e.fbtrace_id})` : ''}`;
                errors.push(`Instagram publish: ${detail}`);
                console.error('IG publish error (full payload):', JSON.stringify(publishResult, null, 2));
              } else {
                results.instagram = publishResult;
                console.log(`Post ${post_id} published on Instagram as ${isVideo ? 'Reel' : 'image'}. ID: ${publishResult.id}`);
              }
            }
          }
        } catch (igErr: any) {
          errors.push(`Instagram: ${igErr.message}`);
        }
      }
    }

    const hasAnySuccess = results.facebook || results.instagram;

    if (!hasAnySuccess) {
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

    const metaPostId = results.facebook?.id || results.instagram?.id || null;
    await supabaseService.from('scheduled_posts').update({
      status: 'published',
      meta_post_id: metaPostId,
      error_message: errors.length > 0 ? errors.join('; ') : null,
      updated_at: new Date().toISOString(),
    }).eq('id', post_id);

    return new Response(JSON.stringify({
      success: true,
      meta_post_id: metaPostId,
      platforms: {
        facebook: results.facebook ? 'success' : (targetPlatform === 'facebook' || targetPlatform === 'both' ? 'failed' : 'skipped'),
        instagram: results.instagram ? 'success' : (targetPlatform === 'instagram' || targetPlatform === 'both' ? 'failed' : 'skipped'),
      },
      errors: errors.length > 0 ? errors : undefined,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in publish-meta-post:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
