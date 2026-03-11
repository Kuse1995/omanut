import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.log('[WATCHDOG] Twilio credentials not configured, skipping');
      return new Response(JSON.stringify({ message: 'Twilio not configured' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const now = new Date();
    const twoMinAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

    let retried = 0;
    let checked = 0;
    let fallbacks = 0;

    // 1. Stale 'pending' rows — created >2 min ago, never sent
    const { data: stalePending } = await supabase
      .from('boss_media_deliveries')
      .select('*, companies(whatsapp_number)')
      .eq('status', 'pending')
      .lt('created_at', twoMinAgo)
      .lt('retry_count', 3)
      .limit(20);

    // 2. 'sent' rows >5 min old — check Twilio status
    const { data: sentRows } = await supabase
      .from('boss_media_deliveries')
      .select('*, companies(whatsapp_number)')
      .eq('status', 'sent')
      .not('twilio_sid', 'is', null)
      .lt('created_at', fiveMinAgo)
      .limit(20);

    // 3. 'failed' rows with retries left
    const { data: failedRows } = await supabase
      .from('boss_media_deliveries')
      .select('*, companies(whatsapp_number)')
      .eq('status', 'failed')
      .lt('retry_count', 3)
      .limit(20);

    // Helper: retry sending media via Twilio
    async function retrySend(delivery: any): Promise<boolean> {
      const fromNumber = delivery.companies?.whatsapp_number;
      if (!fromNumber) return false;

      const from = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

      const formData = new URLSearchParams();
      formData.append('From', from);
      formData.append('To', delivery.boss_phone);
      formData.append('Body', '🖼️ (retry)');
      formData.append('MediaUrl', delivery.image_url);

      try {
        const resp = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        });

        if (resp.ok) {
          const data = await resp.json();
          await supabase.from('boss_media_deliveries').update({
            status: 'sent',
            twilio_sid: data.sid,
            retry_count: delivery.retry_count + 1,
            updated_at: new Date().toISOString(),
            error_message: null,
          }).eq('id', delivery.id);
          console.log(`[WATCHDOG] Retry OK for ${delivery.id}, SID: ${data.sid}`);
          return true;
        } else {
          const errText = await resp.text();
          await supabase.from('boss_media_deliveries').update({
            status: 'failed',
            retry_count: delivery.retry_count + 1,
            updated_at: new Date().toISOString(),
            error_message: `Twilio ${resp.status}: ${errText.substring(0, 200)}`,
          }).eq('id', delivery.id);
          console.error(`[WATCHDOG] Retry failed for ${delivery.id}: ${resp.status}`);
          return false;
        }
      } catch (err) {
        await supabase.from('boss_media_deliveries').update({
          status: 'failed',
          retry_count: delivery.retry_count + 1,
          updated_at: new Date().toISOString(),
          error_message: `Exception: ${err instanceof Error ? err.message : 'unknown'}`,
        }).eq('id', delivery.id);
        return false;
      }
    }

    // Helper: send text-only fallback
    async function sendFallback(delivery: any) {
      const fromNumber = delivery.companies?.whatsapp_number;
      if (!fromNumber) return;

      const from = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

      const formData = new URLSearchParams();
      formData.append('From', from);
      formData.append('To', delivery.boss_phone);
      formData.append('Body', `⚠️ I tried to send you an image but it didn't go through after ${delivery.max_retries} attempts.\n\nHere's the direct link:\n${delivery.image_url}`);

      try {
        const resp = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        });

        await supabase.from('boss_media_deliveries').update({
          status: resp.ok ? 'fallback_sent' : 'fallback_failed',
          updated_at: new Date().toISOString(),
        }).eq('id', delivery.id);

        if (resp.ok) {
          console.log(`[WATCHDOG] Fallback text sent for ${delivery.id}`);
          fallbacks++;
        }
      } catch (err) {
        console.error(`[WATCHDOG] Fallback send error for ${delivery.id}:`, err);
      }
    }

    // Process stale pending
    for (const d of stalePending || []) {
      const ok = await retrySend(d);
      if (ok) retried++;
    }

    // Process sent — check Twilio status
    for (const d of sentRows || []) {
      checked++;
      try {
        const statusUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages/${d.twilio_sid}.json`;
        const resp = await fetch(statusUrl, {
          headers: {
            'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          }
        });

        if (resp.ok) {
          const msgData = await resp.json();
          const twilioStatus = msgData.status; // queued, sent, delivered, undelivered, failed

          if (twilioStatus === 'delivered') {
            await supabase.from('boss_media_deliveries').update({
              status: 'delivered',
              updated_at: new Date().toISOString(),
            }).eq('id', d.id);
            console.log(`[WATCHDOG] Confirmed delivered: ${d.id}`);
          } else if (twilioStatus === 'failed' || twilioStatus === 'undelivered') {
            if (d.retry_count < d.max_retries) {
              const ok = await retrySend(d);
              if (ok) retried++;
            } else {
              await sendFallback(d);
            }
          }
          // 'queued' or 'sent' — still in progress, leave it
        }
      } catch (err) {
        console.error(`[WATCHDOG] Status check error for ${d.id}:`, err);
      }
    }

    // Process failed with retries remaining
    for (const d of failedRows || []) {
      if (d.retry_count >= d.max_retries) {
        await sendFallback(d);
      } else {
        const ok = await retrySend(d);
        if (ok) retried++;
      }
    }

    const summary = {
      stalePending: stalePending?.length || 0,
      sentChecked: checked,
      failedProcessed: failedRows?.length || 0,
      retried,
      fallbacks,
    };
    console.log('[WATCHDOG] Run complete:', JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[WATCHDOG] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
