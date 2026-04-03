import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { geminiChat } from "../_shared/gemini-client.ts";

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

    const { company_id, conversation_id, platform, customer_name, message_text } = await req.json();

    if (!company_id || !message_text) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load company with boss_phone and whatsapp_number
    const { data: company } = await supabase
      .from('companies')
      .select('id, name, boss_phone, whatsapp_number, admin_last_active')
      .eq('id', company_id)
      .single();

    if (!company?.boss_phone) {
      console.log('[meta-lead-alert] No boss_phone configured, skipping');
      return new Response(JSON.stringify({ skipped: true, reason: 'no_boss_phone' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Dedupe: check if we already alerted for this conversation in the last 30 minutes
    if (conversation_id) {
      const { data: recentAlert } = await supabase
        .from('boss_conversations')
        .select('id')
        .eq('company_id', company_id)
        .ilike('message_content', `%${conversation_id}%`)
        .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      if (recentAlert) {
        console.log('[meta-lead-alert] Already alerted for this conversation recently, skipping');
        return new Response(JSON.stringify({ skipped: true, reason: 'dedupe' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Use AI to classify the lead
    let leadScore = 50;
    let intent = 'neutral';
    let summary = message_text.slice(0, 200);

    try {
      const classifyResponse = await geminiChat({
        model: 'glm-4.7',
        messages: [
          {
            role: 'system',
            content: 'You classify customer messages for a business. Return JSON only: {"lead_score":0-100,"intent":"sales|support|neutral","summary":"2-line boss summary","next_step":"1 line recommendation"}'
          },
          {
            role: 'user',
            content: `Platform: ${platform}\nCustomer: ${customer_name || 'Unknown'}\nMessage: "${message_text}"\n\nClassify this lead.`
          }
        ],
        temperature: 0.2,
        max_tokens: 200,
      });

      if (classifyResponse.ok) {
        const data = await classifyResponse.json();
        const content = data.choices?.[0]?.message?.content || '{}';
        const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());
        leadScore = parsed.lead_score || 50;
        intent = parsed.intent || 'neutral';
        summary = parsed.summary || message_text.slice(0, 200);
        const nextStep = parsed.next_step || '';
        if (nextStep) summary += `\nNext step: ${nextStep}`;
      }
    } catch (aiErr) {
      console.error('[meta-lead-alert] AI classification error:', aiErr);
    }

    // Only alert if lead score is >= 30 (low threshold to catch most leads)
    if (leadScore < 30) {
      console.log(`[meta-lead-alert] Lead score ${leadScore} too low, skipping alert`);
      return new Response(JSON.stringify({ skipped: true, reason: 'low_score', leadScore }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build platform emoji
    const platformEmoji = platform === 'facebook_messenger' ? '💬' :
      platform === 'instagram_dm' ? '📸' :
      platform === 'facebook' ? '📘' :
      platform === 'instagram' ? '📷' : '📱';

    const platformLabel = platform === 'facebook_messenger' ? 'Messenger DM' :
      platform === 'instagram_dm' ? 'Instagram DM' :
      platform === 'facebook' ? 'Facebook Comment' :
      platform === 'instagram' ? 'Instagram Comment' : platform;

    // Send WhatsApp alert to boss via Meta WhatsApp API (same as send-boss-notification pattern)
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !company.whatsapp_number) {
      console.log('[meta-lead-alert] Missing Twilio config, storing alert only');
    } else {
      const intentEmoji = intent === 'sales' ? '🔥' : intent === 'support' ? '🔧' : '💡';
      const alertMessage = `${platformEmoji} New ${platformLabel} Lead ${intentEmoji}

Customer: ${customer_name || 'Unknown'}
Score: ${leadScore}/100 (${intent})

"${message_text.slice(0, 300)}"

${summary}

${conversation_id ? `Conv: ${conversation_id.slice(0, 8)}...` : ''}`;

      const fromNumber = company.whatsapp_number.startsWith('whatsapp:')
        ? company.whatsapp_number
        : `whatsapp:${company.whatsapp_number}`;
      const toNumber = company.boss_phone.startsWith('whatsapp:')
        ? company.boss_phone
        : `whatsapp:${company.boss_phone}`;

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const formData = new URLSearchParams();
      formData.append('From', fromNumber);
      formData.append('To', toNumber);
      formData.append('Body', alertMessage);

      const twilioResponse = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (twilioResponse.ok) {
        console.log(`[meta-lead-alert] Boss alert sent for ${platformLabel} lead (score: ${leadScore})`);
      } else {
        const errorText = await twilioResponse.text();
        console.error('[meta-lead-alert] Twilio error:', errorText);
      }
    }

    // Log to boss_conversations for history
    await supabase.from('boss_conversations').insert({
      company_id,
      message_from: 'system',
      message_content: `Meta lead alert [${conversation_id || 'n/a'}]: ${customer_name || 'Unknown'} via ${platformLabel}`,
      response: summary,
    });

    return new Response(JSON.stringify({ success: true, leadScore, intent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[meta-lead-alert] Error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
