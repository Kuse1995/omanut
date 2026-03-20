import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { veoPollOperation } from '../_shared/gemini-client.ts';
import { minimaxPollVideoTask, minimaxDownloadFile } from '../_shared/minimax-client.ts';

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
        const provider = job.video_provider || 'veo';

        // Increment poll count
        await supabase
          .from('video_generation_jobs')
          .update({ poll_count: job.poll_count + 1, updated_at: new Date().toISOString() })
          .eq('id', job.id);

        if (provider === 'minimax') {
          await handleMinimaxPoll(supabase, job);
        } else {
          await handleVeoPoll(supabase, job);
        }

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

// ============ VEO POLLING ============
async function handleVeoPoll(supabase: any, job: any) {
  const pollResult = await veoPollOperation(job.operation_name);

  if (!pollResult.done) {
    console.log(`[POLL-VIDEO] Veo job ${job.id} still pending (poll ${job.poll_count + 1})`);
    return;
  }

  if (pollResult.error || !pollResult.videoBase64) {
    await supabase
      .from('video_generation_jobs')
      .update({ status: 'failed', error_message: pollResult.error || 'No video data', updated_at: new Date().toISOString() })
      .eq('id', job.id);
    await sendWhatsAppMessage(job, `❌ Video generation failed: ${pollResult.error || 'No video data returned'}`);
    return;
  }

  const videoBytes = Uint8Array.from(atob(pollResult.videoBase64), c => c.charCodeAt(0));
  await uploadAndComplete(supabase, job, videoBytes, pollResult.mimeType || 'video/mp4');
}

// ============ MINIMAX POLLING ============
async function handleMinimaxPoll(supabase: any, job: any) {
  const pollResult = await minimaxPollVideoTask(job.operation_name);

  if (!pollResult.done) {
    console.log(`[POLL-VIDEO] MiniMax job ${job.id} still pending (poll ${job.poll_count + 1})`);
    return;
  }

  if (pollResult.error) {
    await supabase
      .from('video_generation_jobs')
      .update({ status: 'failed', error_message: pollResult.error, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    await sendWhatsAppMessage(job, `❌ Video generation failed: ${pollResult.error}`);
    return;
  }

  try {
    let videoBytes: Uint8Array;
    let mimeType = 'video/mp4';

    if (pollResult.downloadUrl) {
      // Download directly from the URL MiniMax provides
      console.log(`[POLL-VIDEO] Downloading MiniMax video from URL for job ${job.id}`);
      const dlRes = await fetch(pollResult.downloadUrl);
      if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
      mimeType = dlRes.headers.get('content-type') || 'video/mp4';
      videoBytes = new Uint8Array(await dlRes.arrayBuffer());
    } else if (pollResult.fileId) {
      // Download via file API
      console.log(`[POLL-VIDEO] Downloading MiniMax video via file API for job ${job.id}, fileId=${pollResult.fileId}`);
      const dlResult = await minimaxDownloadFile(pollResult.fileId);
      videoBytes = dlResult.videoBytes;
      mimeType = dlResult.mimeType;
    } else {
      await supabase
        .from('video_generation_jobs')
        .update({ status: 'failed', error_message: 'No file_id or download URL returned', updated_at: new Date().toISOString() })
        .eq('id', job.id);
      await sendWhatsAppMessage(job, '❌ Video generation completed but no download link was provided.');
      return;
    }

    await uploadAndComplete(supabase, job, videoBytes, mimeType);
  } catch (dlErr: any) {
    console.error(`[POLL-VIDEO] MiniMax download error for job ${job.id}:`, dlErr);
    await supabase
      .from('video_generation_jobs')
      .update({ status: 'failed', error_message: `Download failed: ${dlErr.message}`, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    await sendWhatsAppMessage(job, `❌ Video generated but download failed: ${dlErr.message}`);
  }
}

// ============ SHARED: UPLOAD & COMPLETE ============
async function uploadAndComplete(supabase: any, job: any, videoBytes: Uint8Array, mimeType: string) {
  const videoPath = `videos/${job.company_id}/${crypto.randomUUID()}.mp4`;

  const { error: uploadErr } = await supabase.storage
    .from('company-media')
    .upload(videoPath, videoBytes, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadErr) {
    console.error(`[POLL-VIDEO] Upload error for job ${job.id}:`, uploadErr);
    await supabase
      .from('video_generation_jobs')
      .update({ status: 'failed', error_message: `Upload failed: ${uploadErr.message}`, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    await sendWhatsAppMessage(job, `❌ Video generated but upload failed: ${uploadErr.message}`);
    return;
  }

  const { data: publicData } = supabase.storage
    .from('company-media')
    .getPublicUrl(videoPath);
  const videoUrl = publicData.publicUrl;

  await supabase
    .from('video_generation_jobs')
    .update({ status: 'completed', video_url: videoUrl, updated_at: new Date().toISOString() })
    .eq('id', job.id);

  console.log(`[POLL-VIDEO] Job ${job.id} completed: ${videoUrl}`);
  console.log(`[POLL-VIDEO] Sending WhatsApp notification to ${job.boss_phone}...`);
  try {
    await sendWhatsAppMessage(job, `🎬 Your video is ready!`, videoUrl);
    console.log(`[POLL-VIDEO] WhatsApp notification sent for job ${job.id}`);
  } catch (sendErr: any) {
    console.error(`[POLL-VIDEO] WhatsApp send failed for job ${job.id}:`, sendErr?.message || sendErr);
  }
}

// ============ WHATSAPP NOTIFICATION ============
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: company } = await supabase
    .from('companies')
    .select('whatsapp_number')
    .eq('id', job.company_id)
    .single();

  const normalizeWhatsAppNumber = (value?: string | null) => {
    if (!value) return null;
    return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`;
  };

  const fromNumber = normalizeWhatsAppNumber(company?.whatsapp_number);
  const toNumber = normalizeWhatsAppNumber(job.boss_phone);

  if (!fromNumber || !toNumber) {
    console.error('[POLL-VIDEO] Missing WhatsApp sender or recipient', {
      companyId: job.company_id,
      hasFrom: !!fromNumber,
      hasTo: !!toNumber,
    });
    return;
  }

  const form = new URLSearchParams();
  form.append('From', fromNumber);
  form.append('To', toNumber);
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
