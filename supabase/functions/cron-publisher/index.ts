import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SRK);

    // Find all approved posts whose scheduled_time has passed
    const { data: duePosts, error: queryError } = await supabase
      .from('scheduled_posts')
      .select('id, content, target_platform, scheduled_time')
      .eq('status', 'approved')
      .lte('scheduled_time', new Date().toISOString());

    if (queryError) {
      console.error('[CRON-PUBLISHER] Query error:', queryError);
      return new Response(JSON.stringify({ error: queryError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!duePosts || duePosts.length === 0) {
      console.log('[CRON-PUBLISHER] No due posts to publish.');
      return new Response(JSON.stringify({ published: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[CRON-PUBLISHER] Found ${duePosts.length} due post(s) to publish.`);

    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const post of duePosts) {
      // ── ATOMIC CLAIM: Prevent duplicate publishing across cron ticks ──
      // Transition from 'approved' → 'publishing' atomically.
      // If another cron tick or process already claimed it, this returns null.
      const { data: claimedPost } = await supabase
        .from('scheduled_posts')
        .update({ status: 'publishing', updated_at: new Date().toISOString() })
        .eq('id', post.id)
        .eq('status', 'approved')
        .select('id')
        .maybeSingle();

      if (!claimedPost) {
        console.log(`[CRON-PUBLISHER] Post ${post.id} already claimed by another process, skipping.`);
        continue;
      }

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/publish-meta-post`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SRK}`,
          },
          body: JSON.stringify({ post_id: post.id }),
        });

        const result = await res.json();

        if (res.ok && result.success) {
          console.log(`[CRON-PUBLISHER] Published post ${post.id} successfully. Meta ID: ${result.meta_post_id}`);
          results.push({ id: post.id, success: true });
        } else {
          console.error(`[CRON-PUBLISHER] Failed to publish post ${post.id}:`, result.error);
          results.push({ id: post.id, success: false, error: result.error });
        }
      } catch (err: any) {
        console.error(`[CRON-PUBLISHER] Error publishing post ${post.id}:`, err.message);
        results.push({ id: post.id, success: false, error: err.message });
      }
    }

    const published = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`[CRON-PUBLISHER] Done. Published: ${published}, Failed: ${failed}`);

    return new Response(JSON.stringify({ published, failed, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[CRON-PUBLISHER] Fatal error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
