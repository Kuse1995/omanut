import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { veoPollOperation } from '../_shared/gemini-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Fetch pending jobs (max 60 polls ≈ 5 minutes at 30s intervals)
    const { data: jobs, error } = await supabase
      .from('video_generation_jobs')
      .select('*')
      .eq('status', 'pending')
      .lt('poll_count', 60)
      .order('created_at', { ascending: true })
      .limit(5);

    if (error) {
      console.error('[POLL-VIDEO] Query error:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ message: 'No pending jobs' }), { headers: corsHeaders });
    }

    console.log(`[POLL-VIDEO] Processing ${jobs.length} pending jobs`);

    for (const job of jobs) {
      try {
        const pollResult = await veoPollOperation(job.operation_name);

        // Increment poll count
        await supabase
          .from('video_generation_jobs')
          .update({ poll_count: job.poll_count + 1, updated_at: new Date().toISOString() })
          .eq('id', job.id);

        if (!pollResult.done) {
          console.log(`[POLL-VIDEO] Job ${job.id} still pending (poll ${job.poll_count + 1})`);
          continue;
        }

        if (pollResult.error || !pollResult.videoBase64) {
          // Mark as failed
          await supabase
            .from('video_generation_jobs')
            .update({ status: 'failed', error_message: pollResult.error || 'No video data', updated_at: new Date().toISOString() })
            .eq('id', job.id);

          // Notify boss of failure
          await sendWhatsAppMessage(job, `❌ Video generation failed: ${pollResult.error || 'No video data returned'}`);
          continue;
        }

        // Upload video to storage
        const videoBytes = Uint8Array.from(atob(pollResult.videoBase64), c => c.charCodeAt(0));
        const videoPath = `videos/${job.company_id}/${crypto.randomUUID()}.mp4`;

        const { error: uploadErr } = await supabase.storage
          .from('company-media')
          .upload(videoPath, videoBytes, {
            contentType: pollResult.mimeType || 'video/mp4',
            upsert: false,
          });

        if (uploadErr) {
          console.error(`[POLL-VIDEO] Upload error for job ${job.id}:`, uploadErr);
          await supabase
            .from('video_generation_jobs')
            .update({ status: 'failed', error_message: `Upload failed: ${uploadErr.message}`, updated_at: new Date().toISOString() })
            .eq('id', job.id);
          await sendWhatsAppMessage(job, `❌ Video generated but upload failed: ${uploadErr.message}`);
          continue;
        }

        const { data: publicData } = supabase.storage
          .from('company-media')
          .getPublicUrl(videoPath);
        const videoUrl = publicData.publicUrl;

        // Mark job as completed
        await supabase
          .from('video_generation_jobs')
          .update({ status: 'completed', video_url: videoUrl, updated_at: new Date().toISOString() })
          .eq('id', job.id);

        console.log(`[POLL-VIDEO] Job ${job.id} completed: ${videoUrl}`);

        // Send video to boss via WhatsApp
        await sendWhatsAppMessage(job, `🎬 Your video is ready!`, videoUrl);

      } catch (jobErr) {
        console.error(`[POLL-VIDEO] Error processing job ${job.id}:`, jobErr);
      }
    }

    // Mark timed-out jobs as failed
    const { data: timedOut } = await supabase
      .from('video_generation_jobs')
      .select('id, boss_phone, company_id')
      .eq('status', 'pending')
      .gte('poll_count', 60);

    if (timedOut && timedOut.length > 0) {
      for (const job of timedOut) {
        await supabase
          .from('video_generation_jobs')
          .update({ status: 'failed', error_message: 'Timed out after 5 minutes', updated_at: new Date().toISOString() })
          .eq('id', job.id);
        await sendWhatsAppMessage(job, '❌ Video generation timed out. Please try again.');
      }
    }

    return new Response(JSON.stringify({ processed: jobs.length }), { headers: corsHeaders });

  } catch (err) {
    console.error('[POLL-VIDEO] Fatal error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

async function sendWhatsAppMessage(
  job: { boss_phone: string; company_id: string },
  body: string,
  mediaUrl?: string,
) {
  const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  if (!TWILIO_SID || !TWILIO_TOKEN) {
    console.error('[POLL-VIDEO] Missing Twilio credentials');
    return;
  }

  // Get company whatsapp_number for the From field
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: company } = await supabase
    .from('companies')
    .select('whatsapp_number')
    .eq('id', job.company_id)
    .single();

  const fromNumber = company?.whatsapp_number?.startsWith('whatsapp:')
    ? company.whatsapp_number
    : `whatsapp:${company?.whatsapp_number}`;

  const form = new URLSearchParams();
  form.append('From', fromNumber);
  form.append('To', job.boss_phone);
  form.append('Body', body);
  if (mediaUrl) {
    form.append('MediaUrl', mediaUrl);
  }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[POLL-VIDEO] Twilio send error (${res.status}):`, errText);
    }
  } catch (e) {
    console.error('[POLL-VIDEO] Twilio send failed:', e);
  }
}
